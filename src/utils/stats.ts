import type { Dataset, Difficulty, ProgressMap } from '../types';
import { dayNumber } from './dates';

export interface TopicStat {
  stepNo: number;
  title: string;
  total: number;
  solved: number;
  inProgress: number;
}

export interface Stats {
  total: number;
  solved: number;
  inProgress: number;
  notStarted: number;
  needsRevision: number;
  important: number;
  completion: number; // 0..100, unrounded
  byDifficulty: Record<Difficulty, { total: number; solved: number }>;
  byTopic: TopicStat[];
}

export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Unknown'];

export const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

// Counts come from the ACTUAL dataset problems; saved entries for ids that are not in the dataset are ignored here.
export function computeStats(ds: Dataset, progress: ProgressMap): Stats {
  const byDifficulty = {
    Easy: { total: 0, solved: 0 },
    Medium: { total: 0, solved: 0 },
    Hard: { total: 0, solved: 0 },
    Unknown: { total: 0, solved: 0 },
  } as Stats['byDifficulty'];
  let solved = 0;
  let inProgress = 0;
  let needsRevision = 0;
  let important = 0;

  const byTopic: TopicStat[] = ds.topics.map((t) => {
    let s = 0;
    let ip = 0;
    for (const p of t.problems) {
      const e = progress[p.id];
      if (e?.status === 'solved') s++;
      else if (e?.status === 'in_progress') ip++;
    }
    return { stepNo: t.stepNo, title: t.shortTitle, total: t.problems.length, solved: s, inProgress: ip };
  });

  for (const p of ds.problems) {
    const e = progress[p.id];
    byDifficulty[p.difficulty].total++;
    if (e?.status === 'solved') {
      solved++;
      byDifficulty[p.difficulty].solved++;
    } else if (e?.status === 'in_progress') inProgress++;
    if (e?.needsRevision) needsRevision++;
    if (e?.important) important++;
  }
  const total = ds.problems.length;
  return {
    total,
    solved,
    inProgress,
    notStarted: total - solved - inProgress,
    needsRevision,
    important,
    completion: total === 0 ? 0 : (solved / total) * 100,
    byDifficulty,
    byTopic,
  };
}

// Every day on which at least one problem was first marked Solved. A later status change never removes a day.
export function solvedDates(progress: ProgressMap): Set<string> {
  const out = new Set<string>();
  for (const e of Object.values(progress)) if (e.solvedDate) out.add(e.solvedDate);
  return out;
}

export function solvedOn(progress: ProgressMap, dateKey: string): number {
  let n = 0;
  for (const e of Object.values(progress)) if (e.solvedDate === dateKey) n++;
  return n;
}

export interface Streaks {
  current: number;
  longest: number;
  solvedToday: boolean;
}

export function computeStreaks(dates: Iterable<string>, today: string): Streaks {
  const days = new Set<number>();
  for (const d of dates) days.add(dayNumber(d));
  const t = dayNumber(today);

  // Longest run of consecutive days.
  const sorted = [...days].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  // Current streak: alive if you solved today, or solved yesterday and today is not over yet.
  const solvedToday = days.has(t);
  let cursor = solvedToday ? t : days.has(t - 1) ? t - 1 : null;
  let current = 0;
  while (cursor !== null && days.has(cursor)) {
    current++;
    cursor--;
  }
  return { current, longest, solvedToday };
}
