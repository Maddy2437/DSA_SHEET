import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { ProblemCard } from '../components/ProblemCard';
import { useProgress } from '../hooks/useProgress';
import { dataset } from '../utils/dataset';

export default function Revision() {
  const progress = useProgress();
  const list = useMemo(() => dataset.problems.filter((p) => progress[p.id]?.needsRevision), [progress]);
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Revision</h1>
        <p className="text-sm text-muted" data-testid="revision-count">{list.length} to revise</p>
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          <RotateCcw aria-hidden className="mx-auto mb-2 size-6" />
          <p>Nothing to revise. Use "Flag for revision" on a problem to add it here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((p) => (
            <ProblemCard key={p.id} problem={p} entry={progress[p.id]} defaultOpen />
          ))}
        </div>
      )}
    </div>
  );
}
