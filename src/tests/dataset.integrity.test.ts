import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dataset, datasetChecksum, rawDataset } from '../utils/dataset';
import { LINK_KEYS } from '../utils/dataset';
import { resolveResources } from '../utils/resources';
import { oracleProblems } from './helpers';

// These tests are PINNED to the extracted dataset on purpose. If you deliberately replace
// src/data/a2z_old_sheet.json later, update the constants below in one go.
const DATASET_SHA256 = 'e602fa87634730b3437ffc65d5869b2950072b07ae3c465a02ead5fa5ca572e3';
const PER_STEP = [31, 7, 40, 32, 15, 31, 25, 18, 30, 12, 17, 16, 39, 16, 54, 56, 7, 9];
const VALID_URLS = { leetcode: 288, coding_ninjas: 440, gfg: 444, youtube: 387, article: 325, tuf_plus: 355 };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

describe('dataset integrity', () => {
  it('the bundled JSON file is byte-identical to the extracted dataset (sha256)', () => {
    const bytes = readFileSync('src/data/a2z_old_sheet.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(DATASET_SHA256);
  });

  it('has exactly 18 topics, 61 subtopics and 455 problems', () => {
    expect(dataset.topics).toHaveLength(18);
    expect(dataset.topics.flatMap((t) => t.subtopics)).toHaveLength(61);
    expect(dataset.problems).toHaveLength(455);
    expect(dataset.byId.size).toBe(455); // ids are unique
    expect(dataset.topics.map((t) => t.stepNo)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(dataset.topics.map((t) => t.problems.length)).toEqual(PER_STEP);
  });

  it('meta counts in the file agree with the actual content', () => {
    const m = (rawDataset.meta as { counts: { steps: number; sub_steps: number; problems: number } }).counts;
    expect([m.steps, m.sub_steps, m.problems]).toEqual([18, 61, 455]);
  });

  it('preserves the original order exactly (topic -> subtopic -> problem)', () => {
    const rawIds = oracleProblems().map((p) => p.id);
    expect(dataset.problems.map((p) => p.id)).toEqual(rawIds);
    expect(dataset.topics.flatMap((t) => t.subtopics.flatMap((s) => s.problems.map((p) => p.id)))).toEqual(rawIds);
    expect(dataset.problems.map((p) => p.order)).toEqual(Array.from({ length: 455 }, (_, i) => i + 1));
    // every problem sits inside the subtopic/topic it came from
    const raw = oracleProblems();
    dataset.problems.forEach((p, i) => {
      expect([p.stepNo, p.subNo, p.title]).toEqual([raw[i].step, raw[i].sub, raw[i].title]);
    });
  });

  it('matches the flat CSV reference row for row (ids, titles, hierarchy, every URL)', () => {
    const text = readFileSync('data-reference/a2z_old_sheet.csv', 'utf8').replace(/^\uFEFF/, '');
    const [header, ...rows] = parseCsv(text).filter((r) => r.length > 1);
    expect(rows).toHaveLength(455);
    const col = (n: string) => header.indexOf(n);
    rows.forEach((r, i) => {
      const p = dataset.problems[i];
      expect(r[col('id')]).toBe(p.id);
      expect(r[col('title')]).toBe(p.title);
      expect(Number(r[col('step_no')])).toBe(p.stepNo);
      expect(Number(r[col('sub_step_no')])).toBe(p.subNo);
      expect(Number(r[col('position')])).toBe(p.position);
      expect(r[col('difficulty')] || 'Unknown').toBe(p.difficulty);
      for (const k of LINK_KEYS) expect(r[col(k)]).toBe(p.links[k].url ?? '');
    });
  });

  it('contains no fabricated URLs: every URL is a real http(s) URL and every missing one is null', () => {
    for (const p of dataset.problems) {
      for (const k of LINK_KEYS) {
        const l = p.links[k];
        if (l.url === null) expect(['missing', 'malformed']).toContain(l.status);
        else {
          expect(l.status).toBe('present');
          expect(l.url).toMatch(/^https?:\/\/\S+$/);
        }
      }
    }
    for (const k of LINK_KEYS) {
      expect(dataset.problems.filter((p) => p.links[k].url !== null)).toHaveLength(VALID_URLS[k]);
    }
    // the one known non-URL value (bare slug) stays null, and nothing was built from it
    const slug = dataset.problems.find((p) => p.links.tuf_plus.status === 'malformed')!;
    expect(slug.links.tuf_plus.url).toBeNull();
    expect(slug.links.tuf_plus.raw).toBe('sum-of-subarray-minimums');
  });

  it('null URLs never produce a resource button; present URLs produce exactly one', () => {
    const totals: Record<string, number> = {};
    for (const p of dataset.problems) {
      const res = resolveResources(p);
      const expected = LINK_KEYS.filter((k) => p.links[k].url !== null);
      expect(res.map((r) => r.key)).toEqual(expected);
      res.forEach((r) => expect(r.url).toBe(p.links[r.key].url));
      res.forEach((r) => (totals[r.key] = (totals[r.key] ?? 0) + 1));
    }
    expect(totals).toEqual(VALID_URLS);
  });

  it('keeps wrong-platform links in their ORIGINAL source fields (19 in LeetCode, 5 in GFG) and flags them', () => {
    const flagged: Record<string, number> = {};
    for (const p of dataset.problems)
      for (const k of LINK_KEYS)
        if (p.links[k].issues.some((i) => i.startsWith('domain_mismatch:'))) flagged[k] = (flagged[k] ?? 0) + 1;
    expect(flagged).toEqual({ leetcode: 19, gfg: 5 });
    // and the UI-facing resolver marks exactly those
    const marked = dataset.problems.flatMap((p) => resolveResources(p)).filter((r) => r.mismatchPlatform);
    expect(marked).toHaveLength(24);
    expect(new Set(marked.map((r) => r.key))).toEqual(new Set(['leetcode', 'gfg']));
  });

  it('keeps row 16.4.6 in place and flagged as a known source problem', () => {
    const p = dataset.problems.find((x) => x.ref === '16.4.6')!;
    expect(p.id).toBe('01knpsckdp19');
    expect(p.title).toBe('Assign Cookies'); // unchanged, not "fixed"
    expect(p.flags.some((f) => f.startsWith('review:'))).toBe(true);
    expect(dataset.problems.filter((x) => x.title === 'Assign Cookies').map((x) => x.ref)).toEqual(['12.1.1', '16.4.6']);
  });

  it('keeps the one problem with unknown difficulty as Unknown (no guessing)', () => {
    const unknown = dataset.problems.filter((p) => p.difficulty === 'Unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].title).toBe('Word Break');
    const c = dataset.problems.reduce<Record<string, number>>((a, p) => ({ ...a, [p.difficulty]: (a[p.difficulty] ?? 0) + 1 }), {});
    expect(c).toEqual({ Easy: 131, Medium: 187, Hard: 136, Unknown: 1 });
  });

  it('is frozen: the app cannot modify the dataset even by accident', () => {
    const p = dataset.problems[0];
    expect(Object.isFrozen(p)).toBe(true);
    expect(() => {
      (p as { title: string }).title = 'hacked';
    }).toThrow(TypeError);
    expect(() => {
      (rawDataset.steps as unknown[]).push({});
    }).toThrow(TypeError);
    expect(datasetChecksum()).toMatch(/^[0-9a-f]{14}$/);
  });
});
