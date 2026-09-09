/**
 * Bundle the main process.
 *
 * The `@comical/*` packages are TypeScript source with no build step — the mobile app feeds them
 * straight to Metro, and the server runs them under Bun. Electron's main process is Node, so they
 * get bundled here instead: one `bun build --target=node` pass resolves the `@comical/*` aliases
 * out of `tsconfig.json` and inlines everything (hono, cheerio, zod, @noble) into a single CJS file.
 *
 * `electron` stays external — it's injected by the runtime, not installed into the bundle. Node
 * builtins (`node:vm`, which is what actually executes bridge bundles) are external by target.
 */
import { $ } from "bun";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const DESKTOP = join(import.meta.dir, "..");
const OUT = join(DESKTOP, "build");

await rm(join(OUT, "main.cjs"), { force: true });
await $`bun build ${join(DESKTOP, "src/main.ts")} \
  --target=node \
  --format=cjs \
  --external electron \
  --outfile ${join(OUT, "main.cjs")}`.cwd(DESKTOP);
console.log(`main → ${join(OUT, "main.cjs")}`);
