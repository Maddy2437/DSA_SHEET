import type {
  Dataset,
  Problem,
  ProblemProgress,
  ProgressMap,
  RevisionAttempt,
  RevisionPause,
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

/**
 * A problem that has just been solved for the first time: revision 1 is due the next day.
 * `solvedDuringPause` marks a solve made while revision was paused (its `solvedOn` is then the resume date).
 */
export function newRevisionState(solvedOn: string, solvedDuringPause = false): RevisionState {
  return { stage: 0, due: addDays(solvedOn, STAGE_DAYS[0]), attempts: [], ...(solvedDuringPause ? { solvedDuringPause: true } : {}) };
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
  const attempts = [...state.attempts, { revision, date: today, result, scheduled: state.due }];

  // Forgot / Needed hint: the same revision comes back soon. The stage never resets.
  if (result === 'forgot') return { ...state, due: addDays(today, FORGOT_DAYS), attempts };
  if (result === 'hint') return { ...state, due: addDays(today, HINT_DAYS), attempts };

  // Solved / Solved easily: on to the next revision, using the normal gap.
  const stage = Math.min(state.stage + 1, REVISION_STAGES);
  if (stage < REVISION_STAGES) return { ...state, stage, due: addDays(today, STAGE_GAPS[stage]), attempts };

  // All 5 done: only Mastered if the recent attempts show real retention, otherwise confirm once more.
  return { ...state, stage, due: isMastered(attempts) ? null : addDays(today, CONFIRM_DAYS), attempts };
}

// ---------- Classification ----------
export type Phase = 'overdue' | 'due' | 'upcoming' | 'mastered';

export function phaseOf(state: RevisionState, today: string): Phase {
  if (state.due === null) return 'mastered';
  const diff = dayNumber(state.due) - dayNumber(today);
  return diff < 0 ? 'overdue' : diff === 0 ? 'due' : 'upcoming';
}

/**
 * How long a revision has really been overdue: the calendar days since its due date MINUS the paused days in between.
 * Nothing is stored for this; it is worked out from the original due date, so a pause can neither erase overdue time
 * that was already earned nor add any.
 */
export function daysOverdue(state: RevisionState, today: string, pauses: RevisionPause[] = []): number {
  if (state.due === null) return 0;
  const total = dayNumber(today) - dayNumber(state.due);
  return total <= 0 ? 0 : Math.max(0, total - pausedDaysBetween(pauses, state.due, today));
}

/** Paused calendar days in [from, to): `from` counts, `to` does not. */
export function pausedDaysBetween(pauses: RevisionPause[], from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to) - 1;
  let n = 0;
  for (const p of pauses) {
    const lo = Math.max(a, dayNumber(p.start));
    const hi = Math.min(b, dayNumber(p.end));
    if (hi >= lo) n += hi - lo + 1;
  }
  return n;
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
  /** Revision is paused and this problem's date has been reached (which only happens for stray dates): it waits. */
  onHold: boolean;
  /** Overdue BEFORE the current pause began. It keeps its original due date and shows as overdue while paused. */
  frozen: boolean;
  /** Effective days overdue (paused days not counted); 0 unless phase is 'overdue'. */
  overdueDays: number;
  /** First solved after a pause had been activated, so its schedule starts when the pause ends. */
  solvedDuringPause: boolean;
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
  /** The pause that covers today, if any. While it is set no NEW revision becomes due; earlier overdue ones stay frozen. */
  paused: RevisionPause | null;
  /** Problems with at least one revision result recorded today (they are no longer due). */
  completedToday: number;
  /** Still to revise today: due today + overdue. */
  remaining: number;
  /** Today's workload: revised today + still to revise. It does not grow as you work through it. */
  workload: number;
}

// Built from the ACTUAL dataset problems only; saved entries for ids that are not in the dataset are ignored.
export function buildRevisionHub(ds: Dataset, progress: ProgressMap, today: string, pauses: RevisionPause[] = []): RevisionHub {
  const paused = activePause(pauses, today);
  const hub: RevisionHub = {
    dueToday: [],
    overdue: [],
    upcoming: [],
    mastered: [],
    weak: [],
    solvedToday: [],
    flagged: [],
    todo: 0,
    paused,
    completedToday: 0,
    remaining: 0,
    workload: 0,
  };
  const dueNum = (i: RevisionItem) => (i.state.due === null ? 0 : dayNumber(i.state.due));

  for (const problem of ds.problems) {
    const entry = progress[problem.id];
    if (!entry) continue;

    let item: RevisionItem | null = null;
    if (entry.revision) {
      const state = entry.revision;
      let phase = phaseOf(state, today);
      // A pause protects the future, it never rewrites history. A revision that was already overdue when the pause began
      // keeps its true due date and stays overdue (frozen: paused days are not counted). Anything else whose date has
      // been reached during a pause just waits; normally the pause has already moved those dates forward.
      const frozen = paused !== null && phase === 'overdue' && dayNumber(state.due!) < dayNumber(paused.start);
      const onHold = paused !== null && (phase === 'due' || (phase === 'overdue' && !frozen));
      if (onHold) phase = 'upcoming';
      item = {
        problem, entry, state, phase, weak: isWeak(state), onHold, frozen,
        overdueDays: phase === 'overdue' ? daysOverdue(state, today, pauses) : 0,
        solvedDuringPause: state.solvedDuringPause === true,
      };
      if (state.attempts.some((a) => a.date === today)) hub.completedToday++;
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
  hub.overdue.sort((a, b) => b.overdueDays - a.overdueDays || dueNum(a) - dueNum(b)); // most overdue first
  hub.remaining = hub.dueToday.length + hub.overdue.length;
  hub.workload = hub.completedToday + hub.remaining;
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
  const { scheduled } = x;
  return {
    revision,
    date,
    result: result as RevisionResult,
    ...(typeof scheduled === 'string' && DATE_RE.test(scheduled) ? { scheduled } : {}),
  };
}

/** Returns a valid RevisionState, or null when `x` is not usable at all. */
export function coerceRevision(x: unknown): RevisionState | null {
  if (!isRecord(x)) return null;
  const { stage, due } = x;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 0) return null;
  const attempts = (Array.isArray(x.attempts) ? x.attempts : []).map(coerceAttempt).filter((a): a is RevisionAttempt => a !== null);
  const s = Math.min(stage, REVISION_STAGES);
  const flag = x.solvedDuringPause === true ? { solvedDuringPause: true } : {};
  if (due === null) return s >= REVISION_STAGES ? { stage: s, due: null, attempts, ...flag } : null; // only a finished problem has no due date
  if (typeof due === 'string' && DATE_RE.test(due)) return { stage: s, due, attempts, ...flag };
  return null;
}

// ---------- Pause ----------
// A pause protects the future. It never rewrites history.
//  - Revisions due on or after the day the pause starts are moved forward by the length of the pause, so nothing
//    piles up while you are away and the spacing between them stays the same.
//  - Revisions that were ALREADY overdue keep their true due date and stay overdue. Their overdue time is worked out
//    from that date minus the paused days (see daysOverdue), so a pause neither erases it nor adds to it.
//  - Attempts, stages, mastery and weak status are never touched, and neither are the dates recorded in past attempts.
export const MAX_PAUSE_DAYS = 120;

export const pauseLength = (p: RevisionPause) => dayNumber(p.end) - dayNumber(p.start) + 1;
export const resumeDate = (p: RevisionPause) => addDays(p.end, 1);

/** The pause that covers `today` (start and end are both paused days), or null. */
export function activePause(pauses: RevisionPause[], today: string): RevisionPause | null {
  const t = dayNumber(today);
  return pauses.find((p) => dayNumber(p.start) <= t && t <= dayNumber(p.end)) ?? null;
}

/** The date a problem solved today should count as "solved on" for its schedule: the resume date during a pause. */
export function revisionAnchor(pauses: RevisionPause[], today: string): string {
  const p = activePause(pauses, today);
  return p ? resumeDate(p) : today;
}

/** Why a pause from today until `until` (the last paused day) is not allowed, or null when it is fine. */
export function checkPause(pauses: RevisionPause[], until: string, today: string): string | null {
  if (!DATE_RE.test(until)) return 'Choose a valid date.';
  if (activePause(pauses, today)) return 'Revision is already paused.';
  const days = dayNumber(until) - dayNumber(today) + 1;
  if (days < 1) return 'Pick today or a later date.';
  if (days > MAX_PAUSE_DAYS) return `A pause can be at most ${MAX_PAUSE_DAYS} days.`;
  return null;
}

export interface PauseChange {
  pauses: RevisionPause[];
  /** Days to add to the due date of every revision that is due on or after `from` (negative = move them back). */
  shift: number;
  from: string;
}

/** Pause from today through `until` (inclusive). Call checkPause first. */
export function startPause(pauses: RevisionPause[], until: string, today: string): PauseChange {
  const p: RevisionPause = { start: today, end: until };
  return { pauses: [...pauses, p], shift: pauseLength(p), from: today };
}

/**
 * Resume early, today. The pause is cut to end yesterday and the days that will not be paused after all are taken
 * back off. Only revisions that the pause moved (all due on or after the planned resume date) move back; the ones
 * that were already overdue were never moved. Paused and resumed on the same day = the pause never happened.
 */
export function endPause(pauses: RevisionPause[], today: string): PauseChange | null {
  const p = activePause(pauses, today);
  if (!p) return null;
  const rest = pauses.filter((x) => x !== p);
  const from = resumeDate(p);
  const end = addDays(today, -1);
  if (dayNumber(end) < dayNumber(p.start)) return { pauses: rest, shift: -pauseLength(p), from };
  return { pauses: sortPauses([...rest, { start: p.start, end }]), shift: -(dayNumber(p.end) - dayNumber(end)), from };
}

/** Moves a revision's due date, but only when it is due on or after `from`. Mastered problems have no due date. */
export function shiftRevision(state: RevisionState, days: number, from: string): RevisionState {
  if (state.due === null || days === 0 || dayNumber(state.due) < dayNumber(from)) return state;
  return { ...state, due: addDays(state.due, days) };
}

const sortPauses = (ps: RevisionPause[]) => [...ps].sort((a, b) => dayNumber(a.start) - dayNumber(b.start));

const isPause = (x: unknown): x is RevisionPause =>
  isRecord(x) &&
  typeof x.start === 'string' &&
  typeof x.end === 'string' &&
  DATE_RE.test(x.start) &&
  DATE_RE.test(x.end) &&
  dayNumber(x.end) >= dayNumber(x.start);

/** Valid pauses only, oldest first. Anything that is not a valid { start, end } pair is dropped. */
export function coercePauses(x: unknown): RevisionPause[] {
  return Array.isArray(x) ? sortPauses(x.filter(isPause).map((p) => ({ start: p.start, end: p.end }))) : [];
}

// ---------- Consistency (streak) ----------
export interface Consistency {
  current: number;
  longest: number;
  revisedToday: boolean;
  /** Days in the last 7 (today included) with at least one revision result recorded. */
  last7: number;
}

/**
 * A revision day = at least one revision result (Forgot / Needed hint / Solved / Solved easily) recorded that day.
 * A streak is only broken by a day on which something WAS due and nothing was revised. Days on which nothing was due,
 * and paused days, are neutral: they neither count nor break it. Today never breaks it while it is still going.
 * A pause cannot repair a streak: the days a revision was overdue before the pause began stay missed days, because a
 * pause never moves the due date of a revision that was already overdue.
 */
export function revisionConsistency(progress: ProgressMap, pauses: RevisionPause[], today: string): Consistency {
  const t = dayNumber(today);
  const hit = new Set<number>(); // revision days
  const work = new Set<number>(); // days on which some revision was due and still not done
  for (const e of Object.values(progress)) {
    const r = e.revision;
    if (!r) continue;
    for (const a of r.attempts) {
      const d = dayNumber(a.date);
      if (d > t) continue;
      hit.add(d);
      if (a.scheduled) for (let x = Math.max(dayNumber(a.scheduled), d - 4000); x < d; x++) work.add(x);
    }
    if (r.due !== null) for (let x = Math.max(dayNumber(r.due), t - 4000); x <= t; x++) work.add(x);
  }
  const paused = new Set<number>();
  for (const p of pauses) for (let x = dayNumber(p.start); x <= Math.min(dayNumber(p.end), t); x++) paused.add(x);

  let last7 = 0;
  for (let x = t - 6; x <= t; x++) if (hit.has(x)) last7++;
  const revisedToday = hit.has(t);
  if (hit.size === 0) return { current: 0, longest: 0, revisedToday, last7 };

  // The timeline without neutral days: H = revised, M = something was due and nothing was revised.
  const seq: ('H' | 'M')[] = [];
  for (let x = Math.min(...hit); x <= t; x++) {
    if (hit.has(x)) seq.push('H');
    else if (!paused.has(x) && work.has(x)) seq.push('M');
  }
  let longest = 0;
  let run = 0;
  for (const c of seq) {
    run = c === 'H' ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  let i = seq.length - 1;
  if (!revisedToday && !paused.has(t) && work.has(t)) i--; // today is still going: not a miss yet
  let current = 0;
  while (i >= 0 && seq[i] === 'H') {
    current++;
    i--;
  }
  return { current, longest, revisedToday, last7 };
}

// ---------- Revision session ----------
export type SessionKind = 'due' | 'weak';
/** overdue / due = a real revision (recorded and rescheduled); practice = weak-problem self-check, nothing is saved. */
export type SessionMode = 'overdue' | 'due' | 'practice';

export interface SessionEntry {
  item: RevisionItem;
  mode: SessionMode;
}

/**
 * The fixed queue for a session, in a deterministic order.
 * due  : the real revision session. Overdue first (most overdue first), then due today (sheet order for ties).
 *        Future problems are never included.
 * weak : self-check practice over the weak problems, the ones with the most Forgot / Needed hint first, due or not.
 *        Every entry is 'practice': nothing is recorded, so weak practice can never change a schedule, stage or
 *        history. A weak problem that is also due gets its real revision in the 'due' session.
 */
export function buildSession(hub: RevisionHub, kind: SessionKind): SessionEntry[] {
  if (hub.paused) return [];
  if (kind === 'due') {
    return [
      ...hub.overdue.map((item): SessionEntry => ({ item, mode: 'overdue' })),
      ...hub.dueToday.map((item): SessionEntry => ({ item, mode: 'due' })),
    ];
  }
  return hub.weak.map((item): SessionEntry => ({ item, mode: 'practice' }));
}

// ---------- Mastered, by topic ----------
export interface TopicCount {
  stepNo: number;
  stepTitle: string;
  count: number;
}

export function masteredByTopic(items: RevisionItem[]): TopicCount[] {
  const byStep = new Map<number, TopicCount>();
  for (const { problem } of items) {
    const cur = byStep.get(problem.stepNo) ?? { stepNo: problem.stepNo, stepTitle: problem.stepTitle, count: 0 };
    cur.count++;
    byStep.set(problem.stepNo, cur);
  }
  return [...byStep.values()].sort((a, b) => b.count - a.count || a.stepNo - b.stepNo);
}
