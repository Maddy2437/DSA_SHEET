import { Pause } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePauses } from '../hooks/useProgress';
import { addDays, dayNumber, formatDate, DATE_RE } from '../utils/dates';
import { checkPause, MAX_PAUSE_DAYS } from '../utils/revision';

interface Props {
  today: string;
  onCancel: () => void;
  /** `until` = the last paused day. Revision resumes the day after. */
  onConfirm: (until: string) => void;
}

/** Pick how long to pause revision for. The date rules and the schedule shift live in revision.ts. */
export function PauseDialog({ today, onCancel, onConfirm }: Props) {
  const pauses = usePauses();
  const [until, setUntil] = useState(() => addDays(today, 6)); // a week, today included
  const input = useRef<HTMLInputElement>(null);
  const error = checkPause(pauses, until, today);
  const days = DATE_RE.test(until) ? dayNumber(until) - dayNumber(today) + 1 : 0;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-h"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <Pause aria-hidden className="size-5 text-sky-500" />
          <h2 id="pause-h" className="text-base font-semibold tracking-tight">Pause Revision</h2>
        </div>
        <p className="text-sm text-muted">
          Use this for genuine breaks: midsems, endsems, travel, holidays or other planned time away. Revisions that are
          not overdue yet move forward by the length of the break, so nothing new piles up while you are gone.
        </p>
        <p className="text-sm text-muted">
          A pause protects the future, it does not rewrite the past: revisions that are already overdue keep their
          original due dates and stay overdue (frozen, with the paused days not counted), and days you already missed
          stay missed. Your history and stages are not touched.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="pause-until" className="block text-sm font-medium">Your revision schedule will be frozen until</label>
          <input
            ref={input}
            id="pause-until"
            type="date"
            value={until}
            min={today}
            max={addDays(today, MAX_PAUSE_DAYS - 1)}
            onChange={(e) => setUntil(e.target.value)}
            className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm"
          />
          {error ? (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
          ) : (
            <p className="text-xs text-muted" data-testid="pause-summary">
              {days} {days === 1 ? 'day' : 'days'} paused. Revision resumes on {formatDate(addDays(until, 1))}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface2">
            Cancel
          </button>
          <button
            type="button"
            disabled={error !== null}
            onClick={() => onConfirm(until)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            Pause Revision
          </button>
        </div>
      </div>
    </div>
  );
}
