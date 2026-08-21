/**
 * THE registry of every data migration in this app.
 *
 * A migration reshapes or relocates data a user already has on their device. That makes it the one
 * category of code here that can destroy something irreplaceable, and the one you need to be able
 * to find and reason about as a set rather than one grep at a time.
 *
 * So the rule is simply: **a migration lives in this directory and is listed in `MIGRATIONS`.**
 * `migrations.test.ts` walks the directory and fails the build on a file that isn't registered, so
 * the list can't drift from the code. Migrations used to be scattered — three legacy-key adoptions
 * firing from inside unrelated store modules, plus this one — and finding them meant knowing what
 * to grep for.
 *
 * Each entry is a DECLARATION, not a dispatcher: a migration is invoked by whatever owns its data
 * (which is what can supply, say, the library store instance), and centralising the *call* would
 * mean centralising those dependencies too. What is centralised is the answer to "what migrations
 * exist, and where do they run".
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
  /** The file it lives in, relative to `src/`. Must be inside this directory. */
  file: string;
  /** What invokes it. */
  trigger: string;
  /** The app version that introduced it, so "can this go yet?" is answerable without archaeology.
   *  A migration is removable once no reachable install predates it — dropping one strands anyone
   *  who skipped straight past the version that would have run it. */
  since: string;
};

/**
 * Every migration that runs on a user's device.
 *
 * Empty is a legitimate state: it means every shipped install is past the last reshape, which is
 * where a codebase wants to be.
 */
export const MIGRATIONS: readonly MigrationEntry[] = [
  {
    id: 'legacy-library-entries',
    what: "The pre-collections library: `comical:lib:entries` rebuilt as series items in a 'Library' collection, reattaching the progress, tracker links and cached detail that the dissolution orphaned.",
    file: 'data/migrations/legacy-entries.ts',
    trigger: 'data/embedded/startup.ts, once per launch (a no-op after the first that finds it)',
    since: '0.1.5',
  },
];
