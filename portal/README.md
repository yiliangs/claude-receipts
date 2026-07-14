# Portal development

The portal is a Vite and React app over the normalized session artifacts produced by `scripts/build-data.mjs`.

```bash
npm install
npm run dev
```

`npm run dev` refreshes `public/data/` from the configured data root and starts Vite on port 4179.

Production assets contain no user data. Vite writes them to the root package's `dist/portal/`, and the CLI generates the current session artifacts at runtime.

Key files:

- `src/App.tsx`: shell, navigation, search, and global filters
- `src/agg.ts`: client-side aggregation
- `src/charts.tsx`: SVG charts
- `src/drill.tsx`: session detail drawer
- `scripts/build-data.mjs`: shard normalization
