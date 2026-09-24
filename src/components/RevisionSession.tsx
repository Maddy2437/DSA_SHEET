import { ChevronRight, CircleCheck, Eye, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useProgressActions } from '../hooks/useProgress';
import type { RevisionResult } from '../types';
import { shortTitle } from '../utils/dataset';
import { resolveResources } from '../utils/resources';
import {
  countAttempts,
  currentRevision,
  REVISION_STAGES,
  RESULT_LABEL,
  RESULTS,
  type SessionEntry,
  type SessionKind,
} from '../utils/revision';
import { DifficultyBadge } from './DifficultyBadge';
import { ProgressBar, SOLVED_BAR } from './ProgressBar';
import { ResourceButtons } from './ResourceButtons';
import { ResultButtons } from './ResultButtons';

interface Props {
  kind: SessionKind;
  /** The queue, fixed when the session started. Its length is the session's denominator and never changes. */
  entries: SessionEntry[];
  onExit: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TAG: Record<SessionEntry['mode'], string> = {
  overdue: 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300',
  due: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  practice: 'border-line text-muted',
};

export function RevisionSession({ kind, entries, onExit }: Props) {
  const actions = useProgressActions();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<RevisionResult[]>([]); // one per problem that was really completed
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const total = entries.length;
  const finished = index >= total;
  const practice = kind === 'weak';
  const heading = practice ? 'Practice Weak Problems' : 'Revision Session';
  const entry = finished ? null : entries[index];
  const resources = useMemo(() => (entry ? resolveResources(entry.item.problem) : []), [entry]);

  const next = () => {
    setIndex((i) => i + 1);
    setRevealed(false);
    setError(null);
  };

  const choose = (result: RevisionResult) => {
    if (!entry) return;
    // Only a real (overdue / due) revision is saved, through the same recordRevision every revision uses. If it cannot
    // be saved (it changed elsewhere, or revision was paused in another tab) it is NOT counted and we say so.
    // Weak-problem practice is a self-check: nothing is saved, so no schedule, stage or history can change.
    if (entry.mode !== 'practice' && !actions.recordRevision(entry.item.problem.id, result)) {
      setError(
        'This revision could not be saved, so it was not counted. It may already have been revised, or revision was paused in another tab.',
      );
      return;
    }
    setResults((r) => [...r, result]);
    next();
  };

  const skip = () => {
    setSkipped((n) => n + 1);
    next();
  };

  if (finished) {
    const count = (r: RevisionResult) => results.filter((x) => x === r).length;
    return (
      <section aria-labelledby="session-done" className="mx-auto max-w-2xl space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <CircleCheck aria-hidden className="size-6 text-emerald-500" />
          <h2 id="session-done" className="text-lg font-semibold tracking-tight">
            {practice ? 'Practice Complete' : 'Revision Complete'}
          </h2>
        </div>
        <p className="text-sm" data-testid="session-completed">
          <span className="font-semibold">{results.length} / {total}</span> completed
        </p>
        {skipped > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="session-skipped">
            {plural(skipped, 'problem')} skipped: not saved and not counted. They are still due.
          </p>
        )}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RESULTS.map((r) => (
            <div key={r} data-testid={`session-${r}`} className="rounded-lg border border-line px-3 py-2">
              <dt className="text-xs text-muted">{RESULT_LABEL[r]}</dt>
              <dd className="text-xl font-semibold">{count(r)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          {practice
            ? 'This was a self-check only. Nothing was saved: no schedule, stage or history changed.'
            : 'Each result was saved as you went and the next revision was scheduled.'}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          Back to Revision Hub
        </button>
      </section>
    );
  }

  const { problem, state } = entry!.item;
  const counts = countAttempts(state);
  const confirming = state.stage >= REVISION_STAGES;
  const revisionLabel = confirming ? 'Confirmation revision' : `Revision ${currentRevision(state)}/${REVISION_STAGES}`;
  const tag =
    entry!.mode === 'overdue'
      ? `Overdue by ${plural(entry!.item.overdueDays, 'day')}`
      : entry!.mode === 'due'
        ? 'Due today'
        : 'Practice / Self-check';

  return (
    <section aria-label={heading} className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface2"
        >
          <X aria-hidden className="size-3.5" /> Exit session
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span data-testid="session-position">Problem {index + 1} of {total}</span>
          <span className="text-xs text-muted" data-testid="session-done-count">{results.length} / {total} done</span>
        </div>
        <ProgressBar label="Session progress" total={total} segments={[{ value: results.length, className: SOLVED_BAR }]} />
      </div>

      <article data-session-problem={problem.id} className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${TAG[entry!.mode]}`}>{tag}</span>
          <DifficultyBadge difficulty={problem.difficulty} />
          <span className="text-xs text-muted">{practice ? `Currently at ${revisionLabel}` : revisionLabel}</span>
        </div>

        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold leading-snug sm:text-xl">{problem.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted">
            <span>{problem.stepNo}. {shortTitle(problem.stepTitle)}</span>
            <ChevronRight aria-hidden className="size-3.5" />
            <span>{problem.subTitle}</span>
          </p>
          {problem.tags.length > 0 && <p className="mt-0.5 text-xs text-muted">Pattern: {problem.tags.join(', ')}</p>}
          {counts.attempts > 0 && (
            <p className="mt-0.5 text-xs text-muted">
              Revision attempts: {counts.attempts} · Forgot: {counts.forgot} · Needed hint: {counts.hint}
            </p>
          )}
        </div>

        <p className="text-sm font-medium">Can you solve this problem without looking at the solution?</p>
        {practice && (
          <p className="text-xs text-muted">
            Self-check only: your answer is not saved and your revision schedule will not change.
            {(entry!.item.phase === 'due' || entry!.item.phase === 'overdue') &&
              ' This one is also due, so revise it in the Revision Session to have the result recorded.'}
          </p>
        )}

        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={revealed}
            onClick={() => setRevealed((r) => !r)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface2"
          >
            <Eye aria-hidden className="size-4" /> {revealed ? 'Hide Problem' : 'Reveal Problem'}
          </button>
          {revealed && <ResourceButtons resources={resources} />}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">How did it go?</p>
          <ResultButtons onPick={choose} />
        </div>

        {error && (
          <div role="alert" className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
            <p>{error}</p>
            <button
              type="button"
              onClick={skip}
              className="rounded-md border border-rose-500/50 px-2.5 py-1 text-xs font-medium hover:bg-rose-500/10"
            >
              Skip this problem
            </button>
          </div>
        )}
      </article>
    </section>
  );
}
