import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Settings } from '../types';
import { DATE_RE } from '../utils/dates';
import { readStorage, STORAGE_KEYS, writeStorage } from '../utils/storage';

export const DAILY_TARGETS = [5, 10, 15, 20]; // NEW problems to solve per day (Dashboard)
export const REVISION_TARGETS = [5, 10, 15, 20, 30]; // scheduled revisions to complete per day (Revision Hub)
const DEFAULTS: Settings = { theme: 'dark', dailyTarget: 10, revisionTarget: 10, lastExport: null };

function loadSettings(): Settings {
  try {
    const p = JSON.parse(readStorage(STORAGE_KEYS.settings) ?? '{}') as Partial<Settings>;
    const dailyTarget = typeof p.dailyTarget === 'number' && DAILY_TARGETS.includes(p.dailyTarget) ? p.dailyTarget : DEFAULTS.dailyTarget;
    return {
      theme: p.theme === 'light' ? 'light' : 'dark',
      dailyTarget,
      // Settings saved before the revision target existed start it as a copy of the problem target, once. From the
      // first save on it has its own stored value and the two never follow each other again.
      revisionTarget: typeof p.revisionTarget === 'number' && REVISION_TARGETS.includes(p.revisionTarget) ? p.revisionTarget : dailyTarget,
      lastExport: typeof p.lastExport === 'string' && DATE_RE.test(p.lastExport) ? p.lastExport : null,
    };
  } catch {
    return DEFAULTS;
  }
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}
const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  useEffect(() => {
    writeStorage(STORAGE_KEYS.settings, JSON.stringify(settings));
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings]);

  const value = useMemo<Ctx>(() => ({ settings, update: (patch) => setSettings((s) => ({ ...s, ...patch })) }), [settings]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('useSettings must be used inside <SettingsProvider>');
  return c;
}
