import raw from '../data/a2z_old_sheet.json';
import type {
  Dataset,
  Difficulty,
  LinkKey,
  Problem,
  RawDataset,
  RawLink,
  Subtopic,
  Topic,
} from '../types';
import { cyrb53 } from './checksum';

export const rawDataset = raw as unknown as RawDataset;

export const LINK_KEYS: LinkKey[] = ['leetcode', 'gfg', 'coding_ninjas', 'youtube', 'article', 'tuf_plus'];

const MISSING: RawLink = { url: null, status: 'missing', platform: null, issues: [] };

// "Solve Problems on Arrays [Easy -> Medium -> Hard]" -> "Solve Problems on Arrays"
export function shortTitle(title: string): string {
  return title.replace(/\s*\[[^\]]*\]\s*$/, '').trim() || title;
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

// Builds read-only view models. Never mutates the raw data; order is exactly the source order.
export function buildDataset(r: RawDataset): Dataset {
  const topics: Topic[] = [];
  const problems: Problem[] = [];
  const byId = new Map<string, Problem>();
  const patterns = new Set<string>();

  for (const step of r.steps) {
    const topic: Topic = {
      stepNo: step.step_no,
      title: step.step_title,
      shortTitle: shortTitle(step.step_title),
      subtopics: [],
      problems: [],
    };
    for (const sub of step.sub_steps) {
      const subtopic: Subtopic = {
        key: `${step.step_no}.${sub.sub_step_no}`,
        stepNo: step.step_no,
        subNo: sub.sub_step_no,
        title: sub.sub_step_title,
        problems: [],
      };
      for (const p of sub.problems) {
        const tags = (p.tags ?? []).map((t) => t.label);
        tags.forEach((t) => patterns.add(t));
        const links = {} as Record<LinkKey, RawLink>;
        for (const k of LINK_KEYS) links[k] = p.links[k] ?? MISSING;
        const difficulty: Difficulty = p.difficulty ?? 'Unknown';
        const problem: Problem = {
          id: p.id,
          order: p.global_order,
          stepNo: step.step_no,
          stepTitle: step.step_title,
          subNo: sub.sub_step_no,
          subTitle: sub.sub_step_title,
          subKey: subtopic.key,
          position: p.position,
          ref: `${step.step_no}.${sub.sub_step_no}.${p.position}`,
          title: p.title,
          difficulty,
          tags,
          links,
          flags: p.flags,
          searchText: `${p.title} ${step.step_title} ${sub.sub_step_title} ${tags.join(' ')}`.toLowerCase(),
        };
        subtopic.problems.push(problem);
        topic.problems.push(problem);
        problems.push(problem);
        byId.set(problem.id, problem);
      }
      topic.subtopics.push(subtopic);
    }
    topics.push(topic);
  }
  return { topics, problems, byId, patterns: [...patterns].sort((a, b) => a.localeCompare(b)) };
}

deepFreeze(rawDataset);
export const dataset: Dataset = buildDataset(rawDataset);
deepFreeze(dataset.topics);

let cachedChecksum: string | null = null;
export function datasetChecksum(): string {
  if (!cachedChecksum) cachedChecksum = cyrb53(JSON.stringify(rawDataset.steps));
  return cachedChecksum;
}
