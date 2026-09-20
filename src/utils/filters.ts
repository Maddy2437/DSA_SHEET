import type { Dataset, Difficulty, LinkKey, Problem, ProgressMap, Status, Subtopic, Topic } from '../types';

export interface Filters {
  query: string;
  topic: number | null; // stepNo
  subtopic: string | null; // "step.sub"
  difficulty: Difficulty | null;
  status: Status | null;
  platform: LinkKey | null;
  pattern: string | null; // tag label from the dataset
  importantOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  topic: null,
  subtopic: null,
  difficulty: null,
  status: null,
  platform: null,
  pattern: null,
  importantOnly: false,
};

export function filtersActive(f: Filters): boolean {
  return (
    f.query.trim() !== '' ||
    f.topic !== null ||
    f.subtopic !== null ||
    f.difficulty !== null ||
    f.status !== null ||
    f.platform !== null ||
    f.pattern !== null ||
    f.importantOnly
  );
}

// Search: every whitespace-separated word must appear in the title, topic, subtopic or a pattern tag.
export function filterProblems(all: Problem[], f: Filters, progress: ProgressMap): Problem[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((p) => {
    if (f.topic !== null && p.stepNo !== f.topic) return false;
    if (f.subtopic !== null && p.subKey !== f.subtopic) return false;
    if (f.difficulty !== null && p.difficulty !== f.difficulty) return false;
    if (f.platform !== null && !p.links[f.platform].url) return false;
    if (f.pattern !== null && !p.tags.includes(f.pattern)) return false;
    const e = progress[p.id];
    if (f.status !== null && (e?.status ?? 'not_started') !== f.status) return false;
    if (f.importantOnly && !e?.important) return false;
    for (const w of words) if (!p.searchText.includes(w)) return false;
    return true;
  });
}

export interface Group {
  topic: Topic;
  subtopics: { subtopic: Subtopic; problems: Problem[] }[];
  count: number;
}

// Keeps the exact topic -> subtopic -> problem hierarchy and dataset order; drops empty groups.
export function groupMatches(ds: Dataset, matched: Problem[]): Group[] {
  const ids = new Set(matched.map((p) => p.id));
  const groups: Group[] = [];
  for (const topic of ds.topics) {
    const subs = topic.subtopics
      .map((subtopic) => ({ subtopic, problems: subtopic.problems.filter((p) => ids.has(p.id)) }))
      .filter((s) => s.problems.length > 0);
    if (subs.length > 0) groups.push({ topic, subtopics: subs, count: subs.reduce((n, s) => n + s.problems.length, 0) });
  }
  return groups;
}
