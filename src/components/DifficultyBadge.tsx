import type { Difficulty } from '../types';

const DOT: Record<Difficulty, string> = {
  Easy: 'bg-emerald-500',
  Medium: 'bg-amber-500',
  Hard: 'bg-rose-500',
  Unknown: 'bg-zinc-400',
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
      <span aria-hidden className={`size-2 rounded-full ${DOT[difficulty]}`} />
      {difficulty}
    </span>
  );
}
