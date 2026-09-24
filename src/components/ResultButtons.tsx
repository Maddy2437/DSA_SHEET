import { Check, Lightbulb, Sparkles, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RevisionResult } from '../types';
import { RESULT_HELP, RESULT_LABEL, RESULTS } from '../utils/revision';

const STYLE: Record<RevisionResult, { icon: ReactNode; cls: string }> = {
  forgot: { icon: <X aria-hidden className="size-4" />, cls: 'border-rose-500/50 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300' },
  hint: { icon: <Lightbulb aria-hidden className="size-4" />, cls: 'border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300' },
  solved: { icon: <Check aria-hidden className="size-4" />, cls: 'border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300' },
  easy: { icon: <Sparkles aria-hidden className="size-4" />, cls: 'border-emerald-500 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300' },
};

/** The four ways a revision can go, with a one-line meaning each. Used by the revision cards and the session. */
export function ResultButtons({ onPick }: { onPick: (result: RevisionResult) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {RESULTS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onPick(r)}
          className={`flex min-w-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left ${STYLE[r].cls}`}
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            {STYLE[r].icon} {RESULT_LABEL[r]}
          </span>{' '}
          <span className="text-xs text-muted">{RESULT_HELP[r]}</span>
        </button>
      ))}
    </div>
  );
}
