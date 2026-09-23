import type {
  Dataset,
  Problem,
  ProblemProgress,
  ProgressMap,
  RevisionAttempt,
  RevisionResult,
  RevisionState,
} from '../types';
import { addDays, DATE_RE, dayNumber } from './dates';

// ---------- Schedule ----------
export const REVISION_STAGES = 5;
// Revision N is due STAGE_DAYS[N-1] days after the day the problem was first solved (when every revision is on time).
export const STAGE_DAYS = [1, 3, 7, 14, 30] as const;
// Days between one revision and the next: [1, 2, 4, 7, 16]. A revision done late (or repeated) shifts the rest.
const STAGE_GAPS = STAGE_DAYS.map((d, i) => d - (i === 0 ? 0 : STAGE_DAYS[i - 1]));

export const FORGOT_DAYS = 1; // Forgot      -> repeat the same revision tomorrow
export const HINT_DAYS = 3; //   Needed hint -> repeat the same revision in 3 days
export const CONFIRM_DAYS = 14; // finished all 5 but not convincingly -> one more confirmation revision

export const WEAK_WINDOW = 4; // look at the last 4 attempts...
export const WEAK_THRESHOLD = 2; // ...weak when 2 or more were Forgot / Needed hint

export const RESULTS: RevisionResult[] = ['forgot', 'hint', 'solved', 'easy'];
export const RESULT_LABEL: Record<RevisionResult, string> = {
  forgot: 'Forgot',
  hint: 'Needed hint',
  solved: 'Solved',
  easy: 'Solved easily',
};
export const RESULT_HELP: Record<RevisionResult, string> = {
  forgot: 'I could not remember the approach.',
  hint: 'I remembered the general idea but needed help.',
  solved: 'I remembered the approach and solved it.',
  easy: 'I remembered it immediately and solved it comfortably.',
};

/** A problem that has just been solved for the first time: revision 1 is due the next day. */
export function newRevisionState(solvedOn: string): RevisionState {
  return { stage: 0, due: addDays(solvedOn, STAGE_DAYS[0]), attempts: [] };
}

const isSuccess = (r: RevisionResult) => r === 'solved' || r === 'easy';

/**
 * Mastered = all 5 revisions completed, the last 2 attempts were Solved / Solved easily,
 * and none of the last 3 attempts was Forgot.
 */
export function isMastered(attempts: RevisionAttempt[]): boolean {
  const last2 = attempts.slice(-2);
  const last3 = attempts.slice(-3);
  return last2.length === 2 && last2.every((a) => isSuccess(a.result)) && !last3.some((a) => a.result === 'forgot');
}

/** Records one revision attempt done on `today` and works out what happens next. Pure. */
export function applyRevision(state: RevisionState, result: RevisionResult, today: string): RevisionState {
  if (state.due === null) return state; // already mastered
  const revision = Math.min(state.stage + 1, REVISION_STAGES);
  const attempts = [...state.attempts, { revision, date: today, result }];

  // Forgot / Needed hint: the same revision comes back soon. The stage never resets.
  if (result === 'forgot') return { stage: state.stage, due: addDays(today, FORGOT_DAYS), attempts };
  if (result === 'hint') return { stage: state.stage, due: addDays(today, HINT_DAYS), attempts };

  // Solved / Solved easily: on to the next revision, using the normal gap.
  const stage = Math.min(state.stage + 1, REVISION_STAGES);
  if (stage < REVISION_STAGES) return { stage, due: addDays(today, STAGE_GAPS[stage]), attempts };

  // All 5 done: only Mastered if the recent attempts show real retention, otherwise confirm once more.
  return { stage, due: isMastered(attempts) ? null : addDays(today, CONFIRM_DAYS), attempts };
}

// ---------- Classification ----------
export type Phase = 'overdue' | 'due' | 'upcoming' | 'mastered';

export function phaseOf(state: RevisionState, today: string): Phase {
  if (state.due === null) return 'mastered';
  const diff = dayNumber(state.due) - dayNumber(today);
  return diff < 0 ? 'overdue' : diff === 0 ? 'due' : 'upcoming';
}

export function daysOverdue(state: RevisionState, today: string): number {
  return state.due === null ? 0 : Math.max(0, dayNumber(today) - dayNumber(state.due));
}

export function daysUntilDue(state: RevisionState, today: string): number {
  return state.due === null ? 0 : Math.max(0, dayNumber(state.due) - dayNumber(today));
}

export interface AttemptCounts {
  attempts: number;
  forgot: number;
  hint: number;
}

export function countAttempts(state: RevisionState): AttemptCounts {
  let forgot = 0;
  let hint = 0;
  for (const a of state.attempts) {
    if (a.result === 'forgot') forgot++;
    else if (a.result === 'hint') hint++;
  }
  return { attempts: state.attempts.length, forgot, hint };
}

/** Weak = 2+ Forgot / Needed hint among the last 4 attempts, and not already Mastered. */
export function isWeak(state: RevisionState): boolean {
  if (state.due === null) return false;
  const struggled = state.attempts.slice(-WEAK_WINDOW).filter((a) => !isSuccess(a.result)).length;
  return struggled >= WEAK_THRESHOLD;
}

/** The revision number shown to the user: the one that is due next (5 while a confirmation revision is pending). */
export const currentRevision = (state: RevisionState) => Math.min(state.stage + 1, REVISION_STAGES);

// ---------- History ----------
export interface HistoryRow {
  label: string;
  date: string;
  result: RevisionResult | null; // null = still pending (date is then the planned date)
}

/** Every attempt so far, then the revisions still to come with their planned dates (assuming each is done on time). */
export function revisionHistory(state: RevisionState): HistoryRow[] {
  const seen = new Set<number>();
  const label = (n: number) => {
    const text = seen.has(n) ? `Revision ${n} (repeat)` : `Revision ${n}`;
    seen.add(n);
    return text;
  };
  const rows: HistoryRow[] = state.attempts.map((a) => ({ label: label(a.revision), date: a.date, result: a.result }));
  if (state.due === null) return rows;

  if (state.stage >= REVISION_STAGES) {
    rows.push({ label: 'Confirmation revision', date: state.due, result: null });
    return rows;
  }
  let planned = state.due;
  for (let n = currentRevision(state); n <= REVISION_STAGES; n++) {
    rows.push({ label: label(n), date: planned, result: null });
    if (n < REVISION_STAGES) planned = addDays(planned, STAGE_GAPS[n]);
  }
  return rows;
}

// ---------- The hub ----------
export interface RevisionItem {
  problem: Problem;
  entry: ProblemProgress;
  state: RevisionState;
  phase: Phase;
  weak: boolean;
}

export interface SolvedTodayItem {
  problem: Problem;
  entry: ProblemProgress;
  item: RevisionItem | null; // null = solved before the Revision Hub existed, so not in the schedule
}

export interface RevisionHub {
  dueToday: RevisionItem[];
  overdue: RevisionItem[];
  upcoming: RevisionItem[];
  mastered: RevisionItem[];
  weak: RevisionItem[];
  solvedToday: SolvedTodayItem[];
  flagged: { problem: Problem; entry: ProblemProgress }[];
  /** Distinct problems that need action: due today, overdue, or manually flagged. */
  todo: number;
}

// Built from the ACTUAL dataset problems only; saved entries for ids that are not in the dataset are ignored.
export function buildRevisionHub(ds: Dataset, progress: ProgressMap, today: string): RevisionHub {
  const hub: RevisionHub = {
    dueToday: [],
    overdue: [],
    upcoming: [],
    mastered: [],
    weak: [],
    solvedToday: [],
    flagged: [],
    todo: 0,
  };
  const dueNum = (i: RevisionItem) => (i.state.due === null ? 0 : dayNumber(i.state.due));

  for (const problem of ds.problems) {
    const entry = progress[problem.id];
    if (!entry) continue;

    let item: RevisionItem | null = null;
    if (entry.revision) {
      const state = entry.revision;
      item = { problem, entry, state, phase: phaseOf(state, today), weak: isWeak(state) };
      if (item.phase === 'overdue') hub.overdue.push(item);
      else if (item.phase === 'due') hub.dueToday.push(item);
      else if (item.phase === 'upcoming') hub.upcoming.push(item);
      else hub.mastered.push(item);
      if (item.weak) hub.weak.push(item);
    }
    if (entry.solvedDate === today) hub.solvedToday.push({ problem, entry, item });
    if (entry.needsRevision) hub.flagged.push({ problem, entry });
    if (entry.needsRevision || item?.phase === 'due' || item?.phase === 'overdue') hub.todo++;
  }

  // `ds.problems` is already in sheet order, so equal keys keep that order (sort is stable).
  hub.overdue.sort((a, b) => dueNum(a) - dueNum(b)); // most overdue first
  hub.upcoming.sort((a, b) => dueNum(a) - dueNum(b)); // soonest first
  hub.weak.sort((a, b) => struggled(b.state) - struggled(a.state)); // struggled the most first
  hub.mastered.sort((a, b) => dayNumber(lastAttemptDate(b)) - dayNumber(lastAttemptDate(a))); // most recently mastered first
  return hub;
}

const struggled = (state: RevisionState) => {
  const c = countAttempts(state);
  return c.forgot + c.hint;
};

function lastAttemptDate(i: RevisionItem): string {
  return i.state.attempts[i.state.attempts.length - 1]?.date ?? i.entry.solvedDate ?? '1970-01-01';
}

// ---------- Reading saved data (leniently: repair what can be repaired, never crash) ----------
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function coerceAttempt(x: unknown): RevisionAttempt | null {
  if (!isRecord(x)) return null;
  const { revision, date, result } = x;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || revision > REVISION_STAGES) return null;
  if (typeof date !== 'string' || !DATE_RE.test(date)) return null;
  if (!RESULTS.includes(result as RevisionResult)) return null;
  return { revision, date, result: result as RevisionResult };
}

/** Returns a valid RevisionState, or null when `x` is not usable at all. */
export function coerceRevision(x: unknown): RevisionState | null {
  if (!isRecord(x)) return null;
  const { stage, due } = x;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 0) return null;
  const attempts = (Array.isArray(x.attempts) ? x.attempts : []).map(coerceAttempt).filter((a): a is RevisionAttempt => a !== null);
  const s = Math.min(stage, REVISION_STAGES);
  if (due === null) return s >= REVISION_STAGES ? { stage: s, due: null, attempts } : null; // only a finished problem has no due date
  if (typeof due === 'string' && DATE_RE.test(due)) return { stage: s, due, attempts };
  return null;
}
