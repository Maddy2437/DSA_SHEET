import { CheckCheck, ChevronRight, NotebookPen, RotateCcw, Star, TriangleAlert, X } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useProgressActions } from '../hooks/useProgress';
import type { Problem, ProblemProgress } from '../types';
import { shortTitle } from '../utils/dataset';
import { formatDate } from '../utils/dates';
import { defaultEntry } from '../utils/progress';
import { describeFlag, resolveResources } from '../utils/resources';
import { DifficultyBadge } from './DifficultyBadge';
import { ResourceButtons } from './ResourceButtons';
import { StatusControl } from './StatusControl';

const NO_PROGRESS = defaultEntry();

const EDGE: Record<ProblemProgress['status'], string> = {
  not_started: 'border-l-transparent',
  in_progress: 'border-l-amber-400',
  solved: 'border-l-emerald-500',
};

interface Props {
  problem: Problem;
  entry?: ProblemProgress;
  defaultOpen?: boolean;
}

export const ProblemCard = memo(function ProblemCard({ problem, entry, defaultOpen = false }: Props) {
  const actions = useProgressActions();
  const e = entry ?? NO_PROGRESS;
  const [open, setOpen] = useState(defaultOpen);
  const resources = useMemo(() => resolveResources(problem), [problem]);
  const flags = useMemo(() => problem.flags.map(describeFlag), [problem]);
  const reviewFlags = flags.filter((f) => f.review);
  const otherFlags = flags.filter((f) => !f.review);
  const originals = resources.filter((r) => r.originalUrl);
  const showRevisionInfo = e.needsRevision || e.revisionCount > 0;
  const topicName = `${problem.stepNo}. ${shortTitle(problem.stepTitle)}`;

  return (
    <article
      data-problem-id={problem.id}
      aria-label={problem.title}
      className={`rounded-lg border border-l-4 border-line bg-surface p-3 sm:p-4 ${EDGE[e.status]}`}
    >
      {reviewFlags.length > 0 && (
        <div
          role="note"
          data-testid="source-warning"
          className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Known problem in the source sheet:</strong>{' '}
            {reviewFlags.map((f) => f.text).join('; ')}. Left unchanged.
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-9 shrink-0 text-right text-xs text-muted" title={`Position ${problem.ref} in the sheet`}>
          #{problem.order}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold leading-snug sm:text-base">{problem.title}</h3>
            <DifficultyBadge difficulty={problem.difficulty} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <span>{topicName}</span>
            <ChevronRight aria-hidden className="size-3" />
            <span>{problem.subTitle}</span>
          </p>
        </div>
        <button
          type="button"
          aria-pressed={e.important}
          aria-label={e.important ? 'Remove from important' : 'Mark as important'}
          onClick={() => actions.toggleImportant(problem.id)}
          className="rounded-md p-1.5 hover:bg-surface2"
        >
          <Star className={`size-5 ${e.important ? 'fill-yellow-400 text-yellow-400' : 'text-muted'}`} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-12">
        <StatusControl status={e.status} onChange={(s) => actions.setStatus(problem.id, s)} />

        {e.needsRevision ? (
          <>
            <button
              type="button"
              onClick={() => actions.markRevised(problem.id)}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-600"
            >
              <CheckCheck aria-hidden className="size-3.5" /> Mark revised
            </button>
            <button
              type="button"
              aria-label="Clear revision flag"
              title="Clear revision flag without counting a revision"
              onClick={() => actions.toggleNeedsRevision(problem.id)}
              className="rounded-md p-1 text-muted hover:bg-surface2"
            >
              <X aria-hidden className="size-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => actions.toggleNeedsRevision(problem.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface2"
          >
            <RotateCcw aria-hidden className="size-3.5" /> Flag for revision
          </button>
        )}

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface2"
        >
          <NotebookPen aria-hidden className="size-3.5" /> Notes
          {e.notes.trim() !== '' && <span aria-label="has notes" className="size-1.5 rounded-full bg-accent" />}
        </button>
      </div>

      {showRevisionInfo && (
        <p className="mt-2 text-xs text-sky-600 dark:text-sky-300 sm:pl-12" data-testid="revision-info">
          Needs revision: {e.needsRevision ? 'yes' : 'no'}. Revisions: {e.revisionCount}. Last revised: {formatDate(e.lastRevised)}.
        </p>
      )}

      <div className="mt-3 sm:pl-12">
        <ResourceButtons resources={resources} />
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 sm:pl-12">
          <label className="block text-xs font-medium text-muted">
            Notes
            <textarea
              aria-label={`Notes for ${problem.title}`}
              value={e.notes}
              onChange={(ev) => actions.setNotes(problem.id, ev.target.value)}
              rows={4}
              placeholder={'Approach, mistakes, things to remember...'}
              className="mt-1 block w-full rounded-md border border-line bg-bg p-2 text-sm text-fg placeholder:text-muted/70"
            />
          </label>
          {originals.length > 0 && (
            <div className="text-xs text-muted">
              <p className="font-medium">Original links from before the cleanup</p>
              <ul className="mt-1 space-y-0.5">
                {originals.map((r) => (
                  <li key={r.key} className="break-all">
                    {r.label}:{' '}
                    <a href={r.originalUrl!} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                      {r.originalUrl}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {otherFlags.length > 0 && (
            <p className="text-xs text-muted">Source notes: {otherFlags.map((f) => f.text).join('; ')}.</p>
          )}
        </div>
      )}
    </article>
  );
});
