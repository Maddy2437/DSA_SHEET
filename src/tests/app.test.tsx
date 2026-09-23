import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataset, rawDataset } from '../utils/dataset';
import { todayKey } from '../utils/dates';
import { buildExport } from '../utils/progress';
import { resolveResources } from '../utils/resources';
import { STORAGE_KEYS } from '../utils/storage';
import {
  addDays, blobText, cardOf, entry, oracleHaystack, oracleProblems, renderApp, seedProgress, storedProgress,
} from './helpers';

const raw = oracleProblems();
const TODAY = todayKey();
const h1 = (name: string) => screen.getByRole('heading', { level: 1, name });
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }));
const cards = () => document.querySelectorAll('article[data-problem-id]');
const cardIds = () => [...cards()].map((c) => c.getAttribute('data-problem-id'));
const select = (name: string) => screen.getByRole('combobox', { name });
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

afterEach(() => vi.restoreAllMocks());

describe('navigation', () => {
  it('moves between Dashboard, Roadmap, Important, Revision and Settings; sidebar lists all 18 topics', async () => {
    const user = userEvent.setup();
    renderApp('/');
    expect(h1('Dashboard')).toBeInTheDocument();
    for (const [link, heading] of [['Roadmap', 'Roadmap'], ['Important', 'Important'], ['Revision', 'Revision Hub'], ['Settings', 'Settings'], ['Dashboard', 'Dashboard']]) {
      await user.click(mainNav().getByRole('link', { name: new RegExp(`^${link}`) }));
      expect(h1(heading)).toBeInTheDocument();
    }
    expect(within(screen.getByRole('navigation', { name: 'Topics' })).getAllByRole('button')).toHaveLength(18);
    expect(screen.queryByRole('link', { name: /progress/i })).toBeNull(); // Progress page was dropped
  });

  it('sidebar topic navigation opens the Roadmap scoped to that topic; the two "Strings" topics are told apart by number', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const topics = within(screen.getByRole('navigation', { name: 'Topics' }));
    await user.click(topics.getByRole('button', { name: /^5\. Strings/ }));
    expect(h1('Roadmap')).toBeInTheDocument();
    expect(select('Topic')).toHaveValue('5');
    expect(cards()).toHaveLength(15);
    await user.click(topics.getByRole('button', { name: /^18\. Strings/ }));
    expect(cards()).toHaveLength(9);
  });
});

describe('roadmap hierarchy', () => {
  it('renders the exact 18 topics -> 61 subtopics -> 455 problems in the original order', async () => {
    const user = userEvent.setup();
    renderApp('/roadmap');
    const headers = [...document.querySelectorAll<HTMLElement>('section[data-topic] > button')];
    expect(headers).toHaveLength(18);
    for (const b of headers) await user.click(b);
    expect([...document.querySelectorAll('section[data-topic]')].map((s) => s.getAttribute('data-topic'))).toEqual(
      Array.from({ length: 18 }, (_, i) => String(i + 1)),
    );
    expect(document.querySelectorAll('[data-subtopic]')).toHaveLength(61);
    expect(cardIds()).toEqual(raw.map((p) => p.id));
    // each card sits under the right subtopic
    for (const p of raw.slice(0, 455)) {
      expect(cardOf(p.id).closest('[data-subtopic]')?.getAttribute('data-subtopic')).toBe(`${p.step}.${p.sub}`);
    }
  }, 120_000);
});

describe('search', () => {
  it('is instant and matches problem name, topic, subtopic and pattern', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const box = screen.getByRole('searchbox', { name: 'Search problems' });
    const rare = (() => {
      const c: Record<string, number> = {};
      raw.forEach((p) => (p.tags ?? []).forEach((t) => (c[t.label] = (c[t.label] ?? 0) + 1)));
      return Object.entries(c).sort((a, b) => a[1] - b[1])[0][0];
    })();
    for (const q of ['kadane', 'stack', rare]) {
      await user.clear(box);
      await user.type(box, q);
      expect(h1('Roadmap')).toBeInTheDocument(); // typing anywhere jumps to the Roadmap
      const words = q.toLowerCase().split(/\s+/);
      const expected = raw.filter((p) => words.every((w) => oracleHaystack(p).includes(w))).map((p) => p.id);
      expect(expected.length).toBeGreaterThan(0);
      expect(screen.getByTestId('match-count')).toHaveTextContent(`${expected.length} of 455 problems match`);
      expect(cardIds()).toEqual(expected);
    }
    await user.clear(box);
    await user.type(box, 'zzzz-no-such-problem');
    expect(screen.getByText('No problems match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByTestId('match-count')).toHaveTextContent('455 problems in 18 topics');
  }, 60_000);
});

describe('search scope', () => {
  it('searching from another page is global (drops leftover filters); on the Roadmap it combines with the filters', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const topics = within(screen.getByRole('navigation', { name: 'Topics' }));
    await user.click(topics.getByRole('button', { name: /^3\. / })); // sets Topic = 3
    await user.click(mainNav().getByRole('link', { name: 'Dashboard' })); // filters persist while browsing
    await user.type(screen.getByRole('searchbox', { name: 'Search problems' }), 'tree');
    const words = ['tree'];
    const everywhere = raw.filter((p) => words.every((w) => oracleHaystack(p).includes(w))).map((p) => p.id);
    expect(select('Topic')).toHaveValue(''); // the leftover Topic filter was dropped
    expect(screen.getByTestId('match-count')).toHaveTextContent(`${everywhere.length} of 455 problems match`);
    expect(new Set(raw.filter((p) => everywhere.includes(p.id)).map((p) => p.step)).size).toBeGreaterThan(1);
    // now on the Roadmap: choosing a topic narrows the same search instead of resetting it
    await user.selectOptions(select('Topic'), '13');
    expect(cardIds()).toEqual(everywhere.filter((id) => raw.find((p) => p.id === id)!.step === 13));
  }, 60_000);
});

describe('combined filters', () => {
  it('Topic = Arrays + Difficulty = Medium + Status = Not started shows only matches, and reacts to status changes', async () => {
    const user = userEvent.setup();
    renderApp('/roadmap');
    await user.selectOptions(select('Topic'), '3');
    await user.selectOptions(select('Difficulty'), 'Medium');
    await user.selectOptions(select('Status'), 'not_started');
    const expected = raw.filter((p) => p.step === 3 && p.difficulty === 'Medium').map((p) => p.id);
    expect(expected.length).toBeGreaterThan(3);
    expect(cardIds()).toEqual(expected);
    for (const c of cards()) {
      // the difficulty badge is the only "Medium" text that is not part of the breadcrumb
      expect(within(c as HTMLElement).getAllByText('Medium').length).toBeGreaterThanOrEqual(1);
      expect(within(c as HTMLElement).getByText(/^3\. /)).toBeInTheDocument(); // breadcrumb shows the Arrays topic
    }
    await user.click(within(cardOf(expected[0])).getByRole('button', { name: 'Solved' }));
    expect(cardIds()).toEqual(expected.slice(1)); // solved problem leaves a "Not started" view
    await user.selectOptions(select('Status'), 'solved');
    expect(cardIds()).toEqual([expected[0]]);
  }, 60_000);

  it('Subtopic options follow the chosen Topic; Platform / Pattern / Important-only combine; Clear filters resets', async () => {
    const user = userEvent.setup();
    renderApp('/roadmap');
    await user.selectOptions(select('Topic'), '3');
    expect(within(select('Subtopic')).getAllByRole('option')).toHaveLength(1 + 3);
    await user.selectOptions(select('Subtopic'), '3.2');
    expect(cardIds()).toEqual(raw.filter((p) => p.step === 3 && p.sub === 2).map((p) => p.id));
    await user.selectOptions(select('Topic'), '13'); // changing topic drops a subtopic from another topic
    expect(select('Subtopic')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(select('Platform'), 'youtube');
    await user.selectOptions(select('Difficulty'), 'Hard');
    const pattern = raw.find((p) => p.difficulty === 'Hard' && p.links.youtube.url && p.tags?.length)!.tags![0].label;
    await user.selectOptions(select('Pattern'), pattern);
    const expected = raw.filter((p) => p.links.youtube.url && p.difficulty === 'Hard' && (p.tags ?? []).some((t) => t.label === pattern)).map((p) => p.id);
    expect(cardIds()).toEqual(expected);

    await user.click(screen.getByRole('button', { name: 'Important only' }));
    expect(screen.getByText('No problems match these filters.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getByTestId('match-count')).toHaveTextContent('455 problems in 18 topics');
  }, 60_000);
});

describe('status, notes, important, revision + persistence across refresh', () => {
  const P = dataset.problems[10]; // any real problem
  const open = async (user: ReturnType<typeof userEvent.setup>, path = '/roadmap') => {
    renderApp(path);
    await user.selectOptions(select('Topic'), String(P.stepNo));
  };

  it('status changes on the card, is stored with a solved date, and survives a refresh', async () => {
    const user = userEvent.setup();
    const view = renderApp('/roadmap');
    await user.selectOptions(select('Topic'), String(P.stepNo));
    const card = () => within(cardOf(P.id));
    expect(card().getByRole('button', { name: 'Not started' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(card().getByRole('button', { name: 'In progress' }));
    expect(storedProgress()[P.id]).toMatchObject({ status: 'in_progress', solvedDate: null });
    await user.click(card().getByRole('button', { name: 'Solved' }));
    expect(storedProgress()[P.id]).toMatchObject({ status: 'solved', solvedDate: TODAY });

    view.unmount(); // == browser refresh: all React state is gone, only localStorage remains
    await open(user);
    expect(within(cardOf(P.id)).getByRole('button', { name: 'Solved' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(mainNav().getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByTestId('stat-solved')).toHaveTextContent('1');
  });

  it('personal notes save as you type and survive a refresh', async () => {
    const user = userEvent.setup();
    const view = renderApp('/roadmap');
    await user.selectOptions(select('Topic'), String(P.stepNo));
    await user.click(within(cardOf(P.id)).getByRole('button', { name: /^Notes/ }));
    await user.type(within(cardOf(P.id)).getByRole('textbox', { name: /Notes for/ }), 'Important: use monotonic stack.');
    expect(storedProgress()[P.id].notes).toBe('Important: use monotonic stack.');
    view.unmount();
    await open(user);
    expect(within(cardOf(P.id)).getByLabelText('has notes')).toBeInTheDocument();
    await user.click(within(cardOf(P.id)).getByRole('button', { name: /^Notes/ }));
    expect(within(cardOf(P.id)).getByRole('textbox', { name: /Notes for/ })).toHaveValue('Important: use monotonic stack.');
  });

  it('starring adds to the Important page, removing takes it off, and it persists', async () => {
    const user = userEvent.setup();
    const view = renderApp('/roadmap');
    await user.selectOptions(select('Topic'), String(P.stepNo));
    await user.click(within(cardOf(P.id)).getByRole('button', { name: 'Mark as important' }));
    expect(storedProgress()[P.id].important).toBe(true);
    view.unmount();
    renderApp('/important');
    expect(screen.getByTestId('important-count')).toHaveTextContent('1 starred');
    expect(cardIds()).toEqual([P.id]);
    await user.click(within(cardOf(P.id)).getByRole('button', { name: 'Remove from important' }));
    expect(screen.getByText(/No starred problems yet/)).toBeInTheDocument();
    expect(storedProgress()[P.id]).toBeUndefined();
  });

  it('revision is a separate flag: Solved stays Solved, counts/date update, dashboard solved count unchanged', async () => {
    const user = userEvent.setup();
    const view = renderApp('/roadmap');
    await user.selectOptions(select('Topic'), String(P.stepNo));
    await user.click(within(cardOf(P.id)).getByRole('button', { name: 'Solved' }));
    await user.click(within(cardOf(P.id)).getByRole('button', { name: 'Flag for revision' }));
    expect(storedProgress()[P.id]).toMatchObject({ status: 'solved', needsRevision: true, revisionCount: 0 });
    view.unmount();

    renderApp('/revision'); // after a refresh
    expect(screen.getByTestId('revision-count')).toHaveTextContent('1 to revise');
    expect(cardIds()).toEqual([P.id]);
    const c = within(cardOf(P.id));
    expect(c.getByTestId('revision-info')).toHaveTextContent('Revisions: 0. Last revised: never.');
    expect(c.getByRole('button', { name: 'Solved' })).toHaveAttribute('aria-pressed', 'true');
    expect(c.getByRole('textbox', { name: /Notes for/ })).toBeInTheDocument(); // notes visible on this page
    await user.click(c.getByRole('button', { name: 'Mark revised' }));

    expect(screen.getByText(/Nothing to revise/)).toBeInTheDocument();
    expect(storedProgress()[P.id]).toMatchObject({ status: 'solved', needsRevision: false, revisionCount: 1, lastRevised: TODAY, solvedDate: TODAY });
    await user.click(mainNav().getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByTestId('stat-solved')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-revision')).toHaveTextContent('0');
    expect(screen.getByTestId('today-count')).toHaveTextContent('1 / 10 completed'); // still counts for today
  });
});

describe('dashboard', () => {
  it('shows correct totals, completion %, difficulty and per-topic progress from the real dataset', () => {
    const m: Record<string, ReturnType<typeof entry>> = {};
    raw.forEach((p, i) => {
      if (i % 30 === 0) m[p.id] = entry({ status: 'solved', solvedDate: addDays(TODAY, -(i % 4)) });
      else if (i % 30 === 5) m[p.id] = entry({ status: 'in_progress' });
      if (i % 90 === 0) m[p.id] = { ...m[p.id], needsRevision: true };
    });
    seedProgress(m);
    renderApp('/');
    const solved = raw.filter((p) => m[p.id]?.status === 'solved');
    const inProg = raw.filter((p) => m[p.id]?.status === 'in_progress');
    expect(screen.getByTestId('stat-total')).toHaveTextContent('455');
    expect(screen.getByTestId('stat-solved')).toHaveTextContent(String(solved.length));
    expect(screen.getByTestId('stat-in-progress')).toHaveTextContent(String(inProg.length));
    expect(screen.getByTestId('stat-not-started')).toHaveTextContent(String(455 - solved.length - inProg.length));
    expect(screen.getByTestId('stat-revision')).toHaveTextContent(String(raw.filter((p) => m[p.id]?.needsRevision).length));
    expect(screen.getByTestId('completion')).toHaveTextContent(`${((solved.length / 455) * 100).toFixed(1)}%`);
    for (const [d, total] of [['Easy', 131], ['Medium', 187], ['Hard', 136], ['Unknown', 1]] as const) {
      const want = solved.filter((p) => (p.difficulty ?? 'Unknown') === d).length;
      expect(screen.getByTestId(`difficulty-${d}-total`)).toHaveTextContent(String(total));
      expect(screen.getByTestId(`difficulty-${d}-solved`)).toHaveTextContent(String(want));
    }
    for (let n = 1; n <= 18; n++) {
      const inStep = raw.filter((p) => p.step === n);
      const s = inStep.filter((p) => m[p.id]?.status === 'solved').length;
      expect(screen.getByTestId(`topic-count-${n}`)).toHaveTextContent(`${s}/${inStep.length}`);
      expect(screen.getByTestId(`topic-pct-${n}`)).toHaveTextContent(`${Math.round((s / inStep.length) * 100)}%`);
    }
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(20);
  });

  it('daily target: shows completed/remaining for today only, is settable (5/10/15/20) and persists', async () => {
    const user = userEvent.setup();
    seedProgress({
      [raw[0].id]: entry({ status: 'solved', solvedDate: TODAY }),
      [raw[1].id]: entry({ status: 'solved', solvedDate: TODAY }),
      [raw[2].id]: entry({ status: 'solved', solvedDate: TODAY }),
      [raw[3].id]: entry({ status: 'solved', solvedDate: TODAY }),
      [raw[4].id]: entry({ status: 'solved', solvedDate: addDays(TODAY, -1) }), // yesterday: not today's
    });
    const view = renderApp('/');
    expect(screen.getByTestId('today-count')).toHaveTextContent('4 / 10 completed');
    expect(screen.getByTestId('today-remaining')).toHaveTextContent('6 remaining');
    const group = within(screen.getByRole('group', { name: 'Daily target' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['5', '10', '15', '20']);
    await user.click(group.getByRole('button', { name: '5' }));
    expect(screen.getByTestId('today-count')).toHaveTextContent('4 / 5 completed');
    expect(screen.getByTestId('today-remaining')).toHaveTextContent('1 remaining');
    await user.click(group.getByRole('button', { name: '20' }));
    expect(screen.getByTestId('today-remaining')).toHaveTextContent('16 remaining');
    view.unmount();
    renderApp('/');
    expect(screen.getByTestId('today-count')).toHaveTextContent('4 / 20 completed');
  });

  it('daily target reports "Target reached" once met', () => {
    const m: Record<string, ReturnType<typeof entry>> = {};
    raw.slice(0, 5).forEach((p) => (m[p.id] = entry({ status: 'solved', solvedDate: TODAY })));
    seedProgress(m);
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ theme: 'dark', dailyTarget: 5, lastExport: null }));
    renderApp('/');
    expect(screen.getByTestId('today-count')).toHaveTextContent('5 / 5 completed');
    expect(screen.getByTestId('today-remaining')).toHaveTextContent('Target reached');
  });

  it('streaks: current (kept alive through today) and longest are computed from solve dates', () => {
    const dates = [0, -1, -2, -10, -11, -12, -13, -14].map((n) => addDays(TODAY, n));
    seedProgress(Object.fromEntries(dates.map((d, i) => [raw[i].id, entry({ status: 'solved', solvedDate: d })])));
    renderApp('/');
    expect(screen.getByTestId('streak-current')).toHaveTextContent('3');
    expect(screen.getByTestId('streak-longest')).toHaveTextContent('5');
  });

  it('streak is not lost before today ends, but is 0 after a missed day', () => {
    seedProgress({ [raw[0].id]: entry({ status: 'solved', solvedDate: addDays(TODAY, -1) }), [raw[1].id]: entry({ status: 'solved', solvedDate: addDays(TODAY, -2) }) });
    const v = renderApp('/');
    expect(screen.getByTestId('streak-current')).toHaveTextContent('2');
    v.unmount();
    seedProgress({ [raw[0].id]: entry({ status: 'solved', solvedDate: addDays(TODAY, -2) }) });
    renderApp('/');
    expect(screen.getByTestId('streak-current')).toHaveTextContent('0');
    expect(screen.getByTestId('streak-longest')).toHaveTextContent('1');
  });
});

describe('settings: theme, export, import, reset', () => {
  const sampleProgress = () => ({
    [raw[0].id]: entry({ status: 'solved', solvedDate: TODAY, notes: 'keep me', important: true }),
    [raw[7].id]: entry({ status: 'in_progress', needsRevision: true }),
  });

  it('switches dark/light and remembers it after a refresh', async () => {
    const user = userEvent.setup();
    const v = renderApp('/settings');
    expect(document.documentElement).toHaveClass('dark'); // dark by default
    await user.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings)!).theme).toBe('light');
    v.unmount();
    document.documentElement.classList.add('dark'); // a fresh page load starts from the inline script / default
    renderApp('/settings');
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
  });

  it('exports a versioned JSON file with the dataset checksum and records the export date', async () => {
    const user = userEvent.setup();
    seedProgress(sampleProgress());
    let blob: Blob | null = null;
    const downloads: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((b: Blob) => ((blob = b), 'blob:test')) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    renderApp('/settings');
    await user.click(screen.getByRole('button', { name: /Export progress/ }));
    expect(downloads).toEqual([`madhavs-dsa-progress-${TODAY}.json`]);
    const data = JSON.parse(await blobText(blob!));
    expect(data).toMatchObject({ app: 'madhavs-dsa-sheet', version: 1, dataset: { problemCount: 455 }, progress: sampleProgress() });
    expect(data.dataset.checksum).toMatch(/^[0-9a-f]{14}$/);
    expect(screen.getByText(new RegExp(`Last export: ${Number(TODAY.slice(8))} `))).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings)!).lastExport).toBe(TODAY);
  });

  it('import replaces current progress only after confirmation, and rejects bad files without changing anything', async () => {
    const user = userEvent.setup();
    seedProgress({ [raw[100].id]: entry({ status: 'solved', solvedDate: TODAY }) });
    renderApp('/settings');
    const input = screen.getByLabelText('Import progress file');

    await user.upload(input, new File(['{"hello":1}'], 'bad.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/progress export from this app/);
    expect(Object.keys(storedProgress())).toEqual([raw[100].id]); // untouched

    const good = JSON.stringify(buildExport(sampleProgress(), { checksum: 'different-checksum', problemCount: 455 }));
    await user.upload(input, new File([good], 'good.json', { type: 'application/json' }));
    const confirm = await screen.findByRole('group', { name: 'Confirm import' });
    expect(confirm).toHaveTextContent('2 entries');
    expect(confirm).toHaveTextContent(/different version of the problem dataset/);
    expect(Object.keys(storedProgress())).toEqual([raw[100].id]); // still not applied
    await user.click(within(confirm).getByRole('button', { name: 'Replace my progress' }));
    expect(storedProgress()).toEqual(sampleProgress());
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 entries');
  });

  it('import keeps orphaned entries (problems not in the dataset) and tells you about them', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const data = buildExport({ 'ghost-problem': entry({ status: 'solved', solvedDate: TODAY }), [raw[0].id]: entry({ status: 'solved', solvedDate: TODAY }) }, { checksum: 'x', problemCount: 455 });
    await user.upload(screen.getByLabelText('Import progress file'), new File([JSON.stringify(data)], 'g.json'));
    await user.click(await screen.findByRole('button', { name: 'Replace my progress' }));
    expect(storedProgress()['ghost-problem']).toBeDefined();
    expect(screen.getByText(/1 saved entries do not match any problem/)).toBeInTheDocument();
    await user.click(mainNav().getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByTestId('stat-solved')).toHaveTextContent('1'); // orphan is not counted
  });

  it('reset deletes ONLY personal progress (after confirmation); the dataset and settings are untouched', async () => {
    const user = userEvent.setup();
    seedProgress(sampleProgress());
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ theme: 'dark', dailyTarget: 15, lastExport: null }));
    const before = sha(rawDataset);
    renderApp('/settings');
    await user.click(screen.getByRole('button', { name: 'Reset progress' }));
    await user.click(within(screen.getByRole('group', { name: 'Confirm reset' })).getByRole('button', { name: 'Cancel' }));
    expect(Object.keys(storedProgress())).toHaveLength(2); // cancel changes nothing
    await user.click(screen.getByRole('button', { name: 'Reset progress' }));
    await user.click(screen.getByRole('button', { name: 'Yes, reset everything' }));
    expect(storedProgress()).toEqual({});
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings)!).dailyTarget).toBe(15);
    expect(sha(rawDataset)).toBe(before);
    expect(dataset.problems).toHaveLength(455);
    await user.click(mainNav().getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByTestId('stat-solved')).toHaveTextContent('0');
    expect(screen.getByTestId('stat-total')).toHaveTextContent('455');
  });
});

describe('resource buttons and known data problems', () => {
  it('external links open in a new tab with safe rel, use the dataset URL as-is, and appear only when a URL exists', async () => {
    const user = userEvent.setup();
    const full = dataset.problems.find((p) => resolveResources(p).length === 6)!;
    const partial = dataset.problems.find((p) => p.stepNo === full.stepNo && p.links.leetcode.url === null && resolveResources(p).length > 0)
      ?? dataset.problems.find((p) => p.links.leetcode.url === null && resolveResources(p).length > 0)!;
    renderApp('/roadmap');
    await user.selectOptions(select('Topic'), String(full.stepNo));
    const anchors = [...cardOf(full.id).querySelectorAll<HTMLAnchorElement>('a[data-resource]')];
    expect(anchors.map((a) => a.textContent?.trim())).toEqual(['LeetCode', 'GFG', 'Coding Ninjas', 'Video', 'Article', 'TUF+']);
    for (const a of anchors) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toMatch(/noopener/);
      expect(a.getAttribute('rel')).toMatch(/noreferrer/);
      expect(a.getAttribute('href')).toBe(full.links[a.dataset.resource as keyof typeof full.links].url);
    }
    await user.selectOptions(select('Topic'), String(partial.stepNo));
    const c = cardOf(partial.id);
    expect(c.querySelector('a[data-resource="leetcode"]')).toBeNull(); // null URL => no button
    expect(c.querySelectorAll('a[data-resource]')).toHaveLength(resolveResources(partial).length);
  });

  it('every card in the app shows exactly the resources the dataset has (all 455)', async () => {
    const user = userEvent.setup();
    renderApp('/roadmap');
    for (const b of document.querySelectorAll<HTMLElement>('section[data-topic] > button')) await user.click(b);
    let anchors = 0;
    for (const p of dataset.problems) {
      const got = [...cardOf(p.id).querySelectorAll<HTMLAnchorElement>('a[data-resource]')].map((a) => a.dataset.resource);
      expect(got).toEqual(resolveResources(p).map((r) => r.key));
      anchors += got.length;
    }
    expect(anchors).toBe(288 + 440 + 444 + 387 + 325 + 355);
    expect(document.querySelectorAll('a[data-mismatch]')).toHaveLength(24); // wrong-platform links kept + warned
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-mismatch]')) expect(a.title).toMatch(/Source sheet quirk/);
  }, 120_000);

  it('row 16.4.6 stays where it is with a visible warning and is not silently "fixed"', async () => {
    const user = userEvent.setup();
    renderApp('/roadmap');
    await user.selectOptions(select('Topic'), '16');
    const c = within(cardOf('01knpsckdp19'));
    expect(c.getByRole('heading', { level: 3 })).toHaveTextContent('Assign Cookies');
    expect(c.getByRole('note')).toHaveTextContent(/Known problem in the source sheet/);
    expect(c.getByRole('note')).toHaveTextContent('12.1.1');
    // it did not move: it is still the 6th problem of subtopic 16.4, right after 16.4.5
    expect(cardOf('01knpsckdp19').previousElementSibling?.getAttribute('data-problem-id')).toBe(dataset.problems.find((p) => p.ref === '16.4.5')!.id);
    expect(dataset.problems.find((p) => p.ref === '16.4.6')!.id).toBe('01knpsckdp19');
    expect(screen.getAllByTestId('source-warning').length).toBeGreaterThanOrEqual(1);
  });
});
