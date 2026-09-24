import { DAILY_TARGETS, REVISION_TARGETS, useSettings } from '../hooks/useSettings';

const PICKERS = {
  // NEW problems solved per day (Dashboard).
  dailyTarget: { label: 'Daily target', options: DAILY_TARGETS },
  // Scheduled revisions completed per day (Revision Hub). Independent of the problem target.
  revisionTarget: { label: 'Daily revision target', options: REVISION_TARGETS },
} as const;

export function TargetPicker({ field = 'dailyTarget' }: { field?: keyof typeof PICKERS }) {
  const { settings, update } = useSettings();
  const { label, options } = PICKERS[field];
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={settings[field] === n}
          onClick={() => update({ [field]: n })}
          className={`px-3 py-1 text-sm font-medium ${settings[field] === n ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface2'}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
