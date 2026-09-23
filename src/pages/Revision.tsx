import { CalendarClock, ChevronDown, RotateCcw, Trophy } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { DifficultyBadge } from '../components/DifficultyBadge';
import { ProblemCard } from '../components/ProblemCard';
import { RevisionCard } from '../components/RevisionCard';
import { useProgress, useProgressActions } from '../hooks/useProgress';
import { useToday } from '../hooks/useToday';
import { dataset, shortTitle } from '../utils/dataset';
import { formatDate } from '../utils/dates';
import { buildRevisionHub, REVISION_STAGES, type RevisionItem, type SolvedTodayItem } from '../utils/revision';

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

function Head({ id, title, count, note }: { id: string; title: ReactNode; count: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <p className="text-sm text-muted">{count}</p>
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

function Fold({ id, title, count, note, open = false, children }: { id: string; title: ReactNode; count: string; note?: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-surface p-4">
      <summary className="flex cursor-pointer select-none list-none items-start gap-2">
        <div className="min-w-0 flex-1">
          <Head id={id} title={title} count={count} note={note} />
        </div>
        <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export default function Revision() {
  const progress = useProgress();
  const today = useToday();
  const hub = useMemo(() => buildRevisionHub(dataset, progress, today), [progress, today]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Revision Hub</h1>
        <p className="mt-0.5 text-sm text-muted">
          Every problem you solve is revised {REVISION_STAGES} times: 1, 3, 7, 14 and 30 days after you first solve it.
        </p>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-4 sm:divide-y-0">
        <Summary id="due" label="Due today" value={hub.dueToday.length} tone="text-amber-500" />
        <Summary id="overdue" label="Overdue" value={hub.overdue.length} tone="text-rose-500" />
        <Summary id="solved-today" label="Solved today" value={hub.solvedToday.length} tone="text-emerald-500" />
        <Summary id="mastered" label="Mastered" value={hub.mastered.length} tone="text-yellow-500" />
      </dl>

      <section aria-labelledby="due-h" className="space-y-3">
        <Head id="due-h" title="Revise today" count={plural(hub.dueToday.length, 'problem')} />
        {hub.dueToday.length === 0 ? (
          <Empty>Nothing due today. Problems you mark Solved are scheduled automatically, with the first revision the next day.</Empty>
        ) : (
          <Cards items={hub.dueToday} today={today} />
        )}
      </section>

      <section aria-labelledby="overdue-h" className="space-y-3">
        <Head id="overdue-h" title="Overdue" count={plural(hub.overdue.length, 'problem')} note="Missed revisions stay here until you complete them." />
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
        {hub.weak.length === 0 ? <Empty>No weak problems right now.</Empty> : <Cards items={hub.weak} today={today} showPattern />}
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
        note={`All ${REVISION_STAGES} revisions done, the last 2 attempts Solved or Solved easily, and no Forgot in the last 3.`}
      >
        {hub.mastered.length === 0 ? <Empty>Nothing mastered yet.</Empty> : <Cards items={hub.mastered} today={today} />}
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
    </div>
  );
}