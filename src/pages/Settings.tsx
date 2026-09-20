import { Download, Moon, Sun, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { TargetPicker } from '../components/TargetPicker';
import { useProgress, useProgressActions } from '../hooks/useProgress';
import { useSettings } from '../hooks/useSettings';
import { dataset, datasetChecksum } from '../utils/dataset';
import { formatDate, todayKey } from '../utils/dates';
import { downloadJson, readFileText } from '../utils/download';
import { buildExport, parseImport, type ImportResult } from '../utils/progress';

type Pending = Extract<ImportResult, { ok: true }>;

const btn = 'inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface2';

export default function Settings() {
  const { settings, update } = useSettings();
  const progress = useProgress();
  const actions = useProgressActions();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const orphaned = Object.keys(progress).filter((id) => !dataset.byId.has(id)).length;

  const onExport = () => {
    const data = buildExport(progress, { checksum: datasetChecksum(), problemCount: dataset.problems.length });
    const today = todayKey();
    downloadJson(`madhavs-dsa-progress-${today}.json`, data);
    update({ lastExport: today });
    setNotice(`Exported ${Object.keys(progress).length} entries.`);
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    setNotice(null);
    setPending(null);
    if (!file) return;
    try {
      const result = parseImport(await readFileText(file));
      if (result.ok) {
        setPending(result);
        setError(null);
      } else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  };

  const applyImport = () => {
    if (!pending) return;
    actions.replaceAll(pending.progress);
    setNotice(`Imported ${Object.keys(pending.progress).length} entries. Your previous progress was replaced.`);
    setPending(null);
  };

  const doReset = () => {
    actions.resetAll();
    setConfirmReset(false);
    setNotice('Personal progress was reset. The problem dataset was not touched.');
  };

  const pendingSolved = pending ? Object.values(pending.progress).filter((e) => e.status === 'solved').length : 0;

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <section aria-labelledby="theme-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="theme-h" className="text-sm font-semibold">Theme</h2>
        <div role="group" aria-label="Theme" className="mt-3 inline-flex overflow-hidden rounded-md border border-line">
          <button type="button" aria-pressed={settings.theme === 'light'} onClick={() => update({ theme: 'light' })} className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm ${settings.theme === 'light' ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface2'}`}>
            <Sun aria-hidden className="size-4" /> Light
          </button>
          <button type="button" aria-pressed={settings.theme === 'dark'} onClick={() => update({ theme: 'dark' })} className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm ${settings.theme === 'dark' ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface2'}`}>
            <Moon aria-hidden className="size-4" /> Dark
          </button>
        </div>
      </section>

      <section aria-labelledby="target-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="target-h" className="text-sm font-semibold">Daily target</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Problems to solve per day.</p>
        <TargetPicker />
      </section>

      <section aria-labelledby="backup-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="backup-h" className="text-sm font-semibold">Backup</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          Progress is stored only in this browser. Export a file to back it up or move it to another device. Last export: {formatDate(settings.lastExport)}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onExport} className={btn}>
            <Download aria-hidden className="size-4" /> Export progress
          </button>
          <label className={`${btn} cursor-pointer`}>
            <Upload aria-hidden className="size-4" /> Import progress
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Import progress file"
              className="sr-only"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {pending && (
          <div role="group" aria-label="Confirm import" className="mt-3 rounded-lg border border-accent/50 bg-accent-soft p-3 text-sm">
            <p>
              This file has <strong>{Object.keys(pending.progress).length}</strong> entries ({pendingSolved} solved), exported {pending.exportedAt ? formatDate(pending.exportedAt.slice(0, 10)) : 'at an unknown date'}.
              Importing <strong>replaces</strong> your current progress.
            </p>
            {pending.checksum && pending.checksum !== datasetChecksum() && (
              <p className="mt-1 text-amber-700 dark:text-amber-300">
                It was exported with a different version of the problem dataset. Entries for problems that no longer exist are kept but hidden.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={applyImport} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">Replace my progress</button>
              <button type="button" onClick={() => setPending(null)} className={btn}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        {orphaned > 0 && (
          <p className="mt-3 text-xs text-muted">{orphaned} saved entries do not match any problem in the current dataset. They are kept, not deleted.</p>
        )}
      </section>

      <section aria-labelledby="reset-h" className="rounded-xl border border-rose-500/40 bg-surface p-4">
        <h2 id="reset-h" className="text-sm font-semibold">Reset progress</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          Deletes your statuses, notes, stars, revision data and streak history. The {dataset.problems.length}-problem dataset is never modified.
        </p>
        {confirmReset ? (
          <div role="group" aria-label="Confirm reset" className="flex flex-wrap items-center gap-2">
            <span className="text-sm">This cannot be undone. Export a backup first if unsure.</span>
            <button type="button" onClick={doReset} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Yes, reset everything</button>
            <button type="button" onClick={() => setConfirmReset(false)} className={btn}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className={`${btn} border-rose-500/50 text-rose-600 dark:text-rose-300`}>
            <Trash2 aria-hidden className="size-4" /> Reset progress
          </button>
        )}
      </section>
    </div>
  );
}
