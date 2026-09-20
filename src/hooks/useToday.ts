import { useEffect, useState } from 'react';
import { todayKey } from '../utils/dates';

// The current local date; refreshes itself (every minute and when the tab regains focus) so the
// daily target and streak roll over at midnight without a reload.
export function useToday(): string {
  const [today, setToday] = useState(() => todayKey());
  useEffect(() => {
    const tick = () => setToday(todayKey());
    const id = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return today;
}
