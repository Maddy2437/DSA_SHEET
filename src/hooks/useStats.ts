import { useMemo } from 'react';
import { dataset } from '../utils/dataset';
import { computeStats } from '../utils/stats';
import { useProgress } from './useProgress';

export function useStats() {
  const progress = useProgress();
  return useMemo(() => computeStats(dataset, progress), [progress]);
}
