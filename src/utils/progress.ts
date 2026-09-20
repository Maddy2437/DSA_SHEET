import type { ProblemProgress, ProgressMap, Status } from '../types';
import { DATE_RE } from './dates';
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from './storage';

export const APP_ID = 'madhavs-dsa-sheet';
export const PROGRESS_VERSION = 1;
export const STATUSES: Status[] = ['not_started', 'in_progress', 'solved'];
export const STATUS_LABEL: Record<Status, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  solved: 'Solved',
};

export function defaultEntry(): ProblemProgress {
  return {
    status: 'not_started',
    notes: '',
    important: false,
    needsRevision: false,
    revisionCount: 0,
    lastRevised: null,
    solvedDate: null,
  };
}

export function isDefaultEntry(e: ProblemProgress): boolean {
  return (
    e.status === 'not_started' &&
    e.notes === '' &&
    !e.important &&
    !e.needsRevision &&
    e.revisionCount === 0 &&
    e.lastRevised === null &&
    e.solvedDate === null
  );
}

// ---------- Pure state operations (each returns a NEW map; untouched entries keep identity) ----------
function update(map: ProgressMap, id: string, fn: (e: ProblemProgress) => ProblemProgress): ProgressMap {
  const cur = map[id] ?? defaultEntry();
  const next = fn(cur);
  if (isDefaultEntry(next)) {
    if (!(id in map)) return map;
    const copy = { ...map };
    delete copy[id];
    return copy;
  }
  return { ...map, [id]: next };
}

export const ops = {
  // solvedDate is set the first time a problem becomes Solved and is never erased afterwards.
  setStatus: (map: ProgressMap, id: string, status: Status, today: string) =>
    update(map, id, (e) => ({
      ...e,
      status,
      solvedDate: status === 'solved' && !e.solvedDate ? today : e.solvedDate,
    })),
  toggleImportant: (map: ProgressMap, id: string) => update(map, id, (e) => ({ ...e, important: !e.important })),
  setNotes: (map: ProgressMap, id: string, notes: string) => update(map, id, (e) => ({ ...e, notes })),
  // Revision is an independent flag: it never touches `status` or `solvedDate`.
  toggleNeedsRevision: (map: ProgressMap, id: string) =>
    update(map, id, (e) => ({ ...e, needsRevision: !e.needsRevision })),
  markRevised: (map: ProgressMap, id: string, today: string) =>
    update(map, id, (e) => ({
      ...e,
      needsRevision: false,
      revisionCount: e.revisionCount + 1,
      lastRevised: today,
    })),
};

// ---------- Persistence ----------
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

// Lenient: used when reading our own storage. Fixes up bad fields instead of dropping data.
function coerceEntry(x: unknown): ProblemProgress {
  const o = isRecord(x) ? x : {};
  const d = defaultEntry();
  return {
    status: STATUSES.includes(o.status as Status) ? (o.status as Status) : d.status,
    notes: typeof o.notes === 'string' ? o.notes : d.notes,
    important: o.important === true,
    needsRevision: o.needsRevision === true,
    revisionCount:
      typeof o.revisionCount === 'number' && Number.isInteger(o.revisionCount) && o.revisionCount > 0
        ? o.revisionCount
        : 0,
    lastRevised: typeof o.lastRevised === 'string' && DATE_RE.test(o.lastRevised) ? o.lastRevised : null,
    solvedDate: typeof o.solvedDate === 'string' && DATE_RE.test(o.solvedDate) ? o.solvedDate : null,
  };
}

export function loadProgress(): ProgressMap {
  const raw = readStorage(STORAGE_KEYS.progress);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.entries)) throw new Error('bad shape');
    const out: ProgressMap = {};
    for (const [id, entry] of Object.entries(parsed.entries)) {
      const e = coerceEntry(entry);
      if (!isDefaultEntry(e)) out[id] = e;
    }
    return out;
  } catch {
    // Never silently lose data: keep the unreadable value under a backup key, then start empty.
    writeStorage(STORAGE_KEYS.corruptBackup, raw);
    return {};
  }
}

export function saveProgress(map: ProgressMap): void {
  writeStorage(STORAGE_KEYS.progress, JSON.stringify({ version: PROGRESS_VERSION, entries: map }));
}

export function clearProgressStorage(): void {
  removeStorage(STORAGE_KEYS.progress);
}

// ---------- Export / import ----------
export interface ProgressExport {
  app: typeof APP_ID;
  version: number;
  exportedAt: string;
  dataset: { checksum: string; problemCount: number };
  progress: ProgressMap;
}

export function buildExport(
  progress: ProgressMap,
  ds: { checksum: string; problemCount: number },
  now: Date = new Date(),
): ProgressExport {
  return {
    app: APP_ID,
    version: PROGRESS_VERSION,
    exportedAt: now.toISOString(),
    dataset: { checksum: ds.checksum, problemCount: ds.problemCount },
    progress,
  };
}

export type ImportResult =
  | { ok: true; progress: ProgressMap; exportedAt: string | null; checksum: string | null }
  | { ok: false; error: string };

// Strict: an import is validated in full before anything is replaced.
export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isRecord(data) || data.app !== APP_ID) {
    return { ok: false, error: "This doesn't look like a progress export from this app." };
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    return { ok: false, error: 'The export has no valid version number.' };
  }
  if (data.version > PROGRESS_VERSION) {
    return { ok: false, error: `This export is from a newer version (v${data.version}). Update the app first.` };
  }
  if (!isRecord(data.progress)) return { ok: false, error: 'The export has no progress data.' };

  const progress: ProgressMap = {};
  for (const [id, e] of Object.entries(data.progress)) {
    if (!isRecord(e)) return { ok: false, error: `Entry "${id}" is not an object.` };
    if (!STATUSES.includes(e.status as Status)) return { ok: false, error: `Entry "${id}" has an invalid status.` };
    if (typeof e.notes !== 'string') return { ok: false, error: `Entry "${id}" has invalid notes.` };
    if (typeof e.important !== 'boolean') return { ok: false, error: `Entry "${id}" has an invalid important flag.` };
    if (typeof e.needsRevision !== 'boolean') return { ok: false, error: `Entry "${id}" has an invalid revision flag.` };
    if (typeof e.revisionCount !== 'number' || !Number.isInteger(e.revisionCount) || e.revisionCount < 0)
      return { ok: false, error: `Entry "${id}" has an invalid revision count.` };
    for (const f of ['lastRevised', 'solvedDate'] as const) {
      const v = e[f];
      if (v !== null && !(typeof v === 'string' && DATE_RE.test(v)))
        return { ok: false, error: `Entry "${id}" has an invalid ${f}.` };
    }
    const entry = coerceEntry(e);
    if (!isDefaultEntry(entry)) progress[id] = entry;
  }
  const ds = isRecord(data.dataset) ? data.dataset : {};
  return {
    ok: true,
    progress,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    checksum: typeof ds.checksum === 'string' ? ds.checksum : null,
  };
}
