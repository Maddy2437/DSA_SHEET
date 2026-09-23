// ---------- Raw dataset (exactly as extracted; never modified by the app) ----------
export type LinkKey = 'leetcode' | 'gfg' | 'coding_ninjas' | 'youtube' | 'article' | 'tuf_plus';
export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Unknown';

export interface RawLink {
  url: string | null;
  status: 'present' | 'missing' | 'malformed';
  platform: string | null;
  issues: string[];
  original_url?: string;
  change_from_original?: string;
  raw?: string;
}

export interface RawProblem {
  id: string;
  global_order: number;
  position: number;
  sl_no: number;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | null;
  difficulty_code: number | null;
  tags: { label: string; value: string }[] | null;
  company_tags: unknown;
  links: Record<string, RawLink>;
  flags: string[];
}

export interface RawSubStep {
  sub_step_no: number;
  sub_step_title: string;
  sub_step_title_raw?: string;
  problems: RawProblem[];
}

export interface RawStep {
  step_no: number;
  step_title: string;
  sub_steps: RawSubStep[];
}

export interface RawDataset {
  meta: Record<string, unknown>;
  steps: RawStep[];
}

// ---------- Derived, read-only view models ----------
export interface Problem {
  id: string;
  order: number; // 1..N running order across the whole sheet
  stepNo: number;
  stepTitle: string;
  subNo: number;
  subTitle: string;
  subKey: string; // "step.sub"
  position: number; // position inside its sub-step
  ref: string; // "step.sub.position"
  title: string;
  difficulty: Difficulty;
  tags: string[];
  links: Record<LinkKey, RawLink>;
  flags: string[];
  searchText: string;
}

export interface Subtopic {
  key: string;
  stepNo: number;
  subNo: number;
  title: string;
  problems: Problem[];
}

export interface Topic {
  stepNo: number;
  title: string;
  shortTitle: string;
  subtopics: Subtopic[];
  problems: Problem[];
}

export interface Dataset {
  topics: Topic[];
  problems: Problem[];
  byId: Map<string, Problem>;
  patterns: string[];
}

// ---------- Personal tracking state (stored separately, keyed by problem id) ----------
export type Status = 'not_started' | 'in_progress' | 'solved';

// ---------- Revision Hub (spaced revision) ----------
export type RevisionResult = 'forgot' | 'hint' | 'solved' | 'easy';

export interface RevisionAttempt {
  revision: number; // which revision (1..5) this attempt was for; a repeat or confirmation attempt reuses the same number
  date: string; // YYYY-MM-DD (local date) the revision was done
  result: RevisionResult;
}

export interface RevisionState {
  stage: number; // revisions completed successfully so far (0..5)
  due: string | null; // YYYY-MM-DD the next revision is due; null once the problem is Mastered
  attempts: RevisionAttempt[]; // every revision attempt, oldest first
}

export interface ProblemProgress {
  status: Status;
  notes: string;
  important: boolean;
  needsRevision: boolean;
  revisionCount: number;
  lastRevised: string | null; // YYYY-MM-DD (local date)
  solvedDate: string | null; // YYYY-MM-DD (local date), set the first time the problem becomes Solved
  // Optional so entries saved before the Revision Hub existed stay valid. Present only for problems that entered
  // the revision schedule (first solved after the hub shipped, or added to it by hand from "Solved today").
  revision?: RevisionState;
}

export type ProgressMap = Record<string, ProblemProgress>;

export interface Settings {
  theme: 'dark' | 'light';
  dailyTarget: number;
  lastExport: string | null; // YYYY-MM-DD
}
