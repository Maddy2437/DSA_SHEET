import { useMemo } from 'react';
import { dataset } from '../utils/dataset';
import { buildRevisionHub, type RevisionHub } from '../utils/revision';
import { usePauses, useProgress } from './useProgress';
import { useToday } from './useToday';

/** The Revision Hub for today (rolls over at midnight), from the real dataset and saved progress. */
export function useRevisionHub(): RevisionHub {
  const progress = useProgress();
  const pauses = usePauses();
  const today = useToday();
  return useMemo(() => buildRevisionHub(dataset, progress, today, pauses), [progress, pauses, today]);
}
