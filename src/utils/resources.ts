import type { LinkKey, Problem } from '../types';

export interface ResourceDef {
  key: LinkKey;
  label: string;
  /** Platforms that are "correct" for this source field (used only to warn about known wrong-platform links). */
  expected: string[];
  expectedLabel: string;
}

// Button order requested: LeetCode, GFG, Coding Ninjas, Video, Article, TUF+
export const RESOURCES: ResourceDef[] = [
  { key: 'leetcode', label: 'LeetCode', expected: ['leetcode'], expectedLabel: 'LeetCode' },
  { key: 'gfg', label: 'GFG', expected: ['geeksforgeeks'], expectedLabel: 'GeeksforGeeks' },
  { key: 'coding_ninjas', label: 'Coding Ninjas', expected: ['coding_ninjas', 'naukri_code360'], expectedLabel: 'Coding Ninjas' },
  { key: 'youtube', label: 'Video', expected: ['youtube'], expectedLabel: 'YouTube' },
  { key: 'article', label: 'Article', expected: ['takeuforward'], expectedLabel: 'takeuforward.org' },
  { key: 'tuf_plus', label: 'TUF+', expected: ['takeuforward'], expectedLabel: 'takeuforward.org' },
];

export interface ResolvedResource {
  key: LinkKey;
  label: string;
  url: string;
  originalUrl: string | null;
  /** Set when the dataset flags this source field as holding a link to a different platform. */
  mismatchPlatform: string | null;
  expectedLabel: string;
}

const isHttpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u);

// A button exists only when the dataset holds a real http(s) URL. Nothing is ever constructed or guessed.
export function resolveResources(p: Problem): ResolvedResource[] {
  const out: ResolvedResource[] = [];
  for (const def of RESOURCES) {
    const link = p.links[def.key];
    if (!link || typeof link.url !== 'string' || !isHttpUrl(link.url)) continue;
    const mismatch = link.issues.find((i) => i.startsWith('domain_mismatch:'));
    out.push({
      key: def.key,
      label: def.label,
      url: link.url,
      originalUrl: link.original_url && isHttpUrl(link.original_url) ? link.original_url : null,
      mismatchPlatform: mismatch ? mismatch.slice('domain_mismatch:'.length) : null,
      expectedLabel: def.expectedLabel,
    });
  }
  return out;
}

export function describeFlag(flag: string): { review: boolean; text: string } {
  if (flag.startsWith('review:')) {
    return { review: true, text: flag.slice(7).replace(/_/g, ' ').replace(/;/g, '; ') };
  }
  return { review: false, text: flag.replace(/_/g, ' ') };
}
