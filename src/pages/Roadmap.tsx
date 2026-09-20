import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FilterBar } from '../components/FilterBar';
import { ProblemCard } from '../components/ProblemCard';
import { ProgressBar, SOLVED_BAR } from '../components/ProgressBar';
import { useFilters } from '../hooks/useFilters';
import { useProgress } from '../hooks/useProgress';
import { dataset } from '../utils/dataset';
import { filterProblems, filtersActive, groupMatches } from '../utils/filters';

export default function Roadmap() {
  const { filters, clearFilters } = useFilters();
  const progress = useProgress();
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  const active = filtersActive(filters);
  const matches = useMemo(() => filterProblems(dataset.problems, filters, progress), [filters, progress]);
  const groups = useMemo(() => groupMatches(dataset, matches), [matches]);

  const toggle = (n: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Roadmap</h1>
        <p className="text-sm text-muted" data-testid="match-count" aria-live="polite">
          {active ? `${matches.length} of ${dataset.problems.length} problems match` : `${dataset.problems.length} problems in ${dataset.topics.length} topics`}
        </p>
      </div>

      <FilterBar />

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          <p>No problems match these filters.</p>
          <button type="button" onClick={clearFilters} className="mt-2 font-medium text-accent underline">Clear filters</button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ topic, subtopics, count }) => {
            const expanded = active || open.has(topic.stepNo);
            const solved = topic.problems.filter((p) => progress[p.id]?.status === 'solved').length;
            return (
              <section key={topic.stepNo} aria-label={`Topic ${topic.stepNo}: ${topic.title}`} data-topic={topic.stepNo} className="rounded-xl border border-line bg-surface">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => !active && toggle(topic.stepNo)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {expanded ? <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />}
                  <span className="flex-1 font-semibold">{topic.stepNo}. {topic.title}</span>
                  <span className="hidden w-28 sm:block">
                    <ProgressBar label={`${topic.shortTitle} solved`} total={topic.problems.length} segments={[{ value: solved, className: SOLVED_BAR }]} />
                  </span>
                  <span className="w-20 shrink-0 text-right text-sm text-muted">
                    {active ? `${count} shown` : `${solved}/${topic.problems.length}`}
                  </span>
                </button>

                {expanded && (
                  <div className="space-y-5 border-t border-line px-3 pb-4 pt-3 sm:px-4">
                    {subtopics.map(({ subtopic, problems }) => {
                      const subSolved = subtopic.problems.filter((p) => progress[p.id]?.status === 'solved').length;
                      return (
                        <div key={subtopic.key} data-subtopic={subtopic.key}>
                          <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
                            <span>{subtopic.stepNo}.{subtopic.subNo} {subtopic.title}</span>
                            <span className="text-xs font-normal text-muted">{subSolved}/{subtopic.problems.length} solved</span>
                          </h2>
                          <div className="space-y-2">
                            {problems.map((p) => (
                              <ProblemCard key={p.id} problem={p} entry={progress[p.id]} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
