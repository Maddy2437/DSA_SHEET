import type { Status } from '../types';
import { STATUSES, STATUS_LABEL } from '../utils/progress';

const ACTIVE: Record<Status, string> = {
  not_started: 'bg-surface2 text-fg',
  in_progress: 'bg-amber-400 text-zinc-900',
  solved: 'bg-emerald-500 text-white',
};

export function StatusControl({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  return (
    <div role="group" aria-label="Status" className="inline-flex overflow-hidden rounded-md border border-line">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={status === s}
          onClick={() => onChange(s)}
          className={`px-2.5 py-1 text-xs font-medium transition-colors ${
            status === s ? ACTIVE[s] : 'text-muted hover:bg-surface2'
          }`}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}
