import { Flame, TriangleAlert, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ProgressBar, PROGRESS_BAR, SOLVED_BAR } from '../components/ProgressBar';
import { TargetPicker } from '../components/TargetPicker';
import { useFilters } from '../hooks/useFilters';
import { useProgress } from '../hooks/useProgress';
import { useSettings } from '../hooks/useSettings';
import { useStats } from '../hooks/useStats';
import { useToday } from '../hooks/useToday';
import { dayNumber } from '../utils/dates';
import { computeStreaks, DIFFICULTIES, pct, solvedDates, solvedOn } from '../utils/stats';

function Stat({ id, label, value, tone = '' }: { id: string; label: string; value: number; tone?: string }) {
  return (
    <div data-testid={`stat-${id}`} className="px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-2xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

export default function Dashboard() {
  const stats = useStats();
  const progress = useProgress();
  const { settings } = useSettings();
  const { setFilters, clearFilters } = useFilters();
  const navigate = useNavigate();
  const today = useToday();

  const streaks = useMemo(() => computeStreaks(solvedDates(progress), today), [progress, today]);
  const solvedToday = useMemo(() => solvedOn(progress, today), [progress, today]);
  const target = settings.dailyTarget;
  const remaining = Math.max(0, target - solvedToday);

  const hasData = Object.keys(progress).length > 0;
  const daysSinceExport = settings.lastExport ? dayNumber(today) - dayNumber(settings.lastExport) : null;
  const showBackupNudge = hasData && (daysSinceExport === null || daysSinceExport >= 14);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>

      {showBackupNudge && (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            Your progress is stored only in this browser.{' '}
            {daysSinceExport === null ? "You haven't exported a backup yet." : `Your last backup was ${daysSinceExport} days ago.`}{' '}
            <Link to="/settings" className="font-medium underline">Export one in Settings</Link>.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section aria-labelledby="overall-h" className="rounded-xl border border-line bg-surface lg:col-span-2">
          <div className="px-4 pt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="overall-h" className="text-sm font-medium text-muted">Overall completion</h2>
              <p className="text-3xl font-semibold tracking-tight" data-testid="completion">{stats.completion.toFixed(1)}%</p>
            </div>
            <p className="mt-1 text-sm text-muted">
              <span className="text-lg font-semibold text-fg">{stats.solved}</span> of {stats.total} solved
            </p>
            <div className="mt-3">
              <ProgressBar
                label="Overall completion"
                total={stats.total}
                className="h-3"
                segments={[
                  { value: stats.solved, className: SOLVED_BAR },
                  { value: stats.inProgress, className: PROGRESS_BAR },
                ]}
              />
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-line border-t border-line sm:grid-cols-5 sm:divide-y-0">
            <Stat id="total" label="Total problems" value={stats.total} />
            <Stat id="solved" label="Solved" value={stats.solved} tone="text-emerald-500" />
            <Stat id="in-progress" label="In progress" value={stats.inProgress} tone="text-amber-500" />
            <Stat id="not-started" label="Not started" value={stats.notStarted} />
            <Stat id="revision" label="Needs revision" value={stats.needsRevision} tone="text-sky-500" />
          </dl>
        </section>

        <section aria-labelledby="today-h" className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="today-h" className="whitespace-nowrap text-sm font-medium text-muted">Today's progress</h2>
            <TargetPicker />
          </div>
          <div className="mt-4">
            <ProgressBar
              label="Today's progress"
              total={target}
              className="h-3"
              segments={[{ value: Math.min(solvedToday, target), className: 'bg-accent' }]}
            />
          </div>
          <p className="mt-3 text-lg font-semibold" data-testid="today-count">{solvedToday} / {target} completed</p>
          <p className="text-sm text-muted" data-testid="today-remaining">
            {solvedToday >= target ? 'Target reached' : `${remaining} remaining`}
          </p>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section aria-labelledby="diff-h" className="rounded-xl border border-line bg-surface p-4 lg:col-span-2">
          <h2 id="diff-h" className="text-sm font-medium text-muted">Difficulty breakdown</h2>
          <ul className="mt-3 space-y-3">
            {DIFFICULTIES.map((d) => {
              const { total, solved } = stats.byDifficulty[d];
              return (
                <li key={d} data-testid={`difficulty-${d}`}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{d}</span>
                    <span className="text-muted">
                      <span className="font-medium text-fg" data-testid={`difficulty-${d}-solved`}>{solved}</span> solved of{' '}
                      <span data-testid={`difficulty-${d}-total`}>{total}</span>
                    </span>
                  </div>
                  <ProgressBar label={`${d} solved`} total={total} className="mt-1 h-2" segments={[{ value: solved, className: SOLVED_BAR }]} />
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="streak-h" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="streak-h" className="text-sm font-medium text-muted">Streak</h2>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-3">
              <Flame aria-hidden className={`size-8 ${streaks.current > 0 ? 'text-orange-500' : 'text-muted'}`} />
              <div>
                <p className="text-2xl font-semibold" data-testid="streak-current">{streaks.current}</p>
                <p className="text-xs text-muted">Current streak (days){streaks.current > 0 && !streaks.solvedToday ? ', solve one today to keep it' : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Trophy aria-hidden className="size-8 text-yellow-500" />
              <div>
                <p className="text-2xl font-semibold" data-testid="streak-longest">{streaks.longest}</p>
                <p className="text-xs text-muted">Longest streak (days)</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section aria-labelledby="topics-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="topics-h" className="text-sm font-medium text-muted">Topic progress</h2>
        <ul className="mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2">
          {stats.byTopic.map((t) => (
            <li key={t.stepNo} data-testid={`topic-row-${t.stepNo}`}>
              <button
                type="button"
                onClick={() => {
                  clearFilters();
                  setFilters({ topic: t.stepNo });
                  navigate('/roadmap');
                }}
                className="flex w-full items-baseline justify-between gap-2 text-left text-sm hover:text-accent"
              >
                <span className="truncate">{t.stepNo}. {t.title}</span>
                <span className="shrink-0 text-muted">
                  <span data-testid={`topic-count-${t.stepNo}`}>{t.solved}/{t.total}</span>{' '}
                  <span className="font-medium text-fg" data-testid={`topic-pct-${t.stepNo}`}>{pct(t.solved, t.total)}%</span>
                </span>
              </button>
              <ProgressBar
                label={`${t.title} progress`}
                total={t.total}
                className="mt-1 h-2"
                segments={[
                  { value: t.solved, className: SOLVED_BAR },
                  { value: t.inProgress, className: PROGRESS_BAR },
                ]}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
