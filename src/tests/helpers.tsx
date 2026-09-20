import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { AppShell, Providers } from '../App';
import type { ProblemProgress } from '../types';
import { toDateKey } from '../utils/dates';
import { defaultEntry } from '../utils/progress';
import { STORAGE_KEYS } from '../utils/storage';

export function renderApp(path = '/') {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>
    </Providers>,
  );
}

export const entry = (over: Partial<ProblemProgress>): ProblemProgress => ({ ...defaultEntry(), ...over });

export function seedProgress(entries: Record<string, ProblemProgress>) {
  window.localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ version: 1, entries }));
}

export const storedProgress = (): Record<string, ProblemProgress> =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEYS.progress) ?? '{"entries":{}}').entries;

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + n));
}

export const cardOf = (id: string) => document.querySelector(`article[data-problem-id="${id}"]`) as HTMLElement;

// ---------- Independent oracle: reads the raw JSON directly, shares no code with the app ----------
interface OProblem {
  id: string; title: string; difficulty: string | null; tags: { label: string }[] | null;
  links: Record<string, { url: string | null }>; step: number; stepTitle: string; subTitle: string; sub: number;
}
export function oracleProblems(): OProblem[] {
  const raw = JSON.parse(readFileSync('src/data/a2z_old_sheet.json', 'utf8'));
  const out: OProblem[] = [];
  for (const s of raw.steps)
    for (const ss of s.sub_steps)
      for (const p of ss.problems)
        out.push({ ...p, step: s.step_no, stepTitle: s.step_title, sub: ss.sub_step_no, subTitle: ss.sub_step_title });
  return out;
}
export const oracleHaystack = (p: OProblem) =>
  [p.title, p.stepTitle, p.subTitle, ...(p.tags ?? []).map((t) => t.label)].join(' ').toLowerCase();

export function blobText(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(b);
  });
}
