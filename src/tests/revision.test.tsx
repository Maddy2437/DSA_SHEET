import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProblemProgress, ProgressMap, RevisionAttempt, RevisionResult, RevisionState } from '../types';
import { dataset } from '../utils/dataset';
import { addDays, todayKey, toDateKey } from '../utils/dates';
import { buildExport, loadProgress, ops, parseImport } from '../utils/progress';
import {
  applyRevision, buildRevisionHub, isMastered, isWeak, newRevisionState, phaseOf, revisionHistory,
} from '../utils/revision';
import { STORAGE_KEYS } from '../utils/storage';
import { addDays as addDaysLocal, cardOf, entry, renderApp, seedProgress, storedProgress } from './helpers';

const TODAY = todayKey();
const P = dataset.problems[10];
const Q = dataset.problems[20];

// Runs a list of results, each done exactly on the day the previous step scheduled it.
function run(results: RevisionResult[], solvedOn = '2026-09-23'): RevisionState {
  let s = newRevisionState(solvedOn);
  for (const r of results) s = applyRevision(s, r, s.due!);
  return s;
}
const att = (revision: number, result: RevisionResult, date = '2026-09-01'): RevisionAttempt => ({ revision, date, result });

describe('date arithmetic', () => {
  it('handles month ends, year ends, leap years and different month lengths', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01'); // not a leap year
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // a DST change day somewhere in the world
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-09-23', -1)).toBe('2026-09-22');
  });

  it('todayKey / toDateKey use the LOCAL calendar date, not UTC', () => {
    expect(toDateKey(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
    expect(toDateKey(new Date(2027, 0, 1, 0, 0, 1))).toBe('2027-01-01');
    expect(todayKey(new Date(2026, 2, 1, 0, 30))).toBe('2026-03-01');
  });
});

describe('schedule', () => {
  it('a problem solved for the first time enters the cycle: revision 1 is due the next day', () => {
    const m = ops.setStatus({}, 'a', 'solved', '2026-09-23');
    expect(m.a.solvedDate).toBe('2026-09-23');
    expect(m.a.revision).toEqual({ stage: 0, due: '2026-09-24', attempts: [] });
  });

  it('on-time success gives R1..R5 at +1, +3, +7, +14, +30 days (the Binary Search example)', () => {
    const dates: string[] = [];
    let s = newRevisionState('2026-09-23');
    for (let i = 0; i < 5; i++) {
      dates.push(s.due!);
      s = applyRevision(s, 'solved', s.due!);
    }
    expect(dates).toEqual(['2026-09-24', '2026-09-26', '2026-09-30', '2026-10-07', '2026-10-23']);
  });

  it('crosses a year boundary correctly', () => {
    const dates = revisionHistory(newRevisionState('2026-12-20')).map((r) => r.date);
    expect(dates).toEqual(['2026-12-21', '2026-12-23', '2026-12-27', '2027-01-03', '2027-01-19']);
  });

  it('only the FIRST solve enters the cycle; toggling status later changes nothing', () => {
    let m = ops.setStatus({}, 'a', 'solved', '2026-09-23');
    const first = m.a.revision;
    m = ops.setStatus(m, 'a', 'in_progress', '2026-09-25');
    m = ops.setStatus(m, 'a', 'solved', '2026-09-26');
    expect(m.a.solvedDate).toBe('2026-09-23');
    expect(m.a.revision).toEqual(first);
    // In progress alone never enrols.
    expect(ops.setStatus({}, 'b', 'in_progress', '2026-09-23').b.revision).toBeUndefined();
  });

  it('classifies today / tomorrow / overdue / mastered by calendar day', () => {
    const s = (due: string | null): RevisionState => ({ stage: due === null ? 5 : 1, due, attempts: [] });
    expect(phaseOf(s('2026-09-23'), '2026-09-23')).toBe('due');
    expect(phaseOf(s('2026-09-24'), '2026-09-23')).toBe('upcoming');
    expect(phaseOf(s('2026-09-22'), '2026-09-23')).toBe('overdue');
    expect(phaseOf(s('2026-12-31'), '2027-01-02')).toBe('overdue'); // across the year end
    expect(phaseOf(s('2026-02-28'), '2026-03-01')).toBe('overdue'); // across a short month
    expect(phaseOf(s(null), '2026-09-23')).toBe('mastered');
  });
});

describe('adaptive state machine', () => {
  it('Forgot repeats the CURRENT revision tomorrow and never resets to R1', () => {
    const at3 = run(['solved', 'solved']); // R1, R2 done -> R3 is next
    expect(at3.stage).toBe(2);
    const s = applyRevision(at3, 'forgot', '2026-10-01');
    expect(s.stage).toBe(2);
    expect(s.due).toBe('2026-10-02');
    expect(s.attempts.at(-1)).toEqual({ revision: 3, date: '2026-10-01', result: 'forgot', scheduled: '2026-09-30' }); // it was one day late
  });

  it('Needed hint repeats the current revision in 3 days', () => {
    const s = applyRevision(run(['solved']), 'hint', '2026-09-26');
    expect(s.stage).toBe(1);
    expect(s.due).toBe('2026-09-29');
  });

  it('Solved and Solved easily both advance exactly one stage with the normal gap; no stage is skipped', () => {
    for (const r of ['solved', 'easy'] as const) {
      let s = newRevisionState('2026-09-23');
      const stages: number[] = [];
      for (let i = 0; i < 5; i++) {
        s = applyRevision(s, r, s.due!);
        stages.push(s.stage);
      }
      expect(stages).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('a late revision shifts the rest of the schedule instead of piling up', () => {
    // R2 was planned for 26 Sep but done on 30 Sep: R3 is 4 days after that, not immediately due.
    const s = applyRevision(run(['solved']), 'solved', '2026-09-30');
    expect(s.stage).toBe(2);
    expect(s.due).toBe('2026-10-04');
  });

  it('records the attempt history in order, with repeats labelled', () => {
    const s = run(['solved', 'hint', 'solved']);
    expect(s.attempts.map((a) => [a.revision, a.result])).toEqual([[1, 'solved'], [2, 'hint'], [2, 'solved']]);
    const rows = revisionHistory(s).map((r) => `${r.label}|${r.result ?? 'pending'}`);
    expect(rows).toEqual([
      'Revision 1|solved', 'Revision 2|hint', 'Revision 2 (repeat)|solved', 'Revision 3|pending', 'Revision 4|pending', 'Revision 5|pending',
    ]);
  });

  it('recordRevision ignores a revision that is not due yet, and a second click on the same day', () => {
    let m = ops.setStatus({}, 'a', 'solved', '2026-09-23');
    expect(ops.recordRevision(m, 'a', 'solved', '2026-09-23').a.revision!.attempts).toHaveLength(0); // due tomorrow
    m = ops.recordRevision(m, 'a', 'solved', '2026-09-24');
    m = ops.recordRevision(m, 'a', 'solved', '2026-09-24'); // double click
    expect(m.a.revision!.attempts).toHaveLength(1);
    expect(m.a).toMatchObject({ revisionCount: 1, lastRevised: '2026-09-24', status: 'solved', solvedDate: '2026-09-23' });
  });

  it('does not touch the manual "needs revision" flag, and a problem without a schedule is ignored', () => {
    let m = ops.toggleNeedsRevision(ops.setStatus({}, 'a', 'solved', '2026-09-23'), 'a');
    m = ops.recordRevision(m, 'a', 'solved', '2026-09-24');
    expect(m.a.needsRevision).toBe(true);
    const legacy: ProgressMap = { z: entry({ status: 'solved', solvedDate: '2026-01-01' }) };
    expect(ops.recordRevision(legacy, 'z', 'solved', '2026-09-24').z.revisionCount).toBe(0);
  });
});

describe('mastery', () => {
  it('five clean revisions => Mastered, no more due date', () => {
    const s = run(['solved', 'easy', 'solved', 'easy', 'solved']);
    expect(s.stage).toBe(5);
    expect(s.due).toBeNull();
    expect(phaseOf(s, '2030-01-01')).toBe('mastered');
  });

  it('a Forgot in the last 3 attempts blocks Mastered and asks for a confirmation revision', () => {
    const s = run(['solved', 'solved', 'solved', 'forgot', 'solved', 'solved']); // stage 5 reached, last3 = forgot,solved,solved
    expect(s.stage).toBe(5);
    expect(s.due).not.toBeNull();
    expect(revisionHistory(s).at(-1)!.label).toBe('Confirmation revision');
    const confirmed = applyRevision(s, 'solved', s.due!); // last3 = solved,solved,solved
    expect(confirmed.due).toBeNull();
  });

  it('the last 2 attempts must both be Solved / Solved easily', () => {
    expect(isMastered([att(4, 'solved'), att(5, 'hint'), att(5, 'solved')])).toBe(false);
    expect(isMastered([att(4, 'solved'), att(5, 'solved')])).toBe(true);
    expect(isMastered([att(5, 'forgot'), att(5, 'solved'), att(5, 'solved')])).toBe(false);
    expect(isMastered([att(5, 'hint'), att(5, 'solved'), att(5, 'easy')])).toBe(true);
  });

  it('a problem that keeps failing never reaches Mastered, whatever revisionCount says', () => {
    let m = ops.setStatus({}, 'a', 'solved', '2026-09-01');
    let day = '2026-09-02';
    for (let i = 0; i < 8; i++) {
      m = ops.recordRevision(m, 'a', i % 2 ? 'hint' : 'forgot', day);
      day = m.a.revision!.due!;
    }
    expect(m.a.revisionCount).toBe(8);
    expect(m.a.revision!.stage).toBe(0);
    expect(m.a.revision!.due).not.toBeNull();
  });
});

describe('weak problems', () => {
  it('weak = 2+ Forgot / Needed hint among the last 4 attempts, recalculated after every attempt', () => {
    const state = (rs: RevisionResult[]): RevisionState => ({ stage: 1, due: '2026-10-01', attempts: rs.map((r) => att(1, r)) });
    expect(isWeak(state(['solved', 'hint']))).toBe(false);
    expect(isWeak(state(['forgot', 'hint']))).toBe(true);
    expect(isWeak(state(['forgot', 'solved', 'solved', 'solved']))).toBe(false); // the old failure fell out of the window
    expect(isWeak(state(['solved', 'forgot', 'solved', 'hint']))).toBe(true);
  });

  it('a mastered problem is never weak; a problem can be weak AND overdue at once', () => {
    expect(isWeak({ stage: 5, due: null, attempts: [att(5, 'hint'), att(5, 'hint'), att(5, 'solved'), att(5, 'solved')] })).toBe(false);
    const overdueWeak: RevisionState = { stage: 1, due: '2026-09-20', attempts: [att(2, 'forgot'), att(2, 'hint')] };
    const hub = buildRevisionHub(dataset, { [P.id]: entry({ status: 'solved', solvedDate: '2026-09-10', revision: overdueWeak }) }, '2026-09-23');
    expect(hub.overdue.map((i) => i.problem.id)).toEqual([P.id]);
    expect(hub.weak.map((i) => i.problem.id)).toEqual([P.id]);
  });
});

describe('hub classification', () => {
  const day = '2026-09-23';
  const mk = (over: Partial<ProblemProgress>) => entry({ status: 'solved', solvedDate: '2026-09-01', ...over });

  it('puts each problem in the right list, sorted, and shows Solved today from solvedDate', () => {
    const [a, b, c, d, e] = dataset.problems.slice(0, 5);
    const hub = buildRevisionHub(
      dataset,
      {
        [a.id]: mk({ revision: { stage: 1, due: day, attempts: [] } }), // due today
        [b.id]: mk({ revision: { stage: 1, due: '2026-09-21', attempts: [] } }), // overdue 2 days
        [c.id]: mk({ revision: { stage: 1, due: '2026-09-20', attempts: [] } }), // overdue 3 days (comes first)
        [d.id]: mk({ revision: { stage: 2, due: '2026-09-25', attempts: [] } }), // upcoming
        [e.id]: mk({ solvedDate: day, revision: newRevisionState(day) }), // solved today, scheduled
        ghost: mk({ revision: { stage: 1, due: day, attempts: [] } }), // not in the dataset: ignored
      },
      day,
    );
    expect(hub.dueToday.map((i) => i.problem.id)).toEqual([a.id]);
    expect(hub.overdue.map((i) => i.problem.id)).toEqual([c.id, b.id]);
    expect(hub.upcoming.map((i) => i.problem.id)).toEqual([e.id, d.id]); // 24 Sep before 25 Sep
    expect(hub.solvedToday.map((i) => i.problem.id)).toEqual([e.id]);
    expect(hub.todo).toBe(3);
  });

  it('old solved problems with no revision data are NOT in any revision list (no mass enrolment)', () => {
    const legacy: ProgressMap = {};
    dataset.problems.slice(0, 200).forEach((p) => (legacy[p.id] = mk({ revisionCount: 2, lastRevised: '2026-09-10' })));
    const hub = buildRevisionHub(dataset, legacy, day);
    expect(hub.dueToday.length + hub.overdue.length + hub.upcoming.length + hub.mastered.length + hub.weak.length).toBe(0);
    expect(hub.todo).toBe(0);
  });

  it('a problem solved today before the hub existed is listed, and can be added to the schedule by hand', () => {
    const m: ProgressMap = { [P.id]: mk({ solvedDate: day }) };
    let hub = buildRevisionHub(dataset, m, day);
    expect(hub.solvedToday).toHaveLength(1);
    expect(hub.solvedToday[0].item).toBeNull();
    const after = ops.enrollRevision(m, P.id, day);
    hub = buildRevisionHub(dataset, after, day);
    expect(hub.solvedToday[0].item?.state).toEqual({ stage: 0, due: '2026-09-24', attempts: [] });
    expect(ops.enrollRevision(after, P.id, '2026-10-01')[P.id].revision).toEqual(after[P.id].revision); // never re-enrols
  });
});

describe('storage compatibility', () => {
  it('loads old saves without revision data untouched, and adds no revision fields', () => {
    const old = { version: 1, entries: { a: { status: 'solved', notes: 'n', important: true, needsRevision: false, revisionCount: 3, lastRevised: '2026-09-01', solvedDate: '2026-08-30' } } };
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(old));
    const m = loadProgress();
    expect(m.a).toEqual(old.entries.a);
    expect('revision' in m.a).toBe(false);
  });

  it('a hub state survives save -> load and export -> import', () => {
    const m = ops.recordRevision(ops.setStatus({}, 'a', 'solved', '2026-09-23'), 'a', 'hint', '2026-09-24');
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries: m }));
    expect(loadProgress().a.revision).toEqual(m.a.revision);
    const r = parseImport(JSON.stringify(buildExport(m, { checksum: 'x', problemCount: 455 })));
    expect(r.ok && r.progress.a.revision).toEqual(m.a.revision);
  });

  it('rejects an import with broken revision data, accepts one with none', () => {
    const base = { app: 'madhavs-dsa-sheet', version: 1 };
    const e = entry({ status: 'solved', solvedDate: '2026-09-01' });
    expect(parseImport(JSON.stringify({ ...base, progress: { a: e } })).ok).toBe(true);
    const bad = parseImport(JSON.stringify({ ...base, progress: { a: { ...e, revision: { stage: 'x', due: '2026-09-01', attempts: [] } } } }));
    expect(bad.ok).toBe(false);
  });

  it('repairs a partly bad attempt list instead of dropping the whole schedule', () => {
    const e = { ...entry({ status: 'solved', solvedDate: '2026-09-01' }), revision: { stage: 1, due: '2026-09-05', attempts: [att(1, 'solved'), { revision: 9, date: 'nope', result: '??' }] } };
    window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries: { a: e } }));
    expect(loadProgress().a.revision).toEqual({ stage: 1, due: '2026-09-05', attempts: [att(1, 'solved')] });
  });
});

describe('Revision Hub page', () => {
  const section = (name: string | RegExp) => within(screen.getByRole('region', { name }));

  it('solving a problem on the Roadmap puts it in Solved today and Scheduled (revision 1, due tomorrow), and it survives a refresh', async () => {
    const user = userEvent.setup();
    const view = renderApp('/roadmap');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), String(P.stepNo));
    await user.click(within(cardOf(P.id)).getByRole('button', { name: 'Solved' }));
    expect(storedProgress()[P.id].revision).toEqual({ stage: 0, due: addDaysLocal(TODAY, 1), attempts: [] });
    view.unmount();

    renderApp('/revision');
    expect(screen.getByRole('heading', { level: 1, name: 'Revision Hub' })).toBeInTheDocument();
    expect(section(/^Solved today/).getByRole('heading', { name: P.title })).toBeInTheDocument();
    expect(screen.getByTestId('hub-solved-today')).toHaveTextContent('1');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('0');
    const scheduled = document.querySelector(`li[data-revision-problem="${P.id}"][data-phase="upcoming"]`) as HTMLElement;
    expect(within(scheduled).getByTestId('revision-progress')).toHaveTextContent('Revision 1/5');
    expect(within(scheduled).getByText('Due tomorrow')).toBeInTheDocument();
  });

  it('shows the actual problem names under Revise today and Overdue; results are recorded in the Revision Session, not on the cards', async () => {
    const user = userEvent.setup();
    seedProgress({
      [P.id]: entry({ status: 'solved', solvedDate: addDaysLocal(TODAY, -3), revision: { stage: 1, due: TODAY, attempts: [att(1, 'solved', addDaysLocal(TODAY, -2))] }, lastRevised: addDaysLocal(TODAY, -2), revisionCount: 1 }),
      [Q.id]: entry({ status: 'solved', solvedDate: addDaysLocal(TODAY, -9), revision: { stage: 2, due: addDaysLocal(TODAY, -2), attempts: [] } }),
    });
    renderApp('/revision');
    const due = section('Revise today');
    expect(due.getByRole('heading', { name: P.title })).toBeInTheDocument();
    expect(due.getByTestId('revision-progress')).toHaveTextContent('Revision 2/5');
    expect(due.getByText('Due today')).toBeInTheDocument();
    const over = section('Overdue');
    expect(over.getByRole('heading', { name: Q.title })).toBeInTheDocument();
    expect(over.getByText('Overdue by 2 days')).toBeInTheDocument();
    expect(over.getByTestId('revision-progress')).toHaveTextContent('Revision 3/5');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('1');
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('1');

    // The cards only show status; there is no way to record a result from them.
    for (const name of [/^Start Revision$/, /^Revise Now$/, /^Forgot/, /^Needed hint/, /^Solved\b/]) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('group', { name: /Record revision/ })).toBeNull();

    // A real revision goes through the session: overdue first, then due today.
    await user.click(screen.getByRole('button', { name: 'Start Revision Session' }));
    await user.click(screen.getByRole('button', { name: /^Solved easily/ })); // Q (overdue)
    await user.click(screen.getByRole('button', { name: /^Needed hint/ })); // P (due today)
    expect(storedProgress()[Q.id].revision).toMatchObject({ stage: 3, due: addDaysLocal(TODAY, 7) });
    const saved = storedProgress()[P.id];
    expect(saved.revision).toMatchObject({ stage: 1, due: addDaysLocal(TODAY, 3) }); // same stage again, in 3 days
    expect(saved.revision!.attempts.at(-1)).toMatchObject({ revision: 2, date: TODAY, result: 'hint' });
    expect(saved).toMatchObject({ revisionCount: 2, lastRevised: TODAY, status: 'solved' });
    await user.click(screen.getByRole('button', { name: 'Back to Revision Hub' }));
    expect(within(screen.getByRole('region', { name: 'Revise today' })).queryByRole('heading', { name: P.title })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Overdue' })).queryByRole('heading', { name: Q.title })).toBeNull();
  });

  it('lists weak and mastered problems by name, and shows the per-problem history', () => {
    const [w, m] = [dataset.problems[30], dataset.problems[31]];
    seedProgress({
      [w.id]: entry({ status: 'solved', solvedDate: '2026-08-01', revision: { stage: 2, due: addDaysLocal(TODAY, 5), attempts: [att(1, 'solved', '2026-08-02'), att(2, 'forgot', '2026-08-05'), att(2, 'hint', '2026-08-06')] } }),
      [m.id]: entry({ status: 'solved', solvedDate: '2026-07-01', revision: run(['solved', 'easy', 'solved', 'solved', 'easy'], '2026-07-01') }),
    });
    renderApp('/revision');
    const weakLi = document.querySelector(`li[data-revision-problem="${w.id}"][data-phase="upcoming"]`) as HTMLElement;
    expect(weakLi).toHaveTextContent('Weak');
    expect(weakLi).toHaveTextContent('Revision attempts: 3 · Forgot: 1 · Needed hint: 1');
    const hist = within(within(weakLi).getByRole('list', { name: /Revision history/ }));
    expect(hist.getByText('Revision 2 (repeat):')).toBeInTheDocument();
    expect(hist.getAllByText(/Pending/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('hub-mastered')).toHaveTextContent('1');
    const masteredLi = document.querySelector(`li[data-revision-problem="${m.id}"][data-phase="mastered"]`) as HTMLElement;
    expect(within(masteredLi).getByRole('heading', { name: m.title })).toBeInTheDocument();
    expect(masteredLi).toHaveTextContent('All 5 revisions completed');
  });

  it('the manual flag / Mark revised flow still works next to the schedule', async () => {
    const user = userEvent.setup();
    seedProgress({ [P.id]: entry({ status: 'solved', solvedDate: '2026-09-01', needsRevision: true }) });
    renderApp('/revision');
    expect(screen.getByTestId('revision-count')).toHaveTextContent('1 to revise');
    await user.click(within(cardOf(P.id)).getByRole('button', { name: 'Mark revised' }));
    expect(screen.getByText(/Nothing to revise/)).toBeInTheDocument();
    expect(storedProgress()[P.id]).toMatchObject({ needsRevision: false, revisionCount: 1, lastRevised: TODAY });
    expect(storedProgress()[P.id].revision).toBeUndefined(); // still not auto-enrolled
  });
});
