import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { FiltersProvider } from './hooks/useFilters';
import { ProgressProvider } from './hooks/useProgress';
import { SettingsProvider } from './hooks/useSettings';
import Dashboard from './pages/Dashboard';
import Important from './pages/Important';
import Revision from './pages/Revision';
import Roadmap from './pages/Roadmap';
import Settings from './pages/Settings';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <ProgressProvider>
        <FiltersProvider>{children}</FiltersProvider>
      </ProgressProvider>
    </SettingsProvider>
  );
}

// Must be rendered inside a Router (HashRouter in main.tsx, MemoryRouter in tests).
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="min-w-0 flex-1">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/important" element={<Important />} />
            <Route path="/revision" element={<Revision />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
