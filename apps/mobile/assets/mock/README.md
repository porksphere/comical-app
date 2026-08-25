# Mock catalog art

Only reachable from mock mode (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1` or the `__DEV__` Settings
toggle) — see `src/data/source.ts`. Wired up in `src/data/mock-assets.ts`.

These are bundled rather than fetched. Every cover used to be a live `picsum.photos` request,
which made the "comics" stock photographs of skyscrapers and laptops, and made mock mode — the e2e
suite and the GitHub Pages demo included — depend on a third-party service being up before it
could render a grid. 1.5MB of bundle buys determinism and offline capability.

## `covers/` — generated

24 PNGs from `scripts/generate-mock-covers.py`. Flat fields with one rounded motif, everything
derived from a seed. Rerun the script to change the design; the output is committed.

## `pages/` — Little Nemo in Slumberland, Winsor McCay, 1907

Public domain. Published 1905–1914 in the *New York Herald*, so PD in the US under the pre-1929
rule; McCay died in 1934, so life+70 expired worldwide in 2005 as well. Sourced from Wikimedia
Commons, every file reporting `Public domain` in its licence field.

No attribution is legally required. The provenance is recorded anyway because it is the thing
nobody can reconstruct from the files themselves, and because "where did this art come from" is a
question worth being able to answer instantly.

| file | source |
|------|--------|
| `00.jpg` | [Little Nemo 1907-02-03](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-02-03.jpg) |
| `01.jpg` | [Little Nemo 1907-03-10](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-03-10.jpg) |
| `02.jpg` | [Little Nemo 1907-03-31](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-03-31.jpg) |
| `03.jpg` | [Little Nemo 1907-04-07](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-04-07.jpg) |
| `04.jpg` | [Little Nemo 1907-04-28](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-04-28.jpg) |
| `05.jpg` | [Little Nemo 1907-05-05](https://commons.wikimedia.org/wiki/File:Little_Nemo_1907-05-05.jpg) |

Downscaled to 800px wide, JPEG q64. The originals are ~1750x2300 and ~1MB each; at 800px the
lettering is still legible on a phone, which is the only bar that matters here.

## Known consequence: downloads in mock mode

Page URLs used to be `picsum.photos` links, so the download engine's `PageFetcher`
(`src/data/downloads/fetch-page.ts`) could fetch them like any real source. They are now bundled
assets, which resolve to a Metro-served http URL in dev but to a bundled resource in a release
demo build — and `fetch-page.ts` handles `data:` URIs and http(s) URLs, not resource paths.

So **downloading a chapter in mock mode is unverified on a release demo build**, and
`e2e/mobile/downloads.yaml` / `e2e/web/downloads.yaml` — whose headers still describe pages as
"a real fetch to picsum.photos" — need a run to confirm. Real sources are unaffected: their page
URLs are http(s) and never came from here.

Two ways out if it does break: point `readerPage` back at a remote URL (loses offline mock, keeps
the download path honest), or teach `fetch-page.ts` to read a bundled asset. Neither is done here,
because which one is right depends on whether offline mock or mock downloads matters more.
