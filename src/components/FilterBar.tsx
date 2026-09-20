import { X } from 'lucide-react';
import { useFilters } from '../hooks/useFilters';
import type { Difficulty, LinkKey, Status } from '../types';
import { dataset } from '../utils/dataset';
import { filtersActive } from '../utils/filters';
import { STATUSES, STATUS_LABEL } from '../utils/progress';
import { RESOURCES } from '../utils/resources';
import { DIFFICULTIES } from '../utils/stats';

const sel =
  'w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-fg';

export function FilterBar() {
  const { filters: f, setFilters, clearFilters } = useFilters();
  const subtopics = dataset.topics
    .filter((t) => f.topic === null || t.stepNo === f.topic)
    .flatMap((t) => t.subtopics);

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select aria-label="Topic" className={sel} value={f.topic ?? ''} onChange={(e) => setFilters({ topic: e.target.value ? Number(e.target.value) : null })}>
          <option value="">All topics</option>
          {dataset.topics.map((t) => (
            <option key={t.stepNo} value={t.stepNo}>{t.stepNo}. {t.shortTitle}</option>
          ))}
        </select>
        <select aria-label="Subtopic" className={sel} value={f.subtopic ?? ''} onChange={(e) => setFilters({ subtopic: e.target.value || null })}>
          <option value="">All subtopics</option>
          {subtopics.map((s) => (
            <option key={s.key} value={s.key}>{s.key} {s.title}</option>
          ))}
        </select>
        <select aria-label="Difficulty" className={sel} value={f.difficulty ?? ''} onChange={(e) => setFilters({ difficulty: (e.target.value || null) as Difficulty | null })}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label="Status" className={sel} value={f.status ?? ''} onChange={(e) => setFilters({ status: (e.target.value || null) as Status | null })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select aria-label="Platform" className={sel} value={f.platform ?? ''} onChange={(e) => setFilters({ platform: (e.target.value || null) as LinkKey | null })}>
          <option value="">Any platform</option>
          {RESOURCES.map((r) => <option key={r.key} value={r.key}>Has {r.label}</option>)}
        </select>
        <select aria-label="Pattern" className={sel} value={f.pattern ?? ''} onChange={(e) => setFilters({ pattern: e.target.value || null })}>
          <option value="">Any pattern</option>
          {dataset.patterns.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={f.importantOnly}
          onClick={() => setFilters({ importantOnly: !f.importantOnly })}
          className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
            f.importantOnly ? 'border-yellow-400 bg-yellow-400/15 text-yellow-700 dark:text-yellow-300' : 'border-line text-muted hover:bg-surface2'
          }`}
        >
          Important only
        </button>
        {filtersActive(f) && (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface2">
            <X aria-hidden className="size-3.5" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
