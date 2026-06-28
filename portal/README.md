# Claude Receipts — Usage Portal

A local, single-user analytics dashboard for your Claude Code spend. It loads
the shared `logbook.csv` (one row per session, written by the SessionEnd hook)
into memory once and makes every interaction — filter, cross-filter, sort,
drill-in — instant. Dark "ledger" visual language; session drill-ins render as
paper thermal receipts.

Five views share one cross-filter state: **Overview**, **Spend**, **Tokens**,
**Projects**, **Sessions**. Click any project / model / machine / session to
filter the whole portal.

## How it works

```
H:\My Drive\claude-receipts\logbook.csv
        |  scripts/build-data.mjs  (CSV -> clean JSON)
        v
portal/public/data/{sessions.json, meta.json}
        |
Vite + React + TS portal (this folder)
        |  loads the artifact once -> all aggregation client-side
        v
browser
```

- `sessions.json` — one normalized record per session (scalars + token columns).
- `meta.json` — build time + headline counts (the header freshness pill).

The data builder is wired into `predev` / `build`, so the JSON is rebuilt from
the CSV every time you start the dev server or produce a production bundle.

## Run

Double-click **`Claude-Receipts.bat`**, or from a terminal:

```bash
npm install      # first time only
npm run dev      # rebuilds data from the CSV, then serves at http://localhost:4179
```

Production bundle (static, openable from disk — `base: './'`):

```bash
npm run build    # -> dist/
npm run preview  # serve the built bundle at http://localhost:4173
```

## Refresh the data

The CSV is re-read on every `npm run dev`. To refresh while the dev server is
already running, re-run the builder and reload the browser tab:

```bash
npm run data
```

Point at a different logbook without editing source:

```bash
# PowerShell
$env:CLAUDE_RECEIPTS_LOGBOOK = "D:\path\to\logbook.csv"; npm run data
# or pass it directly
node scripts/build-data.mjs "D:\path\to\logbook.csv"
```

If the source CSV is unreachable (e.g. the Drive isn't mounted), the builder
keeps the existing snapshot in `public/data` so the portal still runs.

## Notes on the numbers

- **Cost by model** attributes a whole session's cost (and tokens) to its
  *primary* model — the first model id listed. The logbook records one cost per
  session, not a per-model split, so multi-model sessions are approximated this
  way. Token-*type* rollups (input / output / cache write / cache read) are
  exact — those are per-session columns.
- **Model families** group ids: Opus (4.7 + 4.8), Sonnet, Haiku, Fable.
- Project names are taken verbatim from the logbook (derived from `cwd`), so
  case variants like `natalie` / `Natalie` appear as distinct rows.

## Architecture

| File | Role |
|---|---|
| `scripts/build-data.mjs` | CSV → `public/data/*.json` (Node, build step) |
| `src/data.ts` | artifact loader + `LH` singleton + formatters |
| `src/agg.ts` | pure aggregation over the in-memory session array |
| `src/charts.tsx` | hand-built SVG charts (no chart lib) |
| `src/ui.tsx` | Card / KpiStrip / Delta / Legend / HList primitives |
| `src/App.tsx` | shell: header, search, nav rail, cross-filter state |
| `src/{overview,spend,tokens,projects,sessions}.tsx` | the five views |
| `src/drill.tsx` | session drill-in rendered as a paper receipt |
