import { beforeEach, describe, expect, it } from 'vitest';
import type { ProgressMap } from '../types';
import { dataset } from '../utils/dataset';
import { filterProblems, filtersActive, groupMatches, EMPTY_FILTERS } from '../utils/filters';
import {
  buildExport, defaultEntry, loadProgress, ops, parseImport, saveProgress, PROGRESS_VERSION,
} from '../utils/progress';
import { computeStats, computeStreaks, solvedDates, solvedOn } from '../utils/stats';
import { STORAGE_KEYS } from '../utils/storage';
import { entry, oracleHaystack, oracleProblems } from './helpers';

const T = '2026-09-21';

describe('status / notes / important / revision operations', () => {
  it('sets solvedDate the first time a problem becomes Solved and never erases it', () => {
    let m: ProgressMap = {};
    m = ops.setStatus(m, 'a', 'in_progress', '2026-09-01');
    expect(m.a.solvedDate).toBeNull();
    m = ops.setStatus(m, 'a', 'solved', '2026-09-02');
    expect(m.a.solvedDate).toBe('2026-09-02');
    m = ops.setStatus(m, 'a', 'not_started', '2026-09-03');
    expect(m.a.solvedDate).toBe('2026-09-02'); // kept
    m = ops.setStatus(m, 'a', 'solved', '2026-09-04');
    expect(m.a.solvedDate).toBe('2026-09-02'); // first time wins
  });

  it('Needs Revision is independent: it never changes status, solvedDate or solved counts', () => {
    let m: ProgressMap = ops.setStatus({}, 'a', 'solved', '2026-09-02');
    m = ops.toggleNeedsRevision(m, 'a');
    expect(m.a).toMatchObject({ status: 'solved', needsRevision: true, solvedDate: '2026-09-02', revisionCount: 0 });
    m = ops.markRevised(m, 'a', '2026-09-10');
    expect(m.a).toMatchObject({
      status: 'solved', needsRevision: false, revisionCount: 1, lastRevised: '2026-09-10', solvedDate: '2026-09-02',
    });
    m = ops.toggleNeedsRevision(m, 'a');
    m = ops.markRevised(m, 'a', '2026-09-20');
    expect(m.a).toMatchObject({ revisionCount: 2, lastRevised: '2026-09-20', status: 'solved' });
  });

  it('clearing the flag without revising does not count a revision', () => {
    let m = ops.toggleNeedsRevision({}, 'a');
    m = ops.toggleNeedsRevision(m, 'a');
    expect(m).toEqual({}); // back to default => pruned
  });

  it('a flagged problem can be in any status (Not started / In progress / Solved)', () => {
    for (const s of ['not_started', 'in_progress', 'solved'] as const) {
      let m = ops.setStatus({}, 'x', s, T);
      m = ops.toggleNeedsRevision(m, 'x');
      expect(m.x.needsRevision).toBe(true);
      expect(m.x.status).toBe(s);
    }
  });

  it('important and notes are independent flags; untouched entries keep object identity', () => {
    let m: ProgressMap = ops.setStatus({}, 'a', 'solved', T);
    const before = m.a;
    m = ops.toggleImportant(m, 'b');
    m = ops.setNotes(m, 'c', 'Use monotonic stack.\nMistake: duplicates.');
    expect(m.a).toBe(before);
    expect(m.b.important).toBe(true);
    expect(m.c.notes).toBe('Use monotonic stack.\nMistake: duplicates.');
    m = ops.setNotes(m, 'c', '');
    expect(m.c).toBeUndefined(); // default entries are pruned
  });
});

describe('persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips through localStorage', () => {
    const m: ProgressMap = { a: entry({ status: 'solved', solvedDate: T, notes: 'n', important: true }) };
    saveProgress(m);
    expect(loadProgress()).toEqual(m);
  });

  it('never silently discards unreadable data: it is copied to a backup key', () => {
    window.localStorage.setItem(STORAGE_KEYS.progress, '{not json');
    expect(loadProgress()).toEqual({});
    expect(window.localStorage.getItem(STORAGE_KEYS.corruptBackup)).toBe('{not json');
  });

  it('repairs a bad field instead of dropping the whole entry', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.progress,
      JSON.stringify({ version: 1, entries: { a: { status: 'weird', notes: 5, important: true, solvedDate: 'yesterday' } } }),
    );
    expect(loadProgress().a).toEqual({ ...defaultEntry(), important: true });
  });
});

describe('streaks', () => {
  const s = (dates: string[], today = T) => computeStreaks(dates, today);
  it('counts consecutive days ending today', () => {
    expect(s(['2026-09-21', '2026-09-20', '2026-09-19'])).toEqual({ current: 3, longest: 3, solvedToday: true });
  });
  it('keeps the current streak alive until the day ends (solved yesterday, not yet today)', () => {
    expect(s(['2026-09-20', '2026-09-19']).current).toBe(2);
    expect(s(['2026-09-20', '2026-09-19']).solvedToday).toBe(false);
  });
  it('is 0 once a full day is missed', () => {
    expect(s(['2026-09-19', '2026-09-18']).current).toBe(0);
    expect(s([]).current).toBe(0);
  });
  it('tracks the longest run separately from the current one', () => {
    const d = ['2026-09-21', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'];
    expect(s(d)).toEqual({ current: 1, longest: 5, solvedToday: true });
  });
  it('ignores duplicate dates and handles month/year boundaries and leap days', () => {
    expect(s(['2026-09-21', '2026-09-21', '2026-09-20']).current).toBe(2);
    expect(computeStreaks(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01').current).toBe(3);
    expect(computeStreaks(['2028-03-01', '2028-02-29', '2028-02-28'], '2028-03-01').current).toBe(3);
    expect(computeStreaks(['2027-01-01', '2026-12-31'], '2027-01-01').current).toBe(2);
  });
  it('is not affected by daylight-saving days', () => {
    expect(computeStreaks(['2026-03-29', '2026-03-28', '2026-03-27'], '2026-03-29').current).toBe(3);
    expect(computeStreaks(['2026-10-25', '2026-10-24'], '2026-10-25').current).toBe(2);
  });
  it('counts a day only if something was marked Solved that day (In progress never counts)', () => {
    const m: ProgressMap = {
      a: entry({ status: 'in_progress' }),
      b: entry({ status: 'solved', solvedDate: T }),
      c: entry({ status: 'not_started', solvedDate: '2026-09-20' }), // solved then reverted: still that day's solve
    };
    expect([...solvedDates(m)].sort()).toEqual(['2026-09-20', T]);
    expect(solvedOn(m, T)).toBe(1);
  });
});

describe('dashboard statistics', () => {
  it('are computed from the real dataset and progress (checked against the raw JSON)', () => {
    const raw = oracleProblems();
    const m: ProgressMap = {};
    raw.forEach((p, i) => {
      if (i % 30 === 0) m[p.id] = entry({ status: 'solved', solvedDate: T });
      else if (i % 30 === 5) m[p.id] = entry({ status: 'in_progress' });
      if (i % 90 === 0) m[p.id] = { ...(m[p.id] ?? defaultEntry()), needsRevision: true };
    });
    m['not-in-dataset'] = entry({ status: 'solved', solvedDate: T }); // orphan must not be counted
    const st = computeStats(dataset, m);

    const solved = raw.filter((p) => m[p.id]?.status === 'solved');
    expect(st.total).toBe(455);
    expect(st.solved).toBe(solved.length);
    expect(st.inProgress).toBe(raw.filter((p) => m[p.id]?.status === 'in_progress').length);
    expect(st.notStarted).toBe(455 - st.solved - st.inProgress);
    expect(st.needsRevision).toBe(raw.filter((p) => m[p.id]?.needsRevision).length);
    expect(st.completion).toBeCloseTo((solved.length / 455) * 100, 10);
    for (const d of ['Easy', 'Medium', 'Hard'] as const) {
      expect(st.byDifficulty[d].total).toBe(raw.filter((p) => p.difficulty === d).length);
      expect(st.byDifficulty[d].solved).toBe(solved.filter((p) => p.difficulty === d).length);
    }
    expect(st.byDifficulty.Unknown).toEqual({ total: 1, solved: solved.filter((p) => p.difficulty === null).length });
    for (const t of st.byTopic) {
      const inStep = raw.filter((p) => p.step === t.stepNo);
      expect(t.total).toBe(inStep.length);
      expect(t.solved).toBe(inStep.filter((p) => m[p.id]?.status === 'solved').length);
    }
  });
});

describe('search and combined filters', () => {
  const raw = oracleProblems();
  const none: ProgressMap = {};

  it('search matches problem name, topic, subtopic and pattern; all words must match', () => {
    for (const q of ['kadane', 'binary search', 'graphs', 'medium', 'two sum']) {
      const words = q.split(' ');
      const expected = raw.filter((p) => words.every((w) => oracleHaystack(p).includes(w))).map((p) => p.id);
      const got = filterProblems(dataset.problems, { ...EMPTY_FILTERS, query: q }, none).map((p) => p.id);
      expect(got, q).toEqual(expected);
      expect(got.length).toBeGreaterThan(0);
    }
    expect(filterProblems(dataset.problems, { ...EMPTY_FILTERS, query: 'zzzz-no-such' }, none)).toHaveLength(0);
  });

  it('filters combine with AND (Topic = Arrays, Difficulty = Medium, Status = Not Started)', () => {
    const arrays = raw.filter((p) => p.step === 3);
    const m: ProgressMap = { [arrays.find((p) => p.difficulty === 'Medium')!.id]: entry({ status: 'solved', solvedDate: T }) };
    const f = { ...EMPTY_FILTERS, topic: 3, difficulty: 'Medium' as const, status: 'not_started' as const };
    const got = filterProblems(dataset.problems, f, m).map((p) => p.id);
    const expected = arrays.filter((p) => p.difficulty === 'Medium' && !m[p.id]).map((p) => p.id);
    expect(got).toEqual(expected);
    expect(got.length).toBeGreaterThan(0);
  });

  it('platform filter = the source field contains a link; important-only and pattern work together', () => {
    const imp = raw.filter((p) => p.links.youtube.url && p.difficulty === 'Hard').slice(0, 3);
    const m: ProgressMap = Object.fromEntries(imp.map((p) => [p.id, entry({ important: true })]));
    const got = filterProblems(dataset.problems, { ...EMPTY_FILTERS, platform: 'youtube', difficulty: 'Hard', importantOnly: true }, m);
    expect(got.map((p) => p.id)).toEqual(imp.map((p) => p.id));
    for (const p of dataset.problems.slice(0, 455)) {
      const has = filterProblems([p], { ...EMPTY_FILTERS, platform: 'leetcode' }, none).length === 1;
      expect(has).toBe(p.links.leetcode.url !== null);
    }
    const label = dataset.patterns[0];
    const byPattern = filterProblems(dataset.problems, { ...EMPTY_FILTERS, pattern: label }, none);
    expect(byPattern.length).toBe(raw.filter((p) => (p.tags ?? []).some((t) => t.label === label)).length);
  });

  it('grouping keeps the exact hierarchy and dataset order and drops empty groups', () => {
    const matched = filterProblems(dataset.problems, { ...EMPTY_FILTERS, topic: 13, difficulty: 'Hard' }, none);
    const groups = groupMatches(dataset, matched);
    expect(groups.every((g) => g.topic.stepNo === 13)).toBe(true);
    expect(groups.flatMap((g) => g.subtopics.flatMap((s) => s.problems)).map((p) => p.id)).toEqual(matched.map((p) => p.id));
    expect(groupMatches(dataset, dataset.problems).flatMap((g) => g.subtopics)).toHaveLength(61);
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, query: ' ' })).toBe(false);
    expect(filtersActive({ ...EMPTY_FILTERS, importantOnly: true })).toBe(true);
  });
});

describe('export / import', () => {
  const ds = { checksum: 'abc', problemCount: 455 };
  const sample: ProgressMap = {
    a: entry({ status: 'solved', solvedDate: T, notes: 'note', important: true, needsRevision: true, revisionCount: 2, lastRevised: '2026-09-15' }),
    b: entry({ status: 'in_progress' }),
  };

  it('exports a versioned file with a dataset checksum, and imports it back losslessly', () => {
    const ex = buildExport(sample, ds, new Date('2026-09-21T10:00:00Z'));
    expect(ex).toMatchObject({ app: 'madhavs-dsa-sheet', version: PROGRESS_VERSION, dataset: ds, exportedAt: '2026-09-21T10:00:00.000Z' });
    const r = parseImport(JSON.stringify(ex));
    expect(r).toMatchObject({ ok: true, progress: sample, checksum: 'abc' });
  });

  it('keeps entries for problems that are not in the dataset (orphans are not deleted)', () => {
    const r = parseImport(JSON.stringify(buildExport({ 'old-problem': entry({ status: 'solved', solvedDate: T }) }, ds)));
    expect(r.ok && r.progress['old-problem']?.status).toBe('solved');
  });

  it.each([
    ['not json', '{oops', /not valid JSON/],
    ['a different app', JSON.stringify({ app: 'other', version: 1, progress: {} }), /progress export from this app/],
    ['a newer version', JSON.stringify({ app: 'madhavs-dsa-sheet', version: 99, progress: {} }), /newer version/],
    ['missing version', JSON.stringify({ app: 'madhavs-dsa-sheet', progress: {} }), /version/],
    ['missing progress', JSON.stringify({ app: 'madhavs-dsa-sheet', version: 1 }), /no progress/],
    ['a bad status', JSON.stringify({ app: 'madhavs-dsa-sheet', version: 1, progress: { a: { ...defaultEntry(), status: 'done' } } }), /invalid status/],
    ['a bad date', JSON.stringify({ app: 'madhavs-dsa-sheet', version: 1, progress: { a: { ...defaultEntry(), solvedDate: '21/09/2026' } } }), /invalid solvedDate/],
    ['a negative count', JSON.stringify({ app: 'madhavs-dsa-sheet', version: 1, progress: { a: { ...defaultEntry(), revisionCount: -1 } } }), /revision count/],
    ['non-boolean flag', JSON.stringify({ app: 'madhavs-dsa-sheet', version: 1, progress: { a: { ...defaultEntry(), important: 'yes' } } }), /important flag/],
  ])('rejects %s without importing anything', (_n, text, msg) => {
    const r = parseImport(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});
