import { DAILY_TARGETS, useSettings } from '../hooks/useSettings';

export function TargetPicker() {
  const { settings, update } = useSettings();
  return (
    <div role="group" aria-label="Daily target" className="inline-flex overflow-hidden rounded-md border border-line">
      {DAILY_TARGETS.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={settings.dailyTarget === n}
          onClick={() => update({ dailyTarget: n })}
          className={`px-3 py-1 text-sm font-medium ${settings.dailyTarget === n ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface2'}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
