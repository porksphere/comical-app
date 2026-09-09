/**
 * Write the build version into `apps/desktop/package.json`, which is where electron-builder reads
 * it from (it names the installers and fills the Windows file-version resource).
 *
 * The number comes from `.github/scripts/compute-build-version.sh` — the same script the Android
 * and iOS lanes use — so a desktop build is traceable to the same commit series as a mobile one.
 * That script emits `X.Y.Z` for a release and `X.Y.Z.N` for a rolling build, where N counts this
 * release series' commits.
 *
 * **`X.Y.Z.N` is not valid semver, and electron-builder rejects it outright** ("Invalid version").
 * So the fourth component is rewritten as a semver prerelease: `0.2.0.40` → `0.2.0-40`. Same two
 * facts, one character different, and every downstream consumer (installer filename, Windows file
 * version, the release notes) then agrees on one string. Ordering does invert versus the mobile
 * lanes — semver ranks `0.2.0-40` *below* `0.2.0` — which is harmless while there's no update feed
 * (`publish: null` in electron-builder.yml); revisit it alongside electron-updater in Milestone 4.
 *
 *   bun run scripts/stamp-version.ts            # compute from git history (needs full history)
 *   VERSION_INPUT=1.2.3 bun run scripts/…       # or pass one in (what CI does)
 */
import { $ } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DESKTOP = join(import.meta.dir, "..");
const ROOT = join(DESKTOP, "..", "..");

/** `X.Y.Z.N` → `X.Y.Z-N`; anything already semver-shaped passes through untouched. */
export function toSemver(raw: string): string {
  const four = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  return four ? `${four[1]}.${four[2]}.${four[3]}-${four[4]}` : raw;
}

// Prefer an explicitly supplied version and don't shell out at all. CI computes it in its own
// `shell: bash` step and passes it in — the Windows runner has bash, but reaching it through bun's
// shell is one cross-platform difference this doesn't need to depend on.
const raw = (
  process.env.VERSION_INPUT?.trim() ||
  (await $`bash .github/scripts/compute-build-version.sh`.cwd(ROOT).text()).trim()
);
const version = toSemver(raw);

// electron-builder validates this with semver and dies on anything else, so catch it here where
// the error names the actual problem instead of surfacing 200 lines into a packaging run.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`refusing to stamp a non-semver version: "${raw}" → "${version}"`);
}

const pkgPath = join(DESKTOP, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
pkg.version = version;
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(version);
