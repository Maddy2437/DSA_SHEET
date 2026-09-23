import { LayoutDashboard, ListChecks, RotateCcw, Route as RouteIcon, Settings as SettingsIcon, Star, X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useFilters } from '../hooks/useFilters';
import { useProgress } from '../hooks/useProgress';
import { useStats } from '../hooks/useStats';
import { useToday } from '../hooks/useToday';
import { dataset } from '../utils/dataset';
import { buildRevisionHub } from '../utils/revision';

function NavItem({ to, icon, label, count, active, onClick }: { to: string; icon: ReactNode; label: string; count?: number; active: boolean; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${
        active ? 'bg-accent-soft font-medium text-accent' : 'text-fg/80 hover:bg-surface2'
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && <span className="text-xs text-muted">{count}</span>}
    </Link>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters } = useFilters();
  const stats = useStats();
  const progress = useProgress();
  const today = useToday();
  // Problems that need action in the Revision Hub: due today, overdue, or flagged by hand.
  const revisionTodo = useMemo(() => buildRevisionHub(dataset, progress, today).todo, [progress, today]);
  const ic = 'size-4';

  const goTopic = (stepNo: number) => {
    clearFilters();
    setFilters({ topic: stepNo });
    navigate('/roadmap');
    onClose();
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <ListChecks aria-hidden className="size-5" />
          </span>
          <span className="flex-1 text-base font-semibold tracking-tight">Madhav's DSA</span>
          <button type="button" aria-label="Close menu" onClick={onClose} className="rounded-md p-1 hover:bg-surface2 lg:hidden">
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <nav aria-label="Main" className="space-y-0.5 px-2">
          <NavItem to="/" icon={<LayoutDashboard aria-hidden className={ic} />} label="Dashboard" active={pathname === '/'} onClick={onClose} />
          <NavItem
            to="/roadmap"
            icon={<RouteIcon aria-hidden className={ic} />}
            label="Roadmap"
            active={pathname === '/roadmap' && filters.topic === null}
            onClick={() => {
              clearFilters();
              onClose();
            }}
          />
          <NavItem to="/important" icon={<Star aria-hidden className={ic} />} label="Important" count={stats.important} active={pathname === '/important'} onClick={onClose} />
          <NavItem to="/revision" icon={<RotateCcw aria-hidden className={ic} />} label="Revision Hub" count={revisionTodo} active={pathname === '/revision'} onClick={onClose} />
          <NavItem to="/settings" icon={<SettingsIcon aria-hidden className={ic} />} label="Settings" active={pathname === '/settings'} onClick={onClose} />
        </nav>

        <p className="mt-4 px-4 pb-1 text-xs font-medium text-muted">Topics</p>
        <nav aria-label="Topics" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {dataset.topics.map((t) => {
            const s = stats.byTopic.find((x) => x.stepNo === t.stepNo)!;
            const active = pathname === '/roadmap' && filters.topic === t.stepNo;
            return (
              <button
                key={t.stepNo}
                type="button"
                onClick={() => goTopic(t.stepNo)}
                title={t.title}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  active ? 'bg-accent-soft font-medium text-accent' : 'text-fg/80 hover:bg-surface2'
                }`}
              >
                <span className="flex-1 truncate">{t.stepNo}. {t.shortTitle}</span>
                <span className="text-xs text-muted">{s.solved}/{s.total}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
