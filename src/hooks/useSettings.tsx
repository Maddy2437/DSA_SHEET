import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Settings } from '../types';
import { DATE_RE } from '../utils/dates';
import { readStorage, STORAGE_KEYS, writeStorage } from '../utils/storage';

export const DAILY_TARGETS = [5, 10, 15, 20];
const DEFAULTS: Settings = { theme: 'dark', dailyTarget: 10, lastExport: null };

function loadSettings(): Settings {
  try {
    const p = JSON.parse(readStorage(STORAGE_KEYS.settings) ?? '{}') as Partial<Settings>;
    return {
      theme: p.theme === 'light' ? 'light' : 'dark',
      dailyTarget: typeof p.dailyTarget === 'number' && DAILY_TARGETS.includes(p.dailyTarget) ? p.dailyTarget : DEFAULTS.dailyTarget,
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
