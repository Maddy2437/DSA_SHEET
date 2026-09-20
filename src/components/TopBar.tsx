import { Menu, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFilters } from '../hooks/useFilters';

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { filters, setFilters, clearFilters } = useFilters();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);

  // Press "/" anywhere to jump to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onChange = (query: string) => {
    // Searching from any other page starts a fresh, truly global search (no leftover topic/status filters).
    // Searching while already on the Roadmap combines with the filters you have set there.
    if (pathname !== '/roadmap') {
      clearFilters();
      navigate('/roadmap');
    }
    setFilters({ query });
  };

  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/90 px-3 py-2.5 backdrop-blur sm:px-6">
      <button type="button" aria-label="Open menu" onClick={onMenu} className="rounded-md p-1.5 hover:bg-surface2 lg:hidden">
        <Menu aria-hidden className="size-5" />
      </button>
      <div className="relative max-w-xl flex-1">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={ref}
          type="search"
          role="searchbox"
          aria-label="Search problems"
          placeholder="Search problems, topics, patterns"
          title="Press / to jump to search"
          value={filters.query}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-9 text-sm placeholder:text-muted"
        />
        {filters.query && (
          <button type="button" aria-label="Clear search" onClick={() => setFilters({ query: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-surface2">
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </header>
  );
}
