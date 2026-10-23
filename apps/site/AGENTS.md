# apps/site

The website and docs: Astro + Starlight, published by `.github/workflows/deploy-web.yml` to the
root of the repo's GitHub Pages, with the app's demo export beside it under `demo/`.

- `src/pages/index.astro` is the landing page; everything under `src/content/docs/` is a doc page,
  ordered by the `sidebar` in `astro.config.mjs`.
- `developers/{development,architecture,profiling}.md` and `changelog.md` are **generated** by
  `scripts/sync-docs.ts` from the repo's own `docs/*.md` and `CHANGELOG.md` on every dev/build/
  typecheck and are gitignored. Edit the source files, not these.
- Screenshots come from `docs/media/` (captured by `capture-demo.yml`); copy new ones into
  `src/assets/screens/` and show them through `DeviceFrame` so they get a bezel and responsive
  sizes. They picture sample data only — name the sample sources, never a real one.
- Links to other doc pages are relative (`../guides/reader/`), never absolute, so they survive
  the Pages subpath. `href()` in `src/lib/links.ts` prefixes the configured base for links written
  in components.
- `SITE_URL` / `SITE_BASE` override the deploy target; the defaults are the Pages root.
- On Windows, run `bun run build` from a path whose casing matches the disk exactly — Astro keys
  its style cache by the cwd and a mismatch silently drops every stylesheet from the output.
