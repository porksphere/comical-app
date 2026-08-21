/**
 * THE registry of every data migration in this app.
 *
 * A migration reshapes or relocates data a user already has on their device. That makes it the one
 * category of code here that can destroy something irreplaceable, and the one you need to be able
 * to find and reason about as a set rather than one grep at a time. So: every migration is listed
 * in `MIGRATIONS` below, and any migration that CAN live in this directory does.
 *
 * **If you write a new one, it goes here.** If it genuinely can't (see "in place" below), it still
 * gets a `MIGRATIONS` entry saying where it lives and why — `migrations.test.ts` fails the build if
 * a `migrateLegacyKey` call site isn't registered, so the in-place category can't quietly grow.
 *
 * ── Two shapes, and why there are two ──
 *
 * - **`kind: 'module'`** — the migration lives in this directory and is invoked explicitly by
 *   whoever owns the data. That is the default and the preferred shape.
 * - **`kind: 'in-place'`** — a `migrateLegacyKey` adoption that fires from its own store's module
 *   at load. These read a pre–Legend State key that was written as a BARE string (a raw URL,
 *   `'on'`, `'1'`) rather than JSON, and hand it to the store that replaced it. They stay put on
 *   purpose: each `adopt` callback is three lines closing over that module's own accessors
 *   (`overrideUrl()`, `storedPref()`) and its own value shape, so relocating them would mean
 *   exporting those internals — more coupling to the store, not less — and would move WHEN they
 *   fire, which is currently tied to the store module's load. The shared mechanism they all use
 *   lives in `lib/observable.ts`; it waits for the target store's persistence to hydrate before
 *   adopting, no-ops when the user has already set a value, and drops the legacy key either way.
 *
 * ── What is NOT a migration ──
 *
 * - **`PERSIST_BUSTER`** (`data/query-client.ts`) DISCARDS the persisted query cache when a cached
 *   shape or its origin changes. Nothing is moved or preserved — it is a cache, and the next fetch
 *   refills it. Listing it here would imply user data is at stake when none is.
 * - **Abandoned-in-place keys.** `comical:lib:lists`, `comical:lib:favorite-pages:*`, dead list ids
 *   in `hooks/use-library-sort.ts`, the legacy `'rail'` value in `data/custom-pages.ts`. Never
 *   read, never migrated, deliberately left to rot: they held no real user data (lists and page
 *   favorites shipped to nobody). Nothing runs, so there is nothing to register.
 */
export { migrateLegacyEntries, type LegacyEntriesMigration } from './legacy-entries';

export type MigrationEntry = {
  /** Stable identifier — this file is the only place it is defined. */
  id: string;
  /** What data moves, in one line. */
  what: string;
  /** Where the code lives, relative to `src/`. */
  file: string;
  /** What invokes it. */
  trigger: string;
} & (
  | { kind: 'module' }
  /** The `migrateLegacyKey` key this adoption reads. `migrations.test.ts` matches call sites
   *  against these, so a new in-place migration fails the build until it is registered. */
  | { kind: 'in-place'; legacyKey: string }
);

/**
 * Every migration that runs on a user's device. Declaration, not dispatch — the `module` entries
 * are invoked by the code that owns their data (which is what supplies the library store instance),
 * and the `in-place` ones fire from their own store's module. This list exists so "what migrations
 * exist" has one answer.
 */
export const MIGRATIONS: readonly MigrationEntry[] = [
  {
    kind: 'module',
    id: 'legacy-library-entries',
    what: "The pre-collections library: `comical:lib:entries` rebuilt as series items in a 'Library' collection, reattaching the progress, tracker links and cached detail that the dissolution orphaned.",
    file: 'data/migrations/legacy-entries.ts',
    trigger: 'data/embedded/startup.ts, once per launch (a no-op after the first that finds it)',
  },
  {
    kind: 'in-place',
    id: 'nsfw-mode-key',
    legacyKey: 'comical:nsfwMode',
    what: "A bare 'on'/'off' string adopted into the JSON-owned `comical:nsfwDurable`.",
    file: 'data/nsfw.ts',
    trigger: "that module's load",
  },
  {
    kind: 'in-place',
    id: 'server-url-key',
    legacyKey: 'comical:remoteServerUrl',
    what: 'A bare URL string adopted into the JSON-owned server-override store.',
    file: 'data/api.ts',
    trigger: "that module's load",
  },
  {
    kind: 'in-place',
    id: 'embedded-mode-key',
    legacyKey: 'comical:embedded:enabled',
    what: "A bare '1'/'0' string adopted into the JSON-owned embedded-mode preference.",
    file: 'data/embedded/preference.ts',
    trigger: "that module's load",
  },
];
