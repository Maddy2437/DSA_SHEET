export interface Segment {
  value: number;
  className: string;
}

// Segments are drawn left to right as a share of `total`. aria-valuenow is the first segment (solved).
export function ProgressBar({
  segments,
  total,
  label,
  className = 'h-2',
}: {
  segments: Segment[];
  total: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={segments[0]?.value ?? 0}
      className={`flex w-full overflow-hidden rounded-full bg-surface2 ${className}`}
    >
      {segments.map((s, i) =>
        s.value > 0 && total > 0 ? (
          <div key={i} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

export const SOLVED_BAR = 'bg-emerald-500';
export const PROGRESS_BAR = 'bg-amber-400/70';
