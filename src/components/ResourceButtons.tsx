import { BookOpen, Library, Play, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LinkKey } from '../types';
import type { ResolvedResource } from '../utils/resources';

const DOT: Partial<Record<LinkKey, string>> = {
  leetcode: 'bg-red-500',
  gfg: 'bg-green-500',
  coding_ninjas: 'bg-blue-500',
};

function icon(key: LinkKey): ReactNode {
  if (DOT[key]) return <span aria-hidden className={`size-2.5 rounded-full ${DOT[key]}`} />;
  if (key === 'youtube') return <Play aria-hidden className="size-3.5 text-orange-500" />;
  if (key === 'article') return <BookOpen aria-hidden className="size-3.5 text-sky-500" />;
  return <Library aria-hidden className="size-3.5 text-violet-500" />;
}

// Only resources that really exist are passed in (see resolveResources); a missing URL never renders a button.
export function ResourceButtons({ resources }: { resources: ResolvedResource[] }) {
  if (resources.length === 0) return <p className="text-xs text-muted">No resources in the source sheet for this problem.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {resources.map((r) => (
        <a
          key={r.key}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          data-resource={r.key}
          data-mismatch={r.mismatchPlatform ?? undefined}
          title={
            r.mismatchPlatform
              ? `Source sheet quirk: this ${r.label} slot links to ${r.mismatchPlatform}, not ${r.expectedLabel}`
              : `Open ${r.label} in a new tab`
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface2"
        >
          {icon(r.key)}
          {r.label}
          {r.mismatchPlatform && <TriangleAlert aria-label={`links to ${r.mismatchPlatform}`} className="size-3.5 text-amber-500" />}
        </a>
      ))}
    </div>
  );
}
