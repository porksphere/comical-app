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
import { rm } from "node:fs/promises";
import { join } from "node:path";

const DESKTOP = join(import.meta.dir, "..");
const OUT = join(DESKTOP, "build");
const outfile = join(OUT, "main.cjs");

await rm(outfile, { force: true });

const result = await Bun.build({
  entrypoints: [join(DESKTOP, "src/main.ts")],
  target: "node",
  format: "cjs",
  external: ["electron"],
  outdir: OUT,
  naming: "main.cjs",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("main-process bundle failed");
}

console.log(`main → ${outfile}`);
