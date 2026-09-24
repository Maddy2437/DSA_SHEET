import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProblemProgress, ProgressMap, RevisionAttempt, RevisionPause, RevisionResult, RevisionState } from '../types';
import { dataset } from '../utils/dataset';
import { addDays, todayKey } from '../utils/dates';
import { buildExport, loadStore, ops, parseImport, saveProgress } from '../utils/progress';
import {
  applyRevision, buildRevisionHub, buildSession, checkPause, daysOverdue, endPause, isMastered, isWeak,
  newRevisionState, pausedDaysBetween, phaseOf, revisionAnchor, revisionConsistency, startPause,
} from '../utils/revision';
import { STORAGE_KEYS } from '../utils/storage';
import { cardOf, entry, renderApp, seedProgress, storedProgress } from './helpers';

const T = todayKey();
const d = (n: number) => addDays(T, n);
const P = dataset.problems;

const att = (revision: number, result: RevisionResult, date: string, scheduled = date): RevisionAttempt => ({ revision, date, result, scheduled });
const solvedEntry = (revision: RevisionState, over: Partial<ProblemProgress> = {}) =>
  entry({ status: 'solved', solvedDate: '2026-01-01', revision, ...over });
const due = (stage: number, dueDate: string | null, attempts: RevisionAttempt[] = []): RevisionState => ({ stage, due: dueDate, attempts });

// Applies a pause exactly the way the app does: shift what is due from the pause start on, record the pause.
function pauseOn(map: ProgressMap, pauses: RevisionPause[], until: string, today: string) {
  const c = startPause(pauses, until, today);
  return { map: ops.shiftRevisions(map, c.shift, c.from), pauses: c.pauses };
}

function seedDoc(entries: ProgressMap, pauses: RevisionPause[] = []) {
  window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries, ...(pauses.length ? { pauses } : {}) }));
}
const storedDoc = () => JSON.parse(window.localStorage.getItem(STORAGE_KEYS.progress)!);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const storedSettings = () => JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings)!);

// ======================================================================================================
describe('pause: schedule shifting ("a pause protects the future, it never rewrites history")', () => {
  it('moves revisions due on or after the pause start forward by the pause length, and does NOT move overdue ones', () => {
    const map: ProgressMap = {
      a: solvedEntry(due(1, '2026-09-25')), // due on the day the pause starts
      b: solvedEntry(due(2, '2026-09-28')),
      late: solvedEntry(due(1, '2026-09-22')), // already overdue
    };
    const { map: after, pauses } = pauseOn(map, [], '2026-09-30', '2026-09-25');
    expect(pauses).toEqual([{ start: '2026-09-25', end: '2026-09-30' }]);
    expect(after.a.revision!.due).toBe('2026-10-01'); // the "Next revision = Oct 1" example (6 days)
    expect(after.b.revision!.due).toBe('2026-10-04');
    expect(after.late).toBe(map.late); // untouched: the very same entry, original due date and all
    expect(after.late.revision!.due).toBe('2026-09-22');
    // The spacing between future revisions is unchanged (a and b were 3 days apart).
    expect(daysBetween(after.a.revision!.due!, after.b.revision!.due!)).toBe(3);
  });

  it('paused days never create new overdue work; the hub only lists what was already overdue, frozen', () => {
    const ds = { ...dataset, problems: dataset.problems.slice(0, 3) };
    const [ia, ib, ic] = ds.problems.map((p) => p.id);
    const { map, pauses } = pauseOn(
      { [ia]: solvedEntry(due(1, '2026-09-25')), [ib]: solvedEntry(due(1, '2026-09-27')), [ic]: solvedEntry(due(2, '2026-09-10')) },
      [], '2026-09-30', '2026-09-25',
    );
    for (const day of ['2026-09-25', '2026-09-27', '2026-09-30']) {
      const hub = buildRevisionHub(ds, map, day, pauses);
      expect(hub.paused).toEqual(pauses[0]);
      expect(hub.dueToday).toHaveLength(0);
      expect(hub.overdue.map((i) => i.problem.id)).toEqual([ic]); // only the one that was already overdue
      expect(hub.overdue[0]).toMatchObject({ frozen: true, phase: 'overdue', overdueDays: 15 }); // Sep 10..24, frozen from the 25th
      expect(hub.upcoming.map((i) => i.problem.id).sort()).toEqual([ia, ib].sort());
      expect(buildSession(hub, 'due')).toEqual([]); // no session while paused
      expect(buildSession(hub, 'weak')).toEqual([]);
    }
    // The day revision resumes: the Sep 25 revision is due today (not overdue), the Sep 27 one still has 2 days to go.
    const hub = buildRevisionHub(ds, map, '2026-10-01', pauses);
    expect(hub.paused).toBeNull();
    expect(hub.dueToday.map((i) => i.problem.id)).toEqual([ia]);
    expect(hub.upcoming.map((i) => i.problem.id)).toEqual([ib]);
    expect(hub.overdue.map((i) => [i.problem.id, i.frozen])).toEqual([[ic, false]]);
  });

  it('an already-overdue revision keeps its true due date and its overdue time never grows while paused', () => {
    const before = due(1, '2026-09-22'); // 2 days overdue on Sep 24, the day the pause starts
    const { map, pauses } = pauseOn({ a: solvedEntry(before) }, [], '2026-09-30', '2026-09-24'); // 7 days
    const after = map.a.revision!;
    expect(after.due).toBe('2026-09-22'); // NOT rewritten
    expect(after).toEqual(before);
    for (const [day, overdue] of [['2026-09-24', 2], ['2026-09-27', 2], ['2026-09-30', 2], ['2026-10-01', 2], ['2026-10-03', 4]] as const) {
      expect(phaseOf(after, day)).toBe('overdue'); // overdue the whole time
      expect(daysOverdue(after, day, pauses)).toBe(overdue); // 2 while paused and on resume day, then it grows again
    }
    expect(daysOverdue(after, '2026-09-27')).toBe(5); // without the pause information it would look 5 days overdue
  });

  it('pausedDaysBetween counts paused calendar days in [from, to)', () => {
    const ps: RevisionPause[] = [{ start: '2026-09-10', end: '2026-09-12' }, { start: '2026-09-20', end: '2026-09-25' }];
    expect(pausedDaysBetween(ps, '2026-09-01', '2026-09-30')).toBe(9);
    expect(pausedDaysBetween(ps, '2026-09-11', '2026-09-21')).toBe(3); // 11, 12 and 20
    expect(pausedDaysBetween(ps, '2026-09-12', '2026-09-12')).toBe(0); // empty range
    expect(pausedDaysBetween(ps, '2026-09-25', '2026-09-26')).toBe(1); // the end day is paused
    expect(pausedDaysBetween([], '2026-09-01', '2026-09-30')).toBe(0);
    // month and year boundaries
    expect(pausedDaysBetween([{ start: '2026-12-30', end: '2027-01-02' }], '2026-12-01', '2027-02-01')).toBe(4);
  });

  it('history, stages, mastery, weak status, counters and past scheduled dates are exactly the same after a pause', () => {
    const weak = due(2, '2026-09-25', [att(1, 'solved', '2026-09-02'), att(2, 'forgot', '2026-09-05', '2026-09-03'), att(2, 'hint', '2026-09-06')]);
    const mastered: RevisionState = { stage: 5, due: null, attempts: [att(4, 'solved', '2026-08-01'), att(5, 'easy', '2026-08-20')] };
    const overdue = due(1, '2026-09-20', [att(1, 'solved', '2026-09-10')]);
    const map: ProgressMap = {
      w: solvedEntry(weak, { revisionCount: 3, lastRevised: '2026-09-06', notes: 'n', important: true, needsRevision: true }),
      m: solvedEntry(mastered),
      o: solvedEntry(overdue),
    };
    const { map: after } = pauseOn(map, [], '2026-10-10', '2026-09-24');
    const w = after.w.revision!;
    expect(w.attempts).toEqual(weak.attempts); // history untouched, scheduled: '2026-09-03' included
    expect(w.attempts[1].scheduled).toBe('2026-09-03');
    expect(w.stage).toBe(weak.stage);
    expect(isWeak(w)).toBe(true);
    expect(after.w).toMatchObject({ revisionCount: 3, lastRevised: '2026-09-06', notes: 'n', important: true, needsRevision: true, status: 'solved' });
    expect(after.m).toBe(map.m); // mastered entries are not even touched
    expect(isMastered(after.m.revision!.attempts)).toBe(true);
    expect(after.o).toBe(map.o); // overdue entries are not touched either
  });

  it('after resuming, normal scheduling carries on, and recording an overdue revision keeps its TRUE scheduled date', () => {
    const { map, pauses } = pauseOn({ a: solvedEntry(due(1, '2026-09-25')), x: solvedEntry(due(1, '2026-09-21')) }, [], '2026-09-30', '2026-09-25');
    const done = ops.recordRevision(map, 'a', 'solved', '2026-10-01');
    expect(done.a.revision).toMatchObject({ stage: 2, due: '2026-10-05' }); // R3 = 4 days after doing R2, as always
    expect(done.a.revision!.attempts.at(-1)).toMatchObject({ date: '2026-10-01', scheduled: '2026-10-01', result: 'solved' });
    const late = ops.recordRevision(map, 'x', 'solved', '2026-10-01');
    expect(late.x.revision!.attempts.at(-1)).toMatchObject({ date: '2026-10-01', scheduled: '2026-09-21' }); // not Sep 26
    expect(pauses).toHaveLength(1);
  });
});

describe('pause: the exact scenario (a pause must not erase missed days or repair a streak)', () => {
  // Sep 14-20: 7 revision days in a row. X was due on Sep 21 and was missed; Sep 22 missed; pause on Sep 23 for 5 days.
  const ds = { ...dataset, problems: dataset.problems.slice(0, 3) };
  const [iw, ix, iy] = ds.problems.map((p) => p.id);
  const streakAttempts = ['14', '15', '16', '17', '18', '19', '20'].map((n) => att(1, 'solved', `2026-09-${n}`));
  const base: ProgressMap = {
    [iw]: solvedEntry(due(1, '2026-10-20', streakAttempts)), // the revisions that made the streak
    [ix]: solvedEntry(due(1, '2026-09-21')), // due Sep 21, never done
    [iy]: solvedEntry(due(1, '2026-09-25')), // a future revision
  };
  const streak = (m: ProgressMap, pauses: RevisionPause[], day: string) => revisionConsistency(m, pauses, day);

  it('before the pause: overdue by 2, streak already broken', () => {
    const hub = buildRevisionHub(ds, base, '2026-09-23');
    expect(hub.overdue.map((i) => [i.problem.id, i.overdueDays])).toEqual([[ix, 2]]);
    expect(streak(base, [], '2026-09-23')).toMatchObject({ current: 0, longest: 7 });
  });

  it('during and after the pause: X keeps its Sep 21 due date, stays overdue, and the streak stays broken', () => {
    const { map, pauses } = pauseOn(base, [], '2026-09-27', '2026-09-23'); // 5 days: Sep 23-27
    expect(map[ix].revision!.due).toBe('2026-09-21'); // NOT rewritten to Sep 26
    expect(map[iy].revision!.due).toBe('2026-09-30'); // the future one moved by 5
    for (const day of ['2026-09-23', '2026-09-24', '2026-09-27']) {
      const hub = buildRevisionHub(ds, map, day, pauses);
      expect(hub.overdue.map((i) => [i.problem.id, i.frozen, i.overdueDays])).toEqual([[ix, true, 2]]); // count is 1, not 0; no extra days
      expect(hub.remaining).toBe(1);
      expect(streak(map, pauses, day)).toMatchObject({ current: 0, longest: 7 }); // Sep 21 and 22 are still missed days
    }
    const resumeDay = buildRevisionHub(ds, map, '2026-09-28', pauses);
    expect(resumeDay.overdue.map((i) => [i.problem.id, i.frozen, i.overdueDays])).toEqual([[ix, false, 2]]); // still 2, not 7
    expect(streak(map, pauses, '2026-09-28')).toMatchObject({ current: 0, longest: 7 });
    expect(buildRevisionHub(ds, map, '2026-09-30', pauses).overdue[0].overdueDays).toBe(4); // it grows again only after resuming
  });

  it('the first real revision after resuming starts a NEW streak of 1, and the next day makes 2', () => {
    const { map, pauses } = pauseOn(base, [], '2026-09-27', '2026-09-23');
    const first = ops.recordRevision(map, ix, 'solved', '2026-09-28');
    expect(first[ix].revision!.attempts.at(-1)).toMatchObject({ date: '2026-09-28', scheduled: '2026-09-21' });
    expect(streak(first, pauses, '2026-09-28')).toMatchObject({ current: 1, longest: 7, revisedToday: true });
    const second = ops.recordRevision(first, iy, 'easy', '2026-09-30'); // Y's shifted date; nothing was due on the 29th
    expect(streak(second, pauses, '2026-09-30')).toMatchObject({ current: 2 }); // a day with nothing due does not break it
  });

  it('resuming early keeps the same truth: X still due Sep 21, streak still 0', () => {
    const p1 = pauseOn(base, [], '2026-09-27', '2026-09-23');
    const back = endPause(p1.pauses, '2026-09-25')!; // resume on the 25th
    const map = ops.shiftRevisions(p1.map, back.shift, back.from);
    expect(map[ix].revision!.due).toBe('2026-09-21');
    expect(map[iy].revision!.due).toBe('2026-09-27'); // 25 + the 2 days actually paused
    expect(streak(map, back.pauses, '2026-09-25')).toMatchObject({ current: 0, longest: 7 });
    // Sep 21, 22, 23 and 24 have passed; the 23rd and 24th were paused (the pause now ends on the 24th), so 2 days overdue.
    expect(daysOverdue(map[ix].revision!, '2026-09-25', back.pauses)).toBe(2);
  });

  it('a pause taken with NO missed days keeps the streak (paused days are neutral)', () => {
    const clean: ProgressMap = { [iw]: solvedEntry(due(1, '2026-09-21', streakAttempts)) }; // due Sep 21, nothing missed yet
    const { map, pauses } = pauseOn(clean, [], '2026-09-27', '2026-09-21'); // pause starts on the day it is due
    expect(map[iw].revision!.due).toBe('2026-09-28');
    for (const day of ['2026-09-21', '2026-09-25', '2026-09-28']) expect(streak(map, pauses, day)).toMatchObject({ current: 7 });
    const back = ops.recordRevision(map, iw, 'solved', '2026-09-28');
    expect(streak(back, pauses, '2026-09-28')).toMatchObject({ current: 8 });
  });
});

describe('pause: resume early', () => {
  it('cuts the pause short: what the pause moved comes back, what it never moved stays put', () => {
    const map: ProgressMap = { a: solvedEntry(due(1, '2026-09-25')), late: solvedEntry(due(1, '2026-09-20')) };
    const p1 = pauseOn(map, [], '2026-09-30', '2026-09-25'); // a -> Oct 1, late untouched
    const back = endPause(p1.pauses, '2026-09-27')!; // resume on the 27th: only Sep 25 and 26 were paused
    expect(back).toMatchObject({ shift: -4, from: '2026-10-01', pauses: [{ start: '2026-09-25', end: '2026-09-26' }] });
    const resumed = ops.shiftRevisions(p1.map, back.shift, back.from);
    expect(resumed.a.revision!.due).toBe('2026-09-27'); // 25 + the 2 days actually paused
    expect(resumed.late.revision!.due).toBe('2026-09-20');
    expect(buildRevisionHub(dataset, { [P[0].id]: resumed.a }, '2026-09-27', back.pauses).paused).toBeNull();
    // overdue days on the 27th: the 20th..24th, and the 25th-26th were paused
    expect(daysOverdue(resumed.late.revision!, '2026-09-27', back.pauses)).toBe(5 - 0);
  });

  it('pausing and resuming on the same day changes nothing at all', () => {
    const map: ProgressMap = { a: solvedEntry(due(1, '2026-09-25')), b: solvedEntry(due(3, '2026-09-20')) };
    const p1 = pauseOn(map, [], '2026-10-05', '2026-09-25');
    const back = endPause(p1.pauses, '2026-09-25')!;
    expect(back.pauses).toEqual([]);
    const resumed = ops.shiftRevisions(p1.map, back.shift, back.from);
    expect(resumed.a.revision!.due).toBe('2026-09-25');
    expect(resumed.b.revision!.due).toBe('2026-09-20');
  });

  it('a problem solved during the pause is re-anchored correctly when you resume early', () => {
    let pauses = pauseOn({}, [], '2026-09-30', '2026-09-25').pauses;
    let map = ops.setStatus({}, 'x', 'solved', '2026-09-27', revisionAnchor(pauses, '2026-09-27'));
    expect(map.x.revision!.due).toBe('2026-10-02'); // resume date Oct 1 + 1
    const back = endPause(pauses, '2026-09-28')!; // resume on the 28th
    pauses = back.pauses;
    map = ops.shiftRevisions(map, back.shift, back.from);
    expect(map.x.revision!.due).toBe('2026-09-29'); // resume date Sep 28 + 1
    expect(map.x.revision!.solvedDuringPause).toBe(true); // and it is still a problem that was solved during a pause
  });

  it('there is nothing to resume when not paused', () => {
    expect(endPause([], '2026-09-27')).toBeNull();
    expect(endPause([{ start: '2026-09-01', end: '2026-09-05' }], '2026-09-27')).toBeNull(); // an old, finished pause
  });
});

describe('pause: problems solved during a pause', () => {
  it('still appear in Solved today, are labelled, and start their schedule after the pause (R1 = Oct 2, R2 = Oct 4)', () => {
    const pauses: RevisionPause[] = [{ start: '2026-09-25', end: '2026-09-30' }];
    const map = ops.setStatus({}, 'x', 'solved', '2026-09-27', revisionAnchor(pauses, '2026-09-27'));
    expect(map.x.solvedDate).toBe('2026-09-27'); // real solve date kept
    expect(map.x.revision).toEqual({ stage: 0, due: '2026-10-02', attempts: [], solvedDuringPause: true });

    const ds = { ...dataset, problems: [{ ...dataset.problems[0], id: 'x' }] };
    const hub = buildRevisionHub(ds, map, '2026-09-27', pauses);
    expect(hub.solvedToday.map((s) => s.problem.id)).toEqual(['x']);
    expect(hub.solvedToday[0].item?.solvedDuringPause).toBe(true);
    expect(hub.dueToday).toHaveLength(0); // nothing due inside the pause

    const r1 = ops.recordRevision(map, 'x', 'solved', '2026-10-02');
    expect(r1.x.revision).toMatchObject({ due: '2026-10-04', solvedDuringPause: true }); // R2, and the label survives
  });

  it('a problem solved EARLIER on the pause-start day is shifted like any other but is NOT labelled "during pause"', () => {
    let m = ops.setStatus({}, 'early', 'solved', '2026-09-25'); // solved before the pause was activated
    expect(m.early.revision).toEqual({ stage: 0, due: '2026-09-26', attempts: [] });
    const { map, pauses } = pauseOn(m, [], '2026-09-30', '2026-09-25');
    m = ops.setStatus(map, 'late', 'solved', '2026-09-25', revisionAnchor(pauses, '2026-09-25')); // solved after it
    expect(m.early.revision!.due).toBe('2026-10-02');
    expect(m.late.revision!.due).toBe('2026-10-02'); // same date...
    expect(m.early.revision!.solvedDuringPause).toBeUndefined(); // ...but only this one was solved during the pause
    expect(m.late.revision!.solvedDuringPause).toBe(true);
    const ds = { ...dataset, problems: ['early', 'late'].map((id) => ({ ...dataset.problems[0], id })) };
    const hub = buildRevisionHub(ds, m, '2026-09-25', pauses);
    expect(Object.fromEntries(hub.solvedToday.map((s) => [s.problem.id, s.item?.solvedDuringPause]))).toEqual({ early: false, late: true });
  });

  it('outside a pause the anchor is simply today and nothing is flagged', () => {
    expect(revisionAnchor([], '2026-09-27')).toBe('2026-09-27');
    expect(revisionAnchor([{ start: '2026-09-01', end: '2026-09-05' }], '2026-09-27')).toBe('2026-09-27');
    expect(ops.setStatus({}, 'x', 'solved', '2026-09-27').x.revision).toEqual({ stage: 0, due: '2026-09-28', attempts: [] });
  });
});

describe('pause: validation', () => {
  it('only allows a pause from today for 1 to 120 days, and not while already paused', () => {
    expect(checkPause([], '2026-09-30', '2026-09-25')).toBeNull();
    expect(checkPause([], '2026-09-25', '2026-09-25')).toBeNull(); // a one-day pause
    expect(checkPause([], '2026-09-24', '2026-09-25')).toMatch(/today or a later date/);
    expect(checkPause([], '', '2026-09-25')).toMatch(/valid date/);
    expect(checkPause([], '2027-09-25', '2026-09-25')).toMatch(/at most 120 days/);
    expect(checkPause([{ start: '2026-09-25', end: '2026-09-30' }], '2026-10-05', '2026-09-27')).toMatch(/already paused/);
    expect(checkPause([{ start: '2026-09-01', end: '2026-09-05' }], '2026-10-05', '2026-09-27')).toBeNull(); // old pause is over
  });
});

// ======================================================================================================
describe('consistency (streak)', () => {
  const state = (dueDate: string | null, attempts: RevisionAttempt[]): RevisionState => ({ stage: 2, due: dueDate, attempts });
  const one = (dueDate: string | null, attempts: RevisionAttempt[]): ProgressMap => ({ a: solvedEntry(state(dueDate, attempts)) });

  it('counts real revision results, including Forgot and Needed hint', () => {
    const map = one('2026-09-30', [att(1, 'forgot', '2026-09-21'), att(1, 'hint', '2026-09-22'), att(1, 'solved', '2026-09-23')]);
    expect(revisionConsistency(map, [], '2026-09-23')).toMatchObject({ current: 3, longest: 3, revisedToday: true, last7: 3 });
  });

  it('a day on which nothing was due does not break the streak', () => {
    const map = one('2026-09-25', [att(1, 'solved', '2026-09-20'), att(2, 'solved', '2026-09-22')]); // nothing due on the 21st
    expect(revisionConsistency(map, [], '2026-09-22')).toMatchObject({ current: 2, longest: 2 });
  });

  it('a missed ACTIVE day (something was due, nothing revised) breaks it', () => {
    const map = one('2026-09-21', [att(1, 'solved', '2026-09-20')]); // due the 21st, never done
    expect(revisionConsistency(map, [], '2026-09-23')).toMatchObject({ current: 0, longest: 1, revisedToday: false });
    // ...and so does doing an overdue revision late: the days it waited were missed days.
    const late = one('2026-09-30', [att(1, 'solved', '2026-09-20'), att(2, 'solved', '2026-09-23', '2026-09-21')]);
    expect(revisionConsistency(late, [], '2026-09-23')).toMatchObject({ current: 1, longest: 1 });
  });

  it('today never breaks it while it is still going', () => {
    const map = one('2026-09-23', [att(1, 'solved', '2026-09-22')]); // due today, not done yet
    expect(revisionConsistency(map, [], '2026-09-23')).toMatchObject({ current: 1, revisedToday: false });
    expect(revisionConsistency(map, [], '2026-09-24').current).toBe(0); // but a whole missed day does
  });

  it('is preserved through a pause: paused days neither count nor break it', () => {
    const week = ['17', '18', '19', '20', '21', '22', '23'].map((n) => att(1, 'solved', `2026-09-${n}`));
    // 10-day pause Sep 24 - Oct 3; the one scheduled revision moved from Sep 24 to Oct 4.
    const paused = pauseOn(one('2026-09-24', week), [], '2026-10-03', '2026-09-24');
    expect(paused.map.a.revision!.due).toBe('2026-10-04');
    expect(revisionConsistency(paused.map, paused.pauses, '2026-09-28')).toMatchObject({ current: 7, longest: 7 }); // during
    expect(revisionConsistency(paused.map, paused.pauses, '2026-10-04')).toMatchObject({ current: 7, longest: 7 }); // resume day
    const back = ops.recordRevision(paused.map, 'a', 'solved', '2026-10-04');
    expect(revisionConsistency(back, paused.pauses, '2026-10-04')).toMatchObject({ current: 8, longest: 8 }); // and it goes on
    // Without the pause the same 10 days would have been missed days:
    expect(revisionConsistency(one('2026-09-24', week), [], '2026-10-04').current).toBe(0);
  });

  it('the days an overdue revision waited stay missed days, and last-7 is a plain count of revision days', () => {
    // Revision 1 (done on the 10th) was due on the 15th but only done on the 22nd: the 15th to the 21st were missed.
    const map = one('2026-09-30', [att(1, 'solved', '2026-09-10'), att(2, 'solved', '2026-09-22', '2026-09-15'), att(3, 'solved', '2026-09-23')]);
    const r = revisionConsistency(map, [], '2026-09-23');
    expect(r).toMatchObject({ last7: 2, current: 2, longest: 2, revisedToday: true });
    expect(revisionConsistency({}, [], '2026-09-23')).toEqual({ current: 0, longest: 0, revisedToday: false, last7: 0 });
  });
});

// ======================================================================================================
describe('Revision session (UI)', () => {
  const start = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: 'Start Revision Session' }));
  const current = () => document.querySelector('[data-session-problem]')?.getAttribute('data-session-problem');
  const pick = (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(screen.getByRole('button', { name }));

  const [pE, pD, pC, pA, pB] = [P[0], P[1], P[3], P[5], P[8]];
  const seedMixed = () =>
    seedProgress({
      [pB.id]: solvedEntry(due(1, d(-3))), // 3 days overdue
      [pA.id]: solvedEntry(due(2, d(-1))), // 1 day overdue
      [pD.id]: solvedEntry(due(1, d(0))), // due today
      [pC.id]: solvedEntry(due(3, d(0))), // due today
      [pE.id]: solvedEntry(due(1, d(2))), // future: must not be in the session
    });

  it('offers the session only when something is due or overdue', () => {
    seedProgress({ [pE.id]: solvedEntry(due(1, d(2))) });
    renderApp('/revision');
    expect(screen.queryByRole('button', { name: 'Start Revision Session' })).toBeNull();
    expect(screen.getByTestId('today-status')).toHaveTextContent('Nothing due today');
  });

  it('runs overdue first (most overdue first), then due today in sheet order, and leaves future problems out', async () => {
    const user = userEvent.setup();
    seedMixed();
    renderApp('/revision');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('2');
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('2');
    await start(user);

    const order: (string | null | undefined)[] = [];
    const tags: string[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(current());
      tags.push(within(document.querySelector('[data-session-problem]') as HTMLElement).getByText(/^(Overdue by|Due today)/).textContent!);
      expect(screen.getByTestId('session-position')).toHaveTextContent(`Problem ${i + 1} of 4`); // the denominator is fixed
      await pick(user, /^Solved\b(?! easily)/);
    }
    expect(order).toEqual([pB.id, pA.id, pD.id, pC.id]);
    expect(tags).toEqual(['Overdue by 3 days', 'Overdue by 1 day', 'Due today', 'Due today']);
    expect(order).not.toContain(pE.id);
    expect(new Set(order).size).toBe(4); // nobody is asked twice
  });

  it('shows name, topic, subtopic, difficulty, revision X/5 and fixed progress for the current problem', async () => {
    const user = userEvent.setup();
    seedMixed();
    renderApp('/revision');
    await start(user);
    const card = within(document.querySelector('[data-session-problem]') as HTMLElement);
    expect(card.getByRole('heading', { name: pB.title })).toBeInTheDocument();
    expect(card.getByText(pB.subTitle)).toBeInTheDocument();
    expect(card.getByText('Revision 2/5')).toBeInTheDocument(); // stage 1 done, so revision 2 is next
    expect(screen.getByTestId('session-position')).toHaveTextContent('Problem 1 of 4');
    expect(screen.getByTestId('session-done-count')).toHaveTextContent('0 / 4 done');
    expect(card.getByText('Can you solve this problem without looking at the solution?')).toBeInTheDocument();
    expect(card.queryByRole('link')).toBeNull(); // links stay hidden until you ask
    await user.click(card.getByRole('button', { name: 'Reveal Problem' }));
    expect(card.getAllByRole('link').length).toBeGreaterThan(0);
    await pick(user, /^Solved easily/);
    expect(screen.getByTestId('session-done-count')).toHaveTextContent('1 / 4 done');
    expect(current()).toBe(pA.id);
  });

  it('records all four outcomes through the normal revision logic and reschedules each correctly', async () => {
    const user = userEvent.setup();
    const [a, b, c, e] = [P[10], P[11], P[12], P[13]];
    seedProgress(Object.fromEntries([a, b, c, e].map((p) => [p.id, solvedEntry(due(1, d(0)))])));
    renderApp('/revision');
    await start(user);
    await pick(user, /^Forgot/);
    await pick(user, /^Needed hint/);
    await pick(user, /^Solved\b(?! easily)/);
    await pick(user, /^Solved easily/);

    const s = storedProgress();
    expect(s[a.id].revision).toMatchObject({ stage: 1, due: d(1) }); // Forgot: same revision again tomorrow
    expect(s[b.id].revision).toMatchObject({ stage: 1, due: d(3) }); // Needed hint: same revision in 3 days
    expect(s[c.id].revision).toMatchObject({ stage: 2, due: d(4) }); // Solved: next revision, normal gap
    expect(s[e.id].revision).toMatchObject({ stage: 2, due: d(4) }); // Solved easily: next revision, normal gap
    for (const [p, result] of [[a, 'forgot'], [b, 'hint'], [c, 'solved'], [e, 'easy']] as const) {
      expect(s[p.id].revision!.attempts).toEqual([{ revision: 2, date: T, result, scheduled: d(0) }]); // history recorded
      expect(s[p.id]).toMatchObject({ revisionCount: 1, lastRevised: T });
    }
  });

  it('ends with a summary for the whole session and goes back to the hub, where nothing is left due', async () => {
    const user = userEvent.setup();
    const ids = [P[10], P[11], P[12], P[13], P[14]];
    seedProgress(Object.fromEntries(ids.map((p, i) => [p.id, solvedEntry(due(1, d(i === 0 ? -2 : 0)))])));
    renderApp('/revision');
    await start(user);
    for (const name of [/^Forgot/, /^Needed hint/, /^Solved\b(?! easily)/, /^Solved easily/, /^Solved easily/]) await pick(user, name);

    expect(screen.getByRole('heading', { name: 'Revision Complete' })).toBeInTheDocument();
    expect(screen.getByTestId('session-completed')).toHaveTextContent('5 / 5 completed');
    expect(screen.getByTestId('session-forgot')).toHaveTextContent('1');
    expect(screen.getByTestId('session-hint')).toHaveTextContent('1');
    expect(screen.getByTestId('session-solved')).toHaveTextContent('1');
    expect(screen.getByTestId('session-easy')).toHaveTextContent('2');
    expect(screen.queryByText(/Problem \d of/)).toBeNull(); // no sixth problem

    await user.click(screen.getByRole('button', { name: 'Back to Revision Hub' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Revision Hub' })).toBeInTheDocument();
    expect(screen.getByTestId('today-status')).toHaveTextContent('All done for today');
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('5 / 5 done');
    expect(screen.getByTestId('hub-completed')).toHaveTextContent('5');
  });

  it('keeps the result of each problem if you leave halfway, and a refresh loses nothing', async () => {
    const user = userEvent.setup();
    const [a, b, c] = [P[10], P[11], P[12]];
    seedProgress(Object.fromEntries([a, b, c].map((p) => [p.id, solvedEntry(due(1, d(0)))])));
    const first = renderApp('/revision');
    await start(user);
    await pick(user, /^Solved easily/);
    await user.click(screen.getByRole('button', { name: /Exit session/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Revision Hub' })).toBeInTheDocument();
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 / 3 done'); // the fixed total of the day, 1 done
    first.unmount(); // = browser refresh
    renderApp('/revision');
    expect(storedProgress()[a.id].revision).toMatchObject({ stage: 2 });
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 / 3 done');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('2');
    await start(user);
    expect(screen.getByTestId('session-position')).toHaveTextContent('Problem 1 of 2'); // only what is still due
    expect([b.id, c.id]).toContain(current());
  });

  const otherTab = (edit: (doc: any) => void) => {
    const doc = storedDoc();
    edit(doc);
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(doc));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.progress }));
    });
  };

  it('a result that cannot be saved is NOT counted, is reported, and the problem can be skipped', async () => {
    const user = userEvent.setup();
    const [a, b] = [P[10], P[11]];
    seedProgress({ [a.id]: solvedEntry(due(1, d(0))), [b.id]: solvedEntry(due(1, d(0))) });
    renderApp('/revision');
    await start(user);
    expect(current()).toBe(a.id);
    // Meanwhile, in another tab, `a` was already revised.
    otherTab((doc) => (doc.entries[a.id].revision = due(2, d(4), [att(2, 'solved', T, d(0))])));

    await pick(user, /^Solved\b(?! easily)/);
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be saved, so it was not counted/);
    expect(screen.getByTestId('session-position')).toHaveTextContent('Problem 1 of 2'); // did not advance
    expect(screen.getByTestId('session-done-count')).toHaveTextContent('0 / 2 done'); // and was not counted
    expect(storedProgress()[a.id].revision!.attempts).toHaveLength(1); // no second attempt was written

    await user.click(screen.getByRole('button', { name: 'Skip this problem' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('session-position')).toHaveTextContent('Problem 2 of 2');
    await pick(user, /^Solved easily/);
    expect(screen.getByTestId('session-completed')).toHaveTextContent('1 / 2 completed'); // not 2 / 2
    expect(screen.getByTestId('session-skipped')).toHaveTextContent('1 problem skipped');
    expect(screen.getByTestId('session-easy')).toHaveTextContent('1');
    expect(storedProgress()[b.id].revision).toMatchObject({ stage: 2 });
  });

  it('if revision gets paused elsewhere mid-session, nothing more is saved or counted', async () => {
    const user = userEvent.setup();
    const [a, b] = [P[10], P[11]];
    seedProgress({ [a.id]: solvedEntry(due(1, d(0))), [b.id]: solvedEntry(due(1, d(0))) });
    renderApp('/revision');
    await start(user);
    otherTab((doc) => (doc.pauses = [{ start: T, end: d(2) }]));
    await pick(user, /^Forgot/);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('session-done-count')).toHaveTextContent('0 / 2 done');
    expect(storedProgress()[a.id].revision!.attempts).toHaveLength(0);
  });
});

// ======================================================================================================
describe('Weak problem practice (self-check only)', () => {
  const W = P[20];
  const weakState = (dueDate: string) => due(2, dueDate, [att(1, 'solved', d(-9)), att(2, 'forgot', d(-6)), att(2, 'hint', d(-5))]);

  it('is offered for weak problems and never changes schedule, stage, history, counters or next date', async () => {
    const user = userEvent.setup();
    const state = weakState(d(5)); // weak, not due for 5 days
    seedProgress({ [W.id]: solvedEntry(state, { revisionCount: 3, lastRevised: d(-5) }) });
    const before = JSON.stringify(storedProgress());
    renderApp('/revision');
    expect(isWeak(state)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Practice Weak Problems' }));

    const card = within(document.querySelector('[data-session-problem]') as HTMLElement);
    expect(card.getByRole('heading', { name: W.title })).toBeInTheDocument();
    expect(card.getByText('Practice / Self-check')).toBeInTheDocument();
    expect(card.getByText(/Self-check only/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Practice Weak Problems' })).toBeInTheDocument();
    for (const name of [/^Forgot/, /^Needed hint/, /^Solved\b(?! easily)/, /^Solved easily/]) {
      // every self-check answer is allowed, and each one is only in your head
      expect(card.getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(card.getByRole('button', { name: /^Solved easily/ }));

    expect(screen.getByRole('heading', { name: 'Practice Complete' })).toBeInTheDocument();
    expect(screen.getByTestId('session-easy')).toHaveTextContent('1');
    expect(JSON.stringify(storedProgress())).toBe(before); // byte for byte the same saved data
    const saved = storedProgress()[W.id];
    expect(saved.revision).toEqual(state);
    expect(saved.revisionCount).toBe(3);
    expect(saved.lastRevised).toBe(d(-5));
  });

  it('does not touch the schedule even when the weak problem is also due, and does not count for the streak', async () => {
    const user = userEvent.setup();
    seedProgress({ [W.id]: solvedEntry(weakState(d(0))) }); // weak AND due today
    renderApp('/revision');
    const streak = screen.getByTestId('rev-streak').textContent;
    expect(screen.getByTestId('rev-last7')).toHaveTextContent('2 / 7'); // the two real attempts 6 and 5 days ago
    await user.click(screen.getByRole('button', { name: 'Practice Weak Problems' }));
    expect(screen.getByText(/also due/)).toBeInTheDocument(); // the session says where the real revision happens
    await user.click(screen.getByRole('button', { name: /^Solved\b(?! easily)/ }));
    await user.click(screen.getByRole('button', { name: 'Back to Revision Hub' }));
    expect(storedProgress()[W.id].revision).toEqual(weakState(d(0))); // still due, same history
    expect(screen.getByTestId('hub-due')).toHaveTextContent('1');
    expect(screen.getByTestId('rev-streak').textContent).toBe(streak); // the streak did not move
    expect(screen.getByTestId('rev-last7')).toHaveTextContent('2 / 7'); // and today was not counted as a revision day
    expect(screen.getByTestId('hub-completed')).toHaveTextContent('0');
  });

  it('a weak problem that is due IS recorded normally in the real revision session', async () => {
    const user = userEvent.setup();
    seedProgress({ [W.id]: solvedEntry(weakState(d(0))) });
    renderApp('/revision');
    await user.click(screen.getByRole('button', { name: 'Start Revision Session' }));
    await user.click(screen.getByRole('button', { name: /^Solved\b(?! easily)/ }));
    const r = storedProgress()[W.id].revision!;
    expect(r.attempts).toHaveLength(4);
    expect(r.attempts.at(-1)).toMatchObject({ result: 'solved', date: T, scheduled: d(0) });
    expect(r).toMatchObject({ stage: 3, due: d(7) }); // two stages were done, so this was revision 3: on to revision 4 in 7 days
  });

  it('the button only appears when there are weak problems, and the weak definition is unchanged', () => {
    seedProgress({ [W.id]: solvedEntry(due(2, d(5), [att(1, 'solved', d(-9)), att(2, 'hint', d(-5))])) }); // only 1 struggle
    renderApp('/revision');
    expect(screen.queryByRole('button', { name: 'Practice Weak Problems' })).toBeNull();
    expect(isWeak(due(2, d(5), [att(1, 'forgot', d(-9)), att(2, 'hint', d(-5))]))).toBe(true);
  });
});

// ======================================================================================================
describe('Daily revision target and progress (UI)', () => {
  const setSettings = (s: object) => window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));

  it('shows the real workload next to the target: 17 due, target 10, 7 done, 10 remaining', () => {
    const doneToday = P.slice(70, 77).map((p) => [p.id, solvedEntry(due(2, d(4), [att(1, 'solved', d(-1)), att(2, 'solved', T, d(0))]))] as const);
    const dueNow = P.slice(80, 90).map((p) => [p.id, solvedEntry(due(1, d(0)))] as const);
    seedProgress(Object.fromEntries([...doneToday, ...dueNow]));
    renderApp('/revision');
    expect(screen.getByTestId('daily-workload')).toHaveTextContent('17');
    expect(screen.getByTestId('daily-target')).toHaveTextContent('10');
    expect(screen.getByTestId('daily-completed')).toHaveTextContent('7');
    expect(screen.getByTestId('daily-remaining')).toHaveTextContent('10');
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('7 / 17 done');
  });

  it('a big target does not hide or shrink the real workload, and remaining never goes below 0', () => {
    setSettings({ theme: 'dark', dailyTarget: 5, revisionTarget: 30, lastExport: null });
    seedProgress({
      [P[70].id]: solvedEntry(due(1, d(0))), // 1 due
      [P[71].id]: solvedEntry(due(2, d(4), [att(2, 'solved', T, d(0))])), // 1 done
    });
    renderApp('/revision');
    expect(screen.getByTestId('daily-target')).toHaveTextContent('30');
    expect(screen.getByTestId('daily-workload')).toHaveTextContent('2');
    expect(screen.getByTestId('daily-remaining')).toHaveTextContent('1');
  });

  it('counts revisions actually recorded today, and keeps the workload fixed while you work', async () => {
    const user = userEvent.setup();
    setSettings({ theme: 'dark', dailyTarget: 15, revisionTarget: 5, lastExport: null });
    seedProgress(Object.fromEntries([P[30], P[31], P[32]].map((p) => [p.id, solvedEntry(due(1, d(0)))])));
    renderApp('/revision');
    expect(screen.getByTestId('daily-target')).toHaveTextContent('5'); // the REVISION target, not the problem target (15)
    expect(screen.getByTestId('daily-completed')).toHaveTextContent('0');
    expect(screen.getByTestId('daily-remaining')).toHaveTextContent('3');
    await user.click(screen.getByRole('button', { name: 'Start Revision Session' }));
    await user.click(screen.getByRole('button', { name: /^Solved easily/ }));
    await user.click(screen.getByRole('button', { name: /^Forgot/ }));
    await user.click(screen.getByRole('button', { name: /Exit session/ }));
    expect(screen.getByTestId('daily-completed')).toHaveTextContent('2'); // Forgot counts: it was really revised
    expect(screen.getByTestId('daily-remaining')).toHaveTextContent('1');
    expect(screen.getByTestId('daily-workload')).toHaveTextContent('3'); // still 3
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('2 / 3 done');
  });

  it('the revision target and the Dashboard problem target are independent', async () => {
    const user = userEvent.setup();
    setSettings({ theme: 'dark', dailyTarget: 5, revisionTarget: 20, lastExport: null });
    const first = renderApp('/revision');
    expect(screen.getByTestId('daily-target')).toHaveTextContent('20');
    first.unmount();
    renderApp('/');
    expect(screen.getByTestId('today-count')).toHaveTextContent('0 / 5 completed'); // the Dashboard still uses 5
    await user.click(within(screen.getByRole('group', { name: 'Daily target' })).getByRole('button', { name: '15' }));
    expect(storedSettings()).toMatchObject({ dailyTarget: 15, revisionTarget: 20 }); // changing one never touches the other
  });

  it('is set in Settings, next to (but separate from) the problem target', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    expect(screen.getByRole('group', { name: 'Daily target' })).toBeInTheDocument();
    const rev = within(screen.getByRole('group', { name: 'Daily revision target' }));
    expect(rev.getAllByRole('button').map((b) => b.textContent)).toEqual(['5', '10', '15', '20', '30']);
    await user.click(rev.getByRole('button', { name: '30' }));
    expect(storedSettings()).toMatchObject({ revisionTarget: 30, dailyTarget: 10 });
    await user.click(within(screen.getByRole('group', { name: 'Daily target' })).getByRole('button', { name: '5' }));
    expect(storedSettings()).toMatchObject({ revisionTarget: 30, dailyTarget: 5 });
  });

  it('settings saved before the revision target existed start it as a copy of the problem target, once', async () => {
    const user = userEvent.setup();
    setSettings({ theme: 'light', dailyTarget: 15, lastExport: '2026-09-01' }); // a V1-era settings blob
    const first = renderApp('/revision');
    expect(screen.getByTestId('daily-target')).toHaveTextContent('15');
    expect(storedSettings()).toEqual({ theme: 'light', dailyTarget: 15, revisionTarget: 15, lastExport: '2026-09-01' }); // nothing else changed
    first.unmount();
    renderApp('/');
    await user.click(within(screen.getByRole('group', { name: 'Daily target' })).getByRole('button', { name: '5' }));
    expect(storedSettings()).toMatchObject({ dailyTarget: 5, revisionTarget: 15 }); // from now on they are independent
  });
});

describe('Consistency (UI)', () => {
  it('opening the hub does not count as a revision day; recording a result does', async () => {
    const user = userEvent.setup();
    seedProgress({ [P[40].id]: solvedEntry(due(2, d(0), [att(1, 'solved', d(-2)), att(1, 'solved', d(-1))])) });
    renderApp('/revision');
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('2 revision days'); // d-2, d-1 done; today is still open
    expect(screen.getByTestId('rev-last7')).toHaveTextContent('2 / 7');
    expect(Object.values(storedProgress())[0].revision!.attempts).toHaveLength(2); // just looking wrote nothing
    await user.click(screen.getByRole('button', { name: 'Start Revision Session' }));
    await user.click(screen.getByRole('button', { name: /^Solved\b(?! easily)/ }));
    await user.click(screen.getByRole('button', { name: 'Back to Revision Hub' }));
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('3 revision days');
    expect(screen.getByTestId('rev-last7')).toHaveTextContent('3 / 7');
  });

  it('explains that the streak counts revision days, not calendar days', () => {
    seedProgress({ [P[40].id]: solvedEntry(due(2, d(5), [att(1, 'solved', d(-1))])) });
    renderApp('/revision');
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('1 revision day');
    expect(screen.getByText(/revision days in a row, not calendar days/)).toBeInTheDocument();
  });

  it('shows a lost streak as 0 when an active day was missed', () => {
    seedProgress({ [P[40].id]: solvedEntry(due(2, d(-2), [att(1, 'solved', d(-3))])) }); // due 2 days ago, never done
    renderApp('/revision');
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('0 revision days');
    expect(screen.getByTestId('overdue-nudge')).toHaveTextContent('1 revision overdue');
  });
});

// ======================================================================================================
describe('Pause Revision (UI)', () => {
  const [a, b, z] = [P[50], P[51], P[52]];
  const seedPausable = () =>
    seedProgress({
      [a.id]: solvedEntry(due(1, d(1))), // due tomorrow
      [b.id]: solvedEntry(due(1, d(-2))), // 2 days overdue
      [z.id]: solvedEntry(due(1, d(-10))), // 10 days overdue
    });
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Pause Revision' }));
    return screen.getByRole('dialog', { name: 'Pause Revision' });
  };
  const li = (id: string) => document.querySelector(`li[data-revision-problem="${id}"]`) as HTMLElement;

  it('opens a dialog explaining what a pause is for and what it does not do, validates the date, and can be cancelled', async () => {
    const user = userEvent.setup();
    seedPausable();
    renderApp('/revision');
    const dlg = within(await openDialog(user));
    expect(dlg.getByText(/midsems, endsems, travel, holidays/)).toBeInTheDocument();
    expect(dlg.getByText(/does not rewrite the past/)).toBeInTheDocument();
    fireEvent.change(dlg.getByLabelText(/frozen until/), { target: { value: d(-1) } });
    expect(dlg.getByRole('alert')).toHaveTextContent(/today or a later date/);
    expect(dlg.getByRole('button', { name: 'Pause Revision' })).toBeDisabled();
    fireEvent.change(dlg.getByLabelText(/frozen until/), { target: { value: d(3) } });
    expect(dlg.getByTestId('pause-summary')).toHaveTextContent('4 days paused. Revision resumes on');
    await user.click(dlg.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storedDoc().pauses).toBeUndefined(); // nothing was paused
  });

  it('pausing keeps overdue problems visible and frozen with their ORIGINAL due dates; only future dates move; sessions are off', async () => {
    const user = userEvent.setup();
    seedPausable();
    renderApp('/revision');
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('2');
    const dlg = within(await openDialog(user));
    fireEvent.change(dlg.getByLabelText(/frozen until/), { target: { value: d(3) } }); // 4 days: today .. d(3)
    await user.click(dlg.getByRole('button', { name: 'Pause Revision' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Revision Paused')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Revision schedule is paused until');
    expect(screen.getByRole('button', { name: 'Resume Early' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Revision Session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause Revision' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Practice Weak Problems' })).toBeNull();
    expect(screen.getByTestId('today-status')).toHaveTextContent('Revision is paused');
    expect(screen.queryByTestId('overdue-nudge')).toBeNull(); // no pressure

    // The overdue count did NOT drop to zero, and they say what they are.
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('2');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('0');
    expect(screen.getByTestId('frozen-summary')).toHaveTextContent('2 overdue revisions frozen during the pause');
    const overdue = within(screen.getByRole('region', { name: 'Overdue' }));
    expect(overdue.getAllByText('Overdue — Frozen during pause')).toHaveLength(2);
    expect(overdue.queryByText(/^Due in/)).toBeNull(); // not "Due in 3 days"
    expect(within(li(b.id)).getByTestId('frozen-note')).toHaveTextContent('Overdue for 2 days before the pause');
    expect(within(li(z.id)).getByTestId('frozen-note')).toHaveTextContent('Overdue for 10 days before the pause');
    expect(screen.getByRole('link', { name: /^Revision Hub\s*2$/ })).toBeInTheDocument(); // the sidebar still counts them

    const doc = storedDoc();
    expect(doc.pauses).toEqual([{ start: T, end: d(3) }]);
    expect(doc.entries[a.id].revision.due).toBe(d(5)); // the future one moved by 4
    expect(doc.entries[b.id].revision.due).toBe(d(-2)); // the overdue ones did NOT move
    expect(doc.entries[z.id].revision.due).toBe(d(-10));
    expect(doc.entries[b.id].revision.attempts).toEqual([]);
    expect(doc.entries[b.id].revision.stage).toBe(1);
    expect(within(screen.getByRole('region', { name: 'Revise today' })).getByText(/paused, so nothing is due/)).toBeInTheDocument();
  });

  it('the pause survives a refresh; Resume Early restores the future dates, the overdue ones were never moved, controls return', async () => {
    const user = userEvent.setup();
    seedPausable();
    const first = renderApp('/revision');
    const dlg = within(await openDialog(user));
    fireEvent.change(dlg.getByLabelText(/frozen until/), { target: { value: d(3) } });
    await user.click(dlg.getByRole('button', { name: 'Pause Revision' }));
    first.unmount();

    renderApp('/revision'); // refresh
    expect(screen.getByText('Revision Paused')).toBeInTheDocument();
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'Resume Early' }));

    expect(screen.queryByText('Revision Paused')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start Revision Session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause Revision' })).toBeInTheDocument();
    const doc = storedDoc();
    expect(doc.pauses).toBeUndefined(); // paused and resumed the same day: no pause left on record
    expect(doc.entries[a.id].revision.due).toBe(d(1)); // exactly where it was
    expect(doc.entries[b.id].revision.due).toBe(d(-2));
    expect(doc.entries[z.id].revision.due).toBe(d(-10));
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('2');
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Overdue by 2 days')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Overdue by 10 days')).toBeInTheDocument();
  });

  it('the exact scenario in the UI: a 7-day streak, a missed revision, then a pause; the streak stays broken until a real revision restarts it at 1', async () => {
    const user = userEvent.setup();
    const week = [-9, -8, -7, -6, -5, -4, -3].map((n) => att(1, 'solved', d(n)));
    seedProgress({
      [P[60].id]: solvedEntry(due(1, d(90), week)), // made the 7-day streak
      [a.id]: solvedEntry(due(1, d(-2))), // due 2 days ago and missed
    });
    renderApp('/revision');
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('0 revision days'); // already broken by the 2 missed days
    const dlg = within(await openDialog(user));
    fireEvent.change(dlg.getByLabelText(/frozen until/), { target: { value: d(4) } });
    await user.click(dlg.getByRole('button', { name: 'Pause Revision' }));

    expect(storedDoc().entries[a.id].revision.due).toBe(d(-2)); // NOT rewritten
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('1'); // NOT zero
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('0 revision days'); // the pause did not repair it
    expect(screen.getByText(/Overdue — Frozen during pause/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume Early' }));
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('0 revision days');
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Overdue by 2 days')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start Revision Session' })); // the first real revision
    await user.click(screen.getByRole('button', { name: /^Solved\b(?! easily)/ }));
    await user.click(screen.getByRole('button', { name: 'Back to Revision Hub' }));
    expect(screen.getByTestId('rev-streak')).toHaveTextContent('1 revision day'); // a NEW streak of 1
    expect(storedProgress()[a.id].revision!.attempts.at(-1)).toMatchObject({ date: T, scheduled: d(-2) }); // history keeps the true date
  });

  it('a problem solved on the Roadmap AFTER pausing starts its schedule after the pause and is labelled; one solved earlier that day is not', async () => {
    const user = userEvent.setup();
    const before = P[62];
    const after = P[60];
    seedProgress({ [before.id]: entry({ status: 'solved', solvedDate: T, revision: newRevisionState(T) }) }); // solved earlier today
    const first = renderApp('/revision');
    const dlg = within(await openDialog(user));
    fireEvent.change(dlg.getByLabelText(/frozen until/), { target: { value: d(4) } }); // resumes on d(5)
    await user.click(dlg.getByRole('button', { name: 'Pause Revision' }));
    first.unmount();

    const roadmap = renderApp('/roadmap');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), String(after.stepNo));
    await user.click(within(cardOf(after.id)).getByRole('button', { name: 'Solved' }));
    const saved = storedProgress();
    expect(saved[after.id].solvedDate).toBe(T);
    expect(saved[after.id].revision).toEqual({ stage: 0, due: d(6), attempts: [], solvedDuringPause: true }); // resume date d(5) + 1
    expect(saved[before.id].revision!.due).toBe(d(6)); // solved before pausing: shifted like any other future revision
    expect(saved[before.id].revision!.solvedDuringPause).toBeUndefined();
    roadmap.unmount();

    renderApp('/revision');
    expect(screen.getByText('Revision Paused')).toBeInTheDocument();
    const solvedToday = within(screen.getByRole('region', { name: /^Solved today/ }));
    expect(solvedToday.getByRole('heading', { name: after.title })).toBeInTheDocument();
    expect(solvedToday.getByRole('heading', { name: before.title })).toBeInTheDocument();
    const rowOf = (id: string) => document.querySelector(`[aria-labelledby="solved-h"] li[data-revision-problem="${id}"]`) as HTMLElement;
    expect(within(rowOf(after.id)).getByText('Solved during pause')).toBeInTheDocument();
    expect(within(rowOf(before.id)).queryByText('Solved during pause')).toBeNull(); // the cosmetic bug is fixed
    expect(screen.getByTestId('hub-solved-today')).toHaveTextContent('2');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('0');
  });
});

// ======================================================================================================
describe('Revision cards no longer record results', () => {
  it('cards on every list only show status; the session is the one way to record a result', () => {
    seedProgress({
      [P[10].id]: solvedEntry(due(1, d(0))),
      [P[11].id]: solvedEntry(due(1, d(-3))),
      [P[12].id]: solvedEntry(due(2, d(6))),
      [P[13].id]: solvedEntry(due(2, d(0), [att(1, 'forgot', d(-4)), att(1, 'hint', d(-2))])), // weak and due
    });
    renderApp('/revision');
    expect(screen.getAllByRole('button', { name: 'Start Revision Session' })).toHaveLength(1); // only the top one
    for (const name of [/^Start Revision$/, /^Revise Now$/, /^Forgot/, /^Needed hint/, /^Solved\b/, /^Solved easily/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('group', { name: /Record revision/ })).toBeNull();
    const dueCard = document.querySelector(`li[data-revision-problem="${P[10].id}"]`) as HTMLElement;
    expect(within(dueCard).getByText(/Record the result in the Revision Session/)).toBeInTheDocument();
    expect(within(dueCard).getByTestId('revision-progress')).toHaveTextContent('Revision 2/5'); // status still shown
    expect(within(dueCard).getByText(/Next revision:/)).toBeInTheDocument();
    expect(within(dueCard).getAllByRole('link').length).toBeGreaterThan(0); // and the problem can still be opened
  });
});

// ======================================================================================================
describe('storage and backups', () => {
  it('saves without pauses exactly as before, and saves that never had pauses load fine', () => {
    saveProgress({ a: solvedEntry(due(1, '2026-09-25')) });
    expect(storedDoc()).toEqual({ version: 1, entries: { a: expect.any(Object) } });
    expect('pauses' in storedDoc()).toBe(false);
    expect(loadStore().pauses).toEqual([]);
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries: { b: { status: 'solved', notes: 'n', important: true, needsRevision: false, revisionCount: 2, lastRevised: '2026-09-01', solvedDate: '2026-08-30' } } }));
    const s = loadStore();
    expect(s.pauses).toEqual([]);
    expect(s.progress.b).toEqual({ status: 'solved', notes: 'n', important: true, needsRevision: false, revisionCount: 2, lastRevised: '2026-09-01', solvedDate: '2026-08-30' });
  });

  it('pauses survive save -> load, invalid ones are dropped, and they are read back oldest first', () => {
    const pauses: RevisionPause[] = [{ start: '2026-10-01', end: '2026-10-05' }, { start: '2026-09-01', end: '2026-09-03' }];
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries: {}, pauses: [...pauses, { start: 'x', end: '2026-01-01' }, { start: '2026-09-09', end: '2026-09-01' }, 7] }));
    expect(loadStore().pauses).toEqual([pauses[1], pauses[0]]);
    saveProgress({}, pauses);
    expect(storedDoc().pauses).toEqual(pauses);
  });

  it('exports and imports include the pauses; old exports without them still import', () => {
    const pauses: RevisionPause[] = [{ start: '2026-09-25', end: '2026-09-30' }];
    const map: ProgressMap = { a: solvedEntry(due(1, '2026-10-01', [att(1, 'solved', '2026-09-20')])) };
    const ok = parseImport(JSON.stringify(buildExport(map, { checksum: 'x', problemCount: 455 }, new Date(), pauses)));
    expect(ok.ok && ok.pauses).toEqual(pauses);
    expect(ok.ok && ok.progress.a.revision!.attempts[0].scheduled).toBe('2026-09-20');
    const old = parseImport(JSON.stringify(buildExport(map, { checksum: 'x', problemCount: 455 })));
    expect(old.ok && old.pauses).toEqual([]);
    expect(parseImport(JSON.stringify({ ...buildExport(map, { checksum: 'x', problemCount: 455 }), pauses: [{ start: 'nope' }] })).ok).toBe(false);
  });

  it('attempts saved before "scheduled" existed still load', () => {
    const e = { ...entry({ status: 'solved', solvedDate: '2026-09-01' }), revision: { stage: 1, due: '2026-09-05', attempts: [{ revision: 1, date: '2026-09-02', result: 'solved' }] } };
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries: { a: e } }));
    expect(loadStore().progress.a.revision!.attempts).toEqual([{ revision: 1, date: '2026-09-02', result: 'solved' }]);
  });

  it('a new problem solved when not paused still starts tomorrow (V1 behaviour is unchanged)', () => {
    const m = ops.setStatus({}, 'a', 'solved', '2026-09-23');
    expect(m.a.revision).toEqual(newRevisionState('2026-09-23'));
    const r = applyRevision(m.a.revision!, 'solved', '2026-09-24');
    expect(r).toMatchObject({ stage: 1, due: '2026-09-26' });
  });
});

// ======================================================================================================
describe('backup: export and import (UI)', () => {
  const pauses: RevisionPause[] = [{ start: '2026-09-10', end: '2026-09-14' }, { start: T, end: d(3) }];
  const entries = (): ProgressMap => ({
    [P[0].id]: solvedEntry(
      { stage: 2, due: d(-5), attempts: [att(1, 'solved', '2026-09-02'), att(2, 'forgot', '2026-09-08', '2026-09-05')], solvedDuringPause: true },
      { solvedDate: '2026-09-01', revisionCount: 2, lastRevised: '2026-09-08', notes: 'keep' },
    ),
    [P[1].id]: solvedEntry({ stage: 5, due: null, attempts: [att(4, 'solved', '2026-08-01'), att(5, 'easy', '2026-08-20')] }),
  });

  it('exports every revision detail, the original due dates and both the active and the past pause', async () => {
    const user = userEvent.setup();
    seedDoc(entries(), pauses);
    let blob: Blob | null = null;
    const { vi } = await import('vitest');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((b: Blob) => ((blob = b), 'blob:t')) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderApp('/settings');
    await user.click(screen.getByRole('button', { name: /Export progress/ }));
    const data = JSON.parse(await (await import('./helpers')).blobText(blob!));
    expect(data.pauses).toEqual(pauses);
    expect(data.progress).toEqual(entries()); // stages, true due dates, attempts with scheduled dates, solved dates, flags
    expect(data.progress[P[0].id].revision.due).toBe(d(-5)); // an overdue date exported exactly as it is
  });

  it('importing replaces the revision state with the backup: a V2 backup restores its pauses, a V1 backup leaves none', async () => {
    const user = userEvent.setup();
    seedDoc({ [P[5].id]: solvedEntry(due(1, d(2))) }, [{ start: T, end: d(9) }]); // current state: paused
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ theme: 'light', dailyTarget: 15, revisionTarget: 20, lastExport: null }));
    renderApp('/settings');
    const input = screen.getByLabelText('Import progress file');

    // 1. a backup made before pauses existed
    const v1 = JSON.stringify(buildExport(entries(), { checksum: 'x', problemCount: 455 }));
    await user.upload(input, new File([v1], 'v1.json'));
    const confirm1 = await screen.findByRole('group', { name: 'Confirm import' });
    expect(confirm1).toHaveTextContent(/replaces your current progress, including all revision history, schedules and pauses/);
    expect(confirm1).toHaveTextContent('no revision pauses');
    expect(confirm1).toHaveTextContent(/clears any pause you have now/);
    expect(confirm1).toHaveTextContent(/settings \(theme and targets\) are not part of a backup and stay as they are/);
    await user.click(within(confirm1).getByRole('button', { name: 'Replace my progress' }));
    expect(storedDoc().pauses).toBeUndefined(); // no pauses, as in the backup
    expect(storedProgress()).toEqual(entries());

    // 2. a V2 backup with pauses
    const v2 = JSON.stringify(buildExport(entries(), { checksum: 'x', problemCount: 455 }, new Date(), pauses));
    await user.upload(input, new File([v2], 'v2.json'));
    const confirm2 = await screen.findByRole('group', { name: 'Confirm import' });
    expect(confirm2).toHaveTextContent('2 revision pauses');
    await user.click(within(confirm2).getByRole('button', { name: 'Replace my progress' }));
    expect(storedDoc().pauses).toEqual(pauses);
    expect(storedProgress()).toEqual(entries()); // stages, dues, attempts (scheduled dates too), solved dates, solvedDuringPause
    expect(storedSettings()).toEqual({ theme: 'light', dailyTarget: 15, revisionTarget: 20, lastExport: null }); // settings untouched
  });

  it('a broken pause list makes the import fail without changing anything', async () => {
    const user = userEvent.setup();
    seedDoc({ [P[5].id]: solvedEntry(due(1, d(2))) });
    const before = window.localStorage.getItem(STORAGE_KEYS.progress);
    renderApp('/settings');
    const bad = JSON.stringify({ ...buildExport(entries(), { checksum: 'x', problemCount: 455 }), pauses: [{ start: 'nope', end: 'nope' }] });
    await user.upload(screen.getByLabelText('Import progress file'), new File([bad], 'bad.json'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid revision pause data/);
    expect(window.localStorage.getItem(STORAGE_KEYS.progress)).toBe(before);
  });
});

describe('old data still loads (V1 compatibility)', () => {
  it('V1 saves with revision state but no `scheduled`, no `solvedDuringPause` and no pauses load and behave exactly as before', () => {
    const v1 = {
      version: 1,
      entries: {
        [P[0].id]: { status: 'solved', notes: 'n', important: true, needsRevision: false, revisionCount: 2, lastRevised: '2026-09-20', solvedDate: '2026-09-15',
          revision: { stage: 1, due: '2026-09-21', attempts: [{ revision: 1, date: '2026-09-16', result: 'solved' }] } },
        [P[1].id]: { status: 'solved', notes: '', important: false, needsRevision: true, revisionCount: 0, lastRevised: null, solvedDate: '2026-01-01' }, // never in the schedule
      },
    };
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(v1));
    const s = loadStore();
    expect(s.pauses).toEqual([]);
    expect(s.progress[P[0].id].revision).toEqual(v1.entries[P[0].id].revision); // nothing added, nothing lost
    expect('revision' in s.progress[P[1].id]).toBe(false);
    const hub = buildRevisionHub(dataset, s.progress, '2026-09-23', s.pauses);
    expect(hub.overdue.map((i) => [i.problem.id, i.overdueDays, i.frozen])).toEqual([[P[0].id, 2, false]]);
    expect(hub.flagged).toHaveLength(1);
    // Recording works and adds `scheduled` from now on.
    const next = ops.recordRevision(s.progress, P[0].id, 'solved', '2026-09-23');
    expect(next[P[0].id].revision!.attempts).toEqual([{ revision: 1, date: '2026-09-16', result: 'solved' }, { revision: 2, date: '2026-09-23', result: 'solved', scheduled: '2026-09-21' }]);
  });

  it('a problem solved before the V2 changes is not flagged and nothing in the saved format is rewritten on load', () => {
    seedProgress({ [P[0].id]: solvedEntry(due(0, '2026-09-24')) });
    const before = window.localStorage.getItem(STORAGE_KEYS.progress);
    renderApp('/revision');
    expect(window.localStorage.getItem(STORAGE_KEYS.progress)).toBe(before); // opening the page rewrote nothing
    expect(document.querySelector('[data-revision-problem]')).not.toHaveTextContent('Solved during pause');
  });
});
