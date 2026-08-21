import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MIGRATIONS } from './index';

/**
 * The registry's teeth.
 *
 * `MIGRATIONS` is a hand-written list, and a hand-written list of the code that can destroy user
 * data is worth exactly as much as its accuracy. These walk the source tree and fail the build when
 * it drifts — the point being that someone adding a migration can't quietly skip registering it,
 * which is the failure mode a doc comment alone would have.
 */

const SRC = join(import.meta.dir, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const rel = (path: string) => path.slice(SRC.length + 1).replaceAll('\\', '/');

describe('the migration registry', () => {
  it('registers every migrateLegacyKey call site', () => {
    // The in-place category — the one that can grow without anyone noticing, since adding one is a
    // single line inside an unrelated store module.
    const callSites = files
      .filter(({ path, text }) => text.includes('migrateLegacyKey(') && !rel(path).startsWith('lib/observable'))
      .map(({ path }) => rel(path))
      .sort();
    const registered = MIGRATIONS.filter((m) => m.kind === 'in-place')
      .map((m) => m.file)
      .sort();
    expect(callSites).toEqual(registered);
  });

  it('points every entry at a file that exists, and names the key it actually reads', () => {
    for (const m of MIGRATIONS) {
      const found = files.find(({ path }) => rel(path) === m.file);
      expect(found, `${m.id} points at a missing file: ${m.file}`).toBeDefined();
      // A registered legacy key that the file doesn't mention means the entry describes a migration
      // that no longer exists, or reads a different key than it claims — both silent until a user
      // upgrades and loses a setting.
      if (m.kind === 'in-place') {
        expect(found!.text, `${m.id} does not read ${m.legacyKey}`).toContain(m.legacyKey);
      }
    }
  });

  it('keeps ids unique and non-empty', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MIGRATIONS) expect(m.id.length).toBeGreaterThan(0);
  });

  it('keeps every module-kind migration inside this directory', () => {
    // The whole point of the directory: if it CAN live here, it does. An entry claiming `module`
    // from somewhere else is the split this registry exists to prevent.
    for (const m of MIGRATIONS) {
      if (m.kind === 'module') expect(m.file.startsWith('data/migrations/')).toBe(true);
    }
  });
});
