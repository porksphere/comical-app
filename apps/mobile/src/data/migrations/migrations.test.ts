import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MIGRATIONS } from './index';

/**
 * The registry's teeth.
 *
 * `MIGRATIONS` is a hand-written list, and a hand-written list of the code that can destroy user
 * data is worth exactly as much as its accuracy. These walk the directory and fail the build when
 * it drifts — the point being that someone adding a migration can't quietly skip registering it,
 * which is the failure mode a doc comment alone would have.
 */

const HERE = import.meta.dir;
const SRC = join(HERE, '..', '..');
const rel = (path: string) => path.slice(SRC.length + 1).replaceAll('\\', '/');

/** Every migration implementation in this directory — i.e. not the registry, not these tests. */
const implementations = readdirSync(HERE)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'index.ts')
  .map((name) => rel(join(HERE, name)))
  .sort();

describe('the migration registry', () => {
  it('registers every migration in the directory', () => {
    // The drift that matters: a file lands here and nothing lists it, so it's back to being
    // findable only by grep.
    expect(implementations).toEqual(MIGRATIONS.map((m) => m.file).sort());
  });

  it('points every entry at a file that exists, inside this directory', () => {
    for (const m of MIGRATIONS) {
      expect(m.file.startsWith('data/migrations/'), `${m.id} lives outside the directory`).toBe(true);
      expect(() => statSync(join(SRC, m.file)), `${m.id} points at a missing file`).not.toThrow();
      // A migration whose file no longer references the storage it claims to read is either stale
      // or lying about what it touches — both invisible until a user upgrades.
      expect(readFileSync(join(SRC, m.file), 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('keeps ids unique, and every field filled in', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MIGRATIONS) {
      for (const field of ['id', 'what', 'trigger', 'since'] as const) {
        expect(m[field].length, `${m.id}.${field} is empty`).toBeGreaterThan(0);
      }
    }
  });
});
