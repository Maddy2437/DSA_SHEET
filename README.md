# Madhav's DSA Sheet

A personal, client-side DSA tracker built on the **old Striver A2Z sheet**: 18 topics, 61 subtopics, 455 problems, in the original order. No backend, no login. Your progress lives in your browser's `localStorage`.

React + Vite + TypeScript + Tailwind CSS + Lucide icons.

## Run it

Requires Node 20.19+ (or 22.12+).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm test           # automated tests (Vitest + jsdom + Testing Library)
```

## Deploy to Vercel (GitHub -> Vercel)

1. Create an empty GitHub repository and push this project to it (`node_modules` and `dist` are already git-ignored).
2. Go to vercel.com, choose **Add New... -> Project**, and import that repository.
3. Vercel detects Vite automatically (build command `npm run build`, output directory `dist`). Leave the defaults and click **Deploy**.
4. Every later `git push` to the main branch redeploys automatically.

The app uses hash-based routing (`/#/roadmap`), so no rewrite rules are needed on Vercel or any static host.

## Your data

- **Progress is per browser, per device.** The laptop and the phone keep separate progress, and clearing site data erases it. Use **Settings -> Export progress** regularly and **Import progress** to move it between devices. The dashboard reminds you if you have never exported or have not for 14 days.
- Stored under the keys `madhav-dsa:progress` (statuses, notes, stars, revision data) and `madhav-dsa:settings` (theme, daily target, last export date).
- The dataset is never written to. **Reset progress** deletes only your tracking data.
- Exports contain a version number and a checksum of the dataset. If you import into a build with a different dataset, entries for problems that no longer exist are kept (hidden), not deleted.

## How tracking works

- **Status:** Not started / In progress / Solved.
- **Star (Important)** and **Needs revision** are independent flags. Flagging a Solved problem for revision never changes its status. **Mark revised** clears the flag, adds 1 to the revision count and records the date.
- A problem's **solved date** is set the first time it becomes Solved and is never erased, even if you change the status later. Daily target and streak use those dates (local device date). A streak survives until the end of today if you solved something yesterday.

## The dataset

`src/data/a2z_old_sheet.json` is the extracted old sheet, bundled unchanged. Notes worth knowing:

- Each link keeps its cleaned/live URL as the primary one. Where the pre-cleanup value differs, it is stored as `original_url` and shown under **Notes -> Original links**.
- A resource button appears only when the dataset has a real URL. Nothing is ever guessed or constructed.
- **Row 16.4.6 ("Assign Cookies") is corrupted in the source** (its ID and GFG link look like 0/1 Knapsack, but its title and five other links are copies of row 12.1.1). It is left as-is and shows a warning.
- A few links sit under the wrong platform in the source (19 in the LeetCode slot, 5 in the GFG slot). They stay where they were and show a warning icon.
- `company_tags` is empty for every problem, so there is no company search or filter. The "Pattern" filter uses the source tags.
- Editorial links exist in the data but are not shown (TUF+ is the paid site).
- `data-reference/a2z_old_sheet.csv` is a flat copy of the dataset. The integrity tests cross-check the JSON against it.

### Replacing the dataset later

Drop in the new file at `src/data/a2z_old_sheet.json`, then update the pinned constants at the top of `src/tests/dataset.integrity.test.ts` (checksum, per-topic counts, link counts) and refresh the CSV. Your saved progress is keyed by problem ID, so it carries over wherever IDs match.

## Project layout

```
src/
  data/         a2z_old_sheet.json (read-only source of truth)
  types/        shared TypeScript types
  utils/        dataset, progress (state ops, import/export), stats + streaks, filters, resources
  hooks/        progress / settings / filters state, useToday, useStats
  components/   ProblemCard, StatusControl, ResourceButtons, FilterBar, Sidebar, TopBar, ...
  pages/        Dashboard, Roadmap, Important, Revision, Settings
  tests/        dataset integrity, logic, and UI flow tests
```
