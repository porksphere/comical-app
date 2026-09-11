/**
 * Produce the renderer: the same `expo export --platform web` bundle the container image ships,
 * but exported at the domain root.
 *
 * `app.json`'s `experiments.baseUrl` is `/comical-app` for GitHub Pages, and SDK 56 reads the web
 * base path only from there — so, exactly as `Dockerfile` does for the web image, we patch it to
 * `''` for the export and put it back afterwards. Desktop serves from `/`.
 */
import { $ } from "bun";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DESKTOP = join(import.meta.dir, "..");
const MOBILE = join(DESKTOP, "..", "mobile");
const APP_JSON = join(MOBILE, "app.json");
const OUT = join(DESKTOP, "build", "web");

const original = await readFile(APP_JSON, "utf8");
const patched = JSON.parse(original);
patched.expo.experiments.baseUrl = "";

try {
  await writeFile(APP_JSON, `${JSON.stringify(patched, null, 2)}\n`);
  await rm(join(MOBILE, "dist"), { recursive: true, force: true });
  await $`bunx expo export --platform web`.cwd(MOBILE);
  await rm(OUT, { recursive: true, force: true });
  await cp(join(MOBILE, "dist"), OUT, { recursive: true });
  console.log(`web export → ${OUT}`);
} finally {
  await writeFile(APP_JSON, original);
}
