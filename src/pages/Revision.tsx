import { CalendarClock, ChevronDown, Flame, Pause, Play, RotateCcw, Trophy } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DifficultyBadge } from '../components/DifficultyBadge';
import { PauseDialog } from '../components/PauseDialog';
import { ProblemCard } from '../components/ProblemCard';
import { ProgressBar, SOLVED_BAR } from '../components/ProgressBar';
import { RevisionCard } from '../components/RevisionCard';
import { RevisionSession } from '../components/RevisionSession';
import { usePauses, useProgress, useProgressActions } from '../hooks/useProgress';
import { useRevisionHub } from '../hooks/useRevisionHub';
import { useSettings } from '../hooks/useSettings';
import { useToday } from '../hooks/useToday';
import { shortTitle } from '../utils/dataset';
import { formatDate } from '../utils/dates';
import {
  buildSession,
  masteredByTopic,
  resumeDate,
  revisionConsistency,
  REVISION_STAGES,
  type RevisionItem,
  type SessionEntry,
  type SessionKind,
  type SolvedTodayItem,
} from '../utils/revision';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Summary({ id, label, value, tone = '' }: { id: string; label: string; value: number; tone?: string }) {
  return (
    <div data-testid={`hub-${id}`} className="px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">
        <span className={`text-2xl font-semibold ${tone}`}>{value}</span>{' '}
        <span className="text-xs text-muted">{value === 1 ? 'problem' : 'problems'}</span>
      </dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">{children}</p>;
}

function Head({ id, title, count, note, countTestId }: { id: string; title: ReactNode; count: string; note?: string; countTestId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <p className="text-sm text-muted" data-testid={countTestId}>{count}</p>
    </div>
  );
}

function Cards({ items, today, showPattern }: { items: RevisionItem[]; today: string; showPattern?: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <RevisionCard key={i.problem.id} item={i} today={today} showPattern={showPattern} />
      ))}
    </ul>
  );
}

// Solved today: scheduled problems get the full revision card; older solves that are not in the schedule get a short row.
function SolvedTodayList({ items, today }: { items: SolvedTodayItem[]; today: string }) {
  const actions = useProgressActions();
  return (
    <ul className="space-y-2">
      {items.map(({ problem, entry, item }) =>
        item ? (
          <RevisionCard key={problem.id} item={item} today={today} />
        ) : (
          <li key={problem.id} data-revision-problem={problem.id} className="rounded-lg border border-line bg-surface p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-sm font-semibold leading-snug sm:text-base">{problem.title}</h3>
              <DifficultyBadge difficulty={problem.difficulty} />
            </div>
            <p className="mt-0.5 text-xs text-muted">{problem.stepNo}. {shortTitle(problem.stepTitle)} &rsaquo; {problem.subTitle}</p>
            <p className="mt-2 text-xs text-muted">Not in the revision schedule (it was solved before the Revision Hub).</p>
            {entry.status === 'solved' && (
              <button
                type="button"
                onClick={() => actions.enrollRevision(problem.id)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface2"
              >
                <CalendarClock aria-hidden className="size-3.5" /> Add to schedule
              </button>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

function Fold({ id, title, count, note, open = false, countTestId, children }: { id: string; title: ReactNode; count: string; note?: string; open?: boolean; countTestId?: string; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-surface p-4">
      <summary className="flex cursor-pointer select-none list-none items-start gap-2">
        <div className="min-w-0 flex-1">
          <Head id={id} title={title} count={count} note={note} countTestId={countTestId} />
        </div>
        <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90';
const btnGhost = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-surface2';

interface ActiveSession {
  id: number;
  kind: SessionKind;
  entries: SessionEntry[];
}

export default function Revision() {
  const progress = useProgress();
  const pauses = usePauses();
  const actions = useProgressActions();
  const { settings } = useSettings();
  const today = useToday();
  const hub = useRevisionHub();
  const consistency = useMemo(() => revisionConsistency(progress, pauses, today), [progress, pauses, today]);
  const mastered = useMemo(() => masteredByTopic(hub.mastered), [hub.mastered]);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const closePause = useCallback(() => setPauseOpen(false), []);
  const nextId = useRef(0);

  // The queue is fixed here, when the session starts: its length never changes while you work through it.
  const start = (kind: SessionKind) => {
    const entries = buildSession(hub, kind);
    if (entries.length > 0) setSession({ id: ++nextId.current, kind, entries });
  };

  if (session) {
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Revision Hub</h1>
        <RevisionSession key={session.id} kind={session.kind} entries={session.entries} onExit={() => setSession(null)} />
      </div>
    );
  }

  const { remaining, workload } = hub; // workload = revised today + still to revise: it stays put as you work
  const target = settings.revisionTarget;
  const paused = hub.paused;
  const plainStatus = paused
    ? 'Revision is paused.'
    : remaining > 0
      ? `${plural(remaining, 'problem')} to revise today.`
      : hub.completedToday > 0
        ? 'All done for today.'
        : 'Nothing due today.';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Revision Hub</h1>
        <p className="mt-0.5 text-sm text-muted">
          Every problem you solve is revised {REVISION_STAGES} times: 1, 3, 7, 14 and 30 days after you first solve it.
        </p>
      </div>

      <section aria-labelledby="today-h" className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 id="today-h" className="text-base font-semibold tracking-tight">Today's revision</h2>
            <p className="text-sm text-muted" data-testid="today-status">{plainStatus}</p>
          </div>
          {!paused && (
            <div className="flex flex-wrap gap-2">
              {remaining > 0 && (
                <button type="button" onClick={() => start('due')} className={btnPrimary}>
                  <Play aria-hidden className="size-4" /> Start Revision Session
                </button>
              )}
              <button type="button" onClick={() => setPauseOpen(true)} className={btnGhost}>
                <Pause aria-hidden className="size-4" /> Pause Revision
              </button>
            </div>
          )}
        </div>

        {paused && (
          <div role="status" className="mx-4 mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-700 dark:text-sky-300">
            <div className="flex min-w-0 items-start gap-2">
              <Pause aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">Revision Paused</p>
                <p>Revision schedule is paused until {formatDate(paused.end)}. It resumes on {formatDate(resumeDate(paused))}.</p>
                <p className="mt-0.5 text-xs">
                  Revisions that were not yet overdue have moved forward, so the break creates no new overdue work. Ones that
                  were already overdue keep their original due dates and stay overdue, frozen. Problems you solve now start
                  their schedule after the break.
                </p>
              </div>
            </div>
            <button type="button" onClick={() => actions.resumeRevision()} className={btnGhost}>
              <Play aria-hidden className="size-4" /> Resume Early
            </button>
          </div>
        )}

        <dl className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-4 sm:divide-y-0">
          <Summary id="due" label="Due today" value={hub.dueToday.length} tone="text-amber-500" />
          <Summary id="overdue" label="Overdue" value={hub.overdue.length} tone="text-rose-500" />
          <Summary id="completed" label="Completed today" value={hub.completedToday} tone="text-emerald-500" />
          <Summary id="solved-today" label="Solved today" value={hub.solvedToday.length} />
        </dl>

        {paused && hub.overdue.length > 0 && (
          <p className="border-t border-line p-4 text-xs text-muted" data-testid="frozen-summary">
            {plural(hub.overdue.length, 'overdue revision')} frozen during the pause. They keep their original due dates,
            stay listed below and do not get more overdue while you are away.
          </p>
        )}

        {!paused && workload > 0 && (
          <div className="space-y-1.5 border-t border-line p-4">
            <div className="flex items-baseline justify-between text-sm">
              <span>Today's queue</span>
              <span className="text-muted" data-testid="queue-progress">{hub.completedToday} / {workload} done</span>
            </div>
            <ProgressBar label="Today's revision queue" total={workload} segments={[{ value: hub.completedToday, className: SOLVED_BAR }]} />
            {hub.overdue.length > 0 && (
              <p className="pt-1 text-xs text-rose-600 dark:text-rose-300" data-testid="overdue-nudge">
                {plural(hub.overdue.length, 'revision')} overdue. Start the session to clear them: overdue problems come first.
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="daily-h" className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <h2 id="daily-h" className="text-base font-semibold tracking-tight">Daily progress</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Today's workload</dt>
              <dd className="text-xl font-semibold" data-testid="daily-workload">{workload}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Revision target</dt>
              <dd className="text-xl font-semibold" data-testid="daily-target">{target}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Completed</dt>
              <dd className="text-xl font-semibold" data-testid="daily-completed">{hub.completedToday}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Remaining</dt>
              <dd className="text-xl font-semibold" data-testid="daily-remaining">{Math.max(0, workload - hub.completedToday)}</dd>
            </div>
          </dl>
          <ProgressBar label="Revision target progress" total={target} segments={[{ value: Math.min(hub.completedToday, target), className: SOLVED_BAR }]} />
          <p className="text-xs text-muted">
            Workload = revisions due today plus overdue. The target is your goal for the day, not a limit on what is
            due. <Link to="/settings" className="underline hover:text-fg">Change the target in Settings</Link>.
          </p>
        </section>

        <section aria-labelledby="consistency-h" className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <h2 id="consistency-h" className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <Flame aria-hidden className="size-4 text-orange-500" /> Consistency
          </h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Current streak</dt>
              <dd className="text-xl font-semibold" data-testid="rev-streak">{plural(consistency.current, 'revision day')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Last 7 days</dt>
              <dd className="text-xl font-semibold" data-testid="rev-last7">{consistency.last7} / 7</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">
            The streak counts revision days in a row, not calendar days: a day counts when you record at least one revision
            result. Paused days and days with nothing due are skipped. A day with revisions due and none done breaks it.
          </p>
        </section>
      </div>

      <section aria-labelledby="due-h" className="space-y-3">
        <Head id="due-h" title="Revise today" count={plural(hub.dueToday.length, 'problem')} />
        {hub.dueToday.length === 0 ? (
          <Empty>{paused ? 'Revision is paused, so nothing is due.' : 'Nothing due today. Problems you mark Solved are scheduled automatically, with the first revision the next day.'}</Empty>
        ) : (
          <Cards items={hub.dueToday} today={today} />
        )}
      </section>

      <section aria-labelledby="overdue-h" className="space-y-3">
        <Head
          id="overdue-h"
          title="Overdue"
          count={plural(hub.overdue.length, 'problem')}
          note={paused ? 'Frozen during pause: original due dates, no new overdue time while paused.' : 'Missed revisions stay here until you complete them.'}
        />
        {hub.overdue.length === 0 ? <Empty>No overdue revisions.</Empty> : <Cards items={hub.overdue} today={today} />}
      </section>

      <section aria-labelledby="solved-h" className="space-y-3">
        <Head id="solved-h" title={<>Solved today &mdash; {formatDate(today)}</>} count={plural(hub.solvedToday.length, 'problem')} />
        {hub.solvedToday.length === 0 ? (
          <Empty>No problems solved today yet. Mark one Solved on the Roadmap and it shows up here.</Empty>
        ) : (
          <SolvedTodayList items={hub.solvedToday} today={today} />
        )}
      </section>

      <Fold
        id="weak-h"
        title="Weak problems"
        count={plural(hub.weak.length, 'problem')}
        note="2 or more Forgot / Needed hint among the last 4 revision attempts."
        open={hub.weak.length > 0}
      >
        {hub.weak.length === 0 ? (
          <Empty>No weak problems right now.</Empty>
        ) : (
          <div className="space-y-3">
            {!paused && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => start('weak')} className={btnGhost}>
                  <Play aria-hidden className="size-4" /> Practice Weak Problems
                </button>
                <p className="min-w-0 flex-1 text-xs text-muted">
                  Self-check only: nothing is saved, so your schedule, stages and history stay exactly as they are.
                </p>
              </div>
            )}
            <Cards items={hub.weak} today={today} showPattern />
          </div>
        )}
      </Fold>

      <Fold id="upcoming-h" title="Scheduled" count={plural(hub.upcoming.length, 'problem')} note="Not due yet, soonest first.">
        {hub.upcoming.length === 0 ? <Empty>Nothing scheduled yet.</Empty> : <Cards items={hub.upcoming} today={today} />}
      </Fold>

      <Fold
        id="mastered-h"
        title={
          <span className="inline-flex items-center gap-1.5">
            <Trophy aria-hidden className="size-4 text-yellow-500" /> Mastered
          </span>
        }
        count={plural(hub.mastered.length, 'problem')}
        countTestId="hub-mastered"
        note={`All ${REVISION_STAGES} revisions done, the last 2 attempts Solved or Solved easily, and no Forgot in the last 3.`}
      >
        {hub.mastered.length === 0 ? (
          <Empty>Nothing mastered yet.</Empty>
        ) : (
          <div className="space-y-3">
            <ul aria-label="Mastered by topic" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {mastered.map((t) => (
                <li key={t.stepNo}>
                  {shortTitle(t.stepTitle)} <span className="font-semibold text-fg">{t.count}</span>
                </li>
              ))}
            </ul>
            <Cards items={hub.mastered} today={today} />
          </div>
        )}
      </Fold>

      <section aria-labelledby="flagged-h" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <div>
            <h2 id="flagged-h" className="text-base font-semibold tracking-tight">Flagged for revision</h2>
            <p className="text-xs text-muted">Problems you flagged by hand, with or without a schedule.</p>
          </div>
          <p className="text-sm text-muted" data-testid="revision-count">{hub.flagged.length} to revise</p>
        </div>
        {hub.flagged.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
            <RotateCcw aria-hidden className="mx-auto mb-2 size-6" />
            <p>Nothing to revise. Use "Flag for revision" on a problem to add it here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {hub.flagged.map(({ problem, entry }) => (
              <ProblemCard key={problem.id} problem={problem} entry={entry} defaultOpen />
            ))}
          </div>
        )}
      </section>

      {pauseOpen && (
        <PauseDialog
          today={today}
          onCancel={closePause}
          onConfirm={(until) => {
            actions.pauseRevision(until);
            closePause();
          }}
        />
      )}
    </div>
  );
}
