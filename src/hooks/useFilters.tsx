import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { EMPTY_FILTERS, type Filters } from '../utils/filters';

interface Ctx {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
}
const FiltersCtx = createContext<Ctx | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setAll] = useState<Filters>(EMPTY_FILTERS);
  const value = useMemo<Ctx>(
    () => ({
      filters,
      setFilters: (patch) =>
        setAll((f) => {
          const next = { ...f, ...patch };
          // A subtopic only makes sense inside its own topic.
          if (patch.topic !== undefined && next.subtopic && next.topic !== null && !next.subtopic.startsWith(`${next.topic}.`)) {
            next.subtopic = null;
          }
          return next;
        }),
      clearFilters: () => setAll(EMPTY_FILTERS),
    }),
    [filters],
  );
  return <FiltersCtx.Provider value={value}>{children}</FiltersCtx.Provider>;
}

export function useFilters(): Ctx {
  const c = useContext(FiltersCtx);
  if (!c) throw new Error('useFilters must be used inside <FiltersProvider>');
  return c;
}
