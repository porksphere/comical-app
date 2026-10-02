/**
 * Bundle the main process.
 *
 * The `@comical/*` packages are TypeScript source with no build step — the mobile app feeds them
 * straight to Metro, and the server runs them under Bun. Electron's main process is Node, so they
 * get bundled here instead: one pass resolves the `@comical/*` aliases out of `tsconfig.json` and
 * inlines everything (hono, cheerio, zod, @noble) into a single CJS file.
 *
 * `electron` stays external — the runtime injects it, it isn't installed into the bundle. Node
 * builtins (`node:vm`, which is what actually executes bridge bundles) are external by target.
 *
 * Uses the `Bun.build()` API rather than shelling out to `bun build`: this runs on a Windows CI
 * runner too, and the API sidesteps the shell quoting and line-continuation differences entirely.
 */
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";

const DESKTOP = join(import.meta.dir, "..");
const OUT = join(DESKTOP, "build");

// The preload runs sandboxed, where `require` reaches nothing but `electron` — so it is a bundle of
// its own rather than a chunk of main's.
for (const name of ["main", "preload"]) {
  const outfile = join(OUT, `${name}.cjs`);
  await rm(outfile, { force: true });

  const result = await Bun.build({
    entrypoints: [join(DESKTOP, `src/${name}.ts`)],
    target: "node",
    format: "cjs",
    external: ["electron"],
    // CI sets it from the workflow's `channel` input; only `desktop-release` self-updates.
    define: { "process.env.COMICAL_BUILD_CHANNEL": JSON.stringify(process.env.COMICAL_BUILD_CHANNEL ?? "") },
    outdir: OUT,
    naming: `${name}.cjs`,
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`${name} bundle failed`);
  }

  console.log(`${name} → ${outfile}`);
}

// The tray's icon, read at runtime from beside the bundles — the same mark the web build uses.
await copyFile(join(DESKTOP, "..", "mobile", "assets", "images", "favicon.png"), join(OUT, "tray.png"));
