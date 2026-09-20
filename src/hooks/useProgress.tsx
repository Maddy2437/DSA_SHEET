import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProgressMap, Status } from '../types';
import { todayKey } from '../utils/dates';
import { clearProgressStorage, loadProgress, ops, saveProgress } from '../utils/progress';
import { STORAGE_KEYS } from '../utils/storage';

export interface ProgressActions {
  setStatus: (id: string, status: Status) => void;
  toggleImportant: (id: string) => void;
  setNotes: (id: string, notes: string) => void;
  toggleNeedsRevision: (id: string) => void;
  markRevised: (id: string) => void;
  /** Replaces ALL personal progress (used by import). Never touches the dataset. */
  replaceAll: (map: ProgressMap) => void;
  /** Deletes ALL personal progress. Never touches the dataset. */
  resetAll: () => void;
}

const StateCtx = createContext<ProgressMap>({});
const ActionsCtx = createContext<ProgressActions | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());

  // Persist on every change (writes are skipped when the stored value is already identical).
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Keep two open tabs from overwriting each other.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.progress || e.key === null) setProgress(loadProgress());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const actions = useMemo<ProgressActions>(
    () => ({
      setStatus: (id, status) => setProgress((m) => ops.setStatus(m, id, status, todayKey())),
      toggleImportant: (id) => setProgress((m) => ops.toggleImportant(m, id)),
      setNotes: (id, notes) => setProgress((m) => ops.setNotes(m, id, notes)),
      toggleNeedsRevision: (id) => setProgress((m) => ops.toggleNeedsRevision(m, id)),
      markRevised: (id) => setProgress((m) => ops.markRevised(m, id, todayKey())),
      replaceAll: (map) => setProgress(map),
      resetAll: () => {
        clearProgressStorage();
        setProgress({});
      },
    }),
    [],
  );

  return (
    <StateCtx.Provider value={progress}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useProgress = () => useContext(StateCtx);

export function useProgressActions(): ProgressActions {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error('useProgressActions must be used inside <ProgressProvider>');
  return a;
}

