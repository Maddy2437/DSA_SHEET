import { Check, ChevronRight, History, Lightbulb, Play, Sparkles, Trophy, X } from 'lucide-react';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { useProgressActions } from '../hooks/useProgress';
import type { RevisionResult } from '../types';
import { shortTitle } from '../utils/dataset';
import { formatDate } from '../utils/dates';
import { resolveResources } from '../utils/resources';
import {
  countAttempts,
  currentRevision,
  daysOverdue,
  daysUntilDue,
  REVISION_STAGES,
  RESULT_HELP,
  RESULT_LABEL,
  RESULTS,
  revisionHistory,
  type RevisionItem,
} from '../utils/revision';
import { DifficultyBadge } from './DifficultyBadge';
import { ProgressBar, SOLVED_BAR } from './ProgressBar';
import { ResourceButtons } from './ResourceButtons';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const EDGE: Record<RevisionItem['phase'], string> = {
  overdue: 'border-l-rose-500',
  due: 'border-l-amber-400',
  upcoming: 'border-l-transparent',
  mastered: 'border-l-emerald-500',
};

const RESULT_STYLE: Record<RevisionResult, { icon: ReactNode; cls: string }> = {
  forgot: { icon: <X aria-hidden className="size-4" />, cls: 'border-rose-500/50 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300' },
  hint: { icon: <Lightbulb aria-hidden className="size-4" />, cls: 'border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300' },
  solved: { icon: <Check aria-hidden className="size-4" />, cls: 'border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300' },
  easy: { icon: <Sparkles aria-hidden className="size-4" />, cls: 'border-emerald-500 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300' },
};

const RESULT_TEXT: Record<RevisionResult, string> = {
  forgot: 'text-rose-600 dark:text-rose-300',
  hint: 'text-amber-700 dark:text-amber-300',
  solved: 'text-emerald-600 dark:text-emerald-400',
  easy: 'text-emerald-600 dark:text-emerald-400',
};

interface Props {
  item: RevisionItem;
  today: string;
  /** Weak Problems section: also show the problem's pattern tags. */
  showPattern?: boolean;
}

export const RevisionCard = memo(function RevisionCard({ item, today, showPattern = false }: Props) {
  const actions = useProgressActions();
  const { problem, entry, state, phase, weak } = item;
  const [started, setStarted] = useState(false);
  const resources = useMemo(() => resolveResources(problem), [problem]);
  const history = useMemo(() => revisionHistory(state), [state]);
  const counts = countAttempts(state);
  const actionable = phase === 'due' || phase === 'overdue';
  const confirming = state.stage >= REVISION_STAGES && state.due !== null;

  const revisionText =
    phase === 'mastered'
      ? `All ${REVISION_STAGES} revisions completed`
      : confirming
        ? `Confirmation revision (${REVISION_STAGES}/${REVISION_STAGES} completed)`
        : `Revision ${currentRevision(state)}/${REVISION_STAGES}`;

  const dueText =
    phase === 'overdue'
      ? `Overdue by ${plural(daysOverdue(state, today), 'day')}`
      : phase === 'due'
        ? 'Due today'
        : phase === 'upcoming'
          ? daysUntilDue(state, today) === 1
            ? 'Due tomorrow'
            : `Due in ${plural(daysUntilDue(state, today), 'day')}`
          : 'Mastered';

  const badge =
    phase === 'overdue'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300'
      : phase === 'due'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : phase === 'mastered'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-line text-muted';

  return (
    <li
      data-revision-problem={problem.id}
      data-phase={phase}
      className={`rounded-lg border border-l-4 border-line bg-surface p-3 sm:p-4 ${EDGE[phase]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold leading-snug sm:text-base">{problem.title}</h3>
            <DifficultyBadge difficulty={problem.difficulty} />
            {weak && (
              <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-300">
                Weak
              </span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <span>{problem.stepNo}. {shortTitle(problem.stepTitle)}</span>
            <ChevronRight aria-hidden className="size-3" />
            <span>{problem.subTitle}</span>
          </p>
          {showPattern && problem.tags.length > 0 && <p className="mt-0.5 text-xs text-muted">Pattern: {problem.tags.join(', ')}</p>}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge}`}>
          {phase === 'mastered' && <Trophy aria-hidden className="size-3.5" />}
          {dueText}
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <p className="text-sm font-medium" data-testid="revision-progress">
          {revisionText}
          {phase !== 'mastered' && !confirming && (
            <span className="font-normal text-muted"> · {state.stage} of {REVISION_STAGES} revisions completed</span>
          )}
        </p>
        <ProgressBar label={`${problem.title} revisions completed`} total={REVISION_STAGES} className="h-1.5" segments={[{ value: state.stage, className: SOLVED_BAR }]} />
        <p className="text-xs text-muted">
          Last revised: {formatDate(entry.lastRevised)}
          {state.due !== null && <> · Next revision: {formatDate(state.due)}</>}
        </p>
        {counts.attempts > 0 && (
          <p className="text-xs text-muted">
            Revision attempts: {counts.attempts} · Forgot: {counts.forgot} · Needed hint: {counts.hint}
            {weak && <span className="font-medium text-rose-600 dark:text-rose-300"> · Status: Weak</span>}
          </p>
        )}
      </div>

      {actionable && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={started}
            onClick={() => setStarted((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            <Play aria-hidden className="size-3.5" /> {phase === 'overdue' ? 'Revise Now' : 'Start Revision'}
          </button>
        </div>
      )}

      {actionable && started && (
        <div role="group" aria-label={`Record revision for ${problem.title}`} className="mt-3 space-y-3 rounded-lg border border-line bg-bg p-3">
          <div className="space-y-1.5">
            <p className="text-xs text-muted">Solve it again from memory first. Open it here if you need the problem statement:</p>
            <ResourceButtons resources={resources} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">How did it go?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => actions.recordRevision(problem.id, r)}
                  className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left ${RESULT_STYLE[r].cls}`}
                >
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    {RESULT_STYLE[r].icon} {RESULT_LABEL[r]}
                  </span>
                  <span className="text-xs text-muted">{RESULT_HELP[r]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1 py-0.5 font-medium text-muted hover:bg-surface2">
          <History aria-hidden className="size-3.5" /> Revision history
        </summary>
        <ol className="mt-2 space-y-1 border-l border-line pl-3" aria-label={`Revision history for ${problem.title}`}>
          <li>
            <span className="font-medium">Solved:</span> {formatDate(entry.solvedDate)}
          </li>
          {history.map((row, i) => (
            <li key={i}>
              <span className="font-medium">{row.label}:</span> {formatDate(row.date)}
              {row.result ? (
                <span className={`font-medium ${RESULT_TEXT[row.result]}`}> · Result: {RESULT_LABEL[row.result]}</span>
              ) : (
                <span className="text-muted"> · Pending (planned)</span>
              )}
            </li>
          ))}
          {state.due === null && (
            <li className="font-medium text-emerald-600 dark:text-emerald-400">Mastered</li>
          )}
        </ol>
      </details>
    </li>
  );
});
