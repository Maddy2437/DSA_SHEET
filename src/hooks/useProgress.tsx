import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ProgressMap, RevisionPause, RevisionResult, Status } from '../types';
import { todayKey } from '../utils/dates';
import { clearProgressStorage, loadStore, ops, saveProgress, type Store } from '../utils/progress';
import { activePause, checkPause, endPause, revisionAnchor, startPause } from '../utils/revision';
import { STORAGE_KEYS } from '../utils/storage';

export interface ProgressActions {
  setStatus: (id: string, status: Status) => void;
  toggleImportant: (id: string) => void;
  setNotes: (id: string, notes: string) => void;
  toggleNeedsRevision: (id: string) => void;
  markRevised: (id: string) => void;
  /**
   * Revision Hub: records how a due revision went and schedules the next one. Returns false (and saves nothing) when
   * it could not be recorded: revision is paused, that revision is not due (any more), or it no longer exists.
   */
  recordRevision: (id: string, result: RevisionResult) => boolean;
  /** Revision Hub: puts an already-Solved problem into the revision schedule. */
  enrollRevision: (id: string) => void;
  /** Revision Hub: pauses revision from today through `until` (the last paused day) and shifts the schedule. */
  pauseRevision: (until: string) => void;
  /** Revision Hub: ends the current pause today and takes the unused paused days back off the schedule. */
  resumeRevision: () => void;
  /** Replaces ALL personal progress (used by import). Never touches the dataset. */
  replaceAll: (map: ProgressMap, pauses?: RevisionPause[]) => void;
  /** Deletes ALL personal progress. Never touches the dataset. */
  resetAll: () => void;
}

const StateCtx = createContext<ProgressMap>({});
const PausesCtx = createContext<RevisionPause[]>([]);
const ActionsCtx = createContext<ProgressActions | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  // Progress and pauses change together (a pause shifts the schedule), so they share one store. `latest` always holds
  // the newest store, so an action can look at the CURRENT data and say whether it really changed anything.
  const [store, setStore] = useState<Store>(() => loadStore());
  const latest = useRef(store);
  const commit = useCallback((next: Store) => {
    latest.current = next;
    setStore(next);
  }, []);

  // Persist on every change (writes are skipped when the stored value is already identical).
  useEffect(() => {
    saveProgress(store.progress, store.pauses);
  }, [store]);

  // Keep two open tabs from overwriting each other.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.progress || e.key === null) commit(loadStore());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [commit]);

  const actions = useMemo<ProgressActions>(() => {
    // Runs `fn` on the latest store and commits the result. Returns true when something actually changed.
    const apply = (fn: (s: Store, today: string) => Store): boolean => {
      const s = latest.current;
      const next = fn(s, todayKey());
      if (next === s) return false;
      commit(next);
      return true;
    };
    // Most actions only change progress.
    const change = (fn: (m: ProgressMap, pauses: RevisionPause[], today: string) => ProgressMap) =>
      apply((s, today) => {
        const progress = fn(s.progress, s.pauses, today);
        return progress === s.progress ? s : { ...s, progress };
      });
    return {
      setStatus: (id, status) => {
        change((m, pauses, today) => ops.setStatus(m, id, status, today, revisionAnchor(pauses, today)));
      },
      toggleImportant: (id) => {
        change((m) => ops.toggleImportant(m, id));
      },
      setNotes: (id, notes) => {
        change((m) => ops.setNotes(m, id, notes));
      },
      toggleNeedsRevision: (id) => {
        change((m) => ops.toggleNeedsRevision(m, id));
      },
      markRevised: (id) => {
        change((m, _p, today) => ops.markRevised(m, id, today));
      },
      // No revision result can be saved while revision is paused, or unless that revision is really due.
      recordRevision: (id, result) =>
        change((m, pauses, today) => (activePause(pauses, today) ? m : ops.recordRevision(m, id, result, today))),
      enrollRevision: (id) => {
        change((m, pauses, today) => ops.enrollRevision(m, id, today, revisionAnchor(pauses, today)));
      },
      pauseRevision: (until) =>
        apply((s, today) => {
          if (checkPause(s.pauses, until, today)) return s;
          const c = startPause(s.pauses, until, today);
          return { progress: ops.shiftRevisions(s.progress, c.shift, c.from), pauses: c.pauses };
        }),
      resumeRevision: () =>
        apply((s, today) => {
          const c = endPause(s.pauses, today);
          return c ? { progress: ops.shiftRevisions(s.progress, c.shift, c.from), pauses: c.pauses } : s;
        }),
      replaceAll: (map, pauses = []) => commit({ progress: map, pauses }),
      resetAll: () => {
        clearProgressStorage();
        commit({ progress: {}, pauses: [] });
      },
    };
  }, [commit]);

  return (
    <StateCtx.Provider value={store.progress}>
      <PausesCtx.Provider value={store.pauses}>
        <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
      </PausesCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useProgress = () => useContext(StateCtx);

/** Planned revision pauses (midsems, travel, ...), oldest first. */
export const usePauses = () => useContext(PausesCtx);

export function useProgressActions(): ProgressActions {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error('useProgressActions must be used inside <ProgressProvider>');
  return a;
}
