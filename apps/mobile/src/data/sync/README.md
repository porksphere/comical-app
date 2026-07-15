# `data/sync` — cross-device sync (the app's half)

Design and decisions: [`docs/CROSS-DEVICE-SYNC.md`](../../../../../docs/CROSS-DEVICE-SYNC.md); the
spike that chose hand-roll over TinyBase: [`sync-eval/FINDINGS.md`](../../../../../sync-eval/FINDINGS.md).

## Where the pieces live

The **contract and the merge** are in **`@comical/sync`** (the comical monorepo, via the
`external/comical` submodule): the HLC, the three merge primitives, the sync allow-list, the wire
types, and `RecordSet`. They live there because the **hub runs the same merge** — if the server's
join drifted from the devices', they would silently diverge, which is exactly what the CRDT exists to
prevent. It stays pure (no RN, storage, or network) so it behaves identically on JSC, QuickJS, Hermes
and under `bun test`.

The **server half** is `@comical/host-server`'s `/sync/push` + `/sync/pull` routes.

What's in *this* folder is the client machinery built on top:

| File | Role |
| --- | --- |
| `replica.ts` | One device's CRDT state + an outbox of local changes; pure in-memory. |
| `backend.ts` | The backend-agnostic transport seam (`SyncBackend`) + an in-memory reference backend. |
| `engine.ts` | The push-outbox / pull-since-cursor / merge loop. Drives any backend. |
| `http-backend.ts` | Tier-1 hub `SyncBackend` — HTTP client against a self-hosted host-server. |
| `crypto.ts` | The E2E seam (`CryptoBox`) + a pass-through box + a blob-backend wrapper. |
| `crypto-box.ts` | Real E2E `CryptoBox` — AES-GCM DEK + PBKDF2-wrapped pairing key + rotation. |
| `store-bridge.ts` | The `StoreBridge` seam (`hydrate` / `apply`). |
| `library-map.ts` | Shared `ChapterProgress` ↔ `Progress` mapping (bridge + write-through). |
| `library-bridge.ts` | `StoreBridge` over the real `@comical/library` `LibraryStore`. |
| `library-writethrough.ts` | `wrapLibraryStore` — captures live `LibraryStore` mutations into a `Replica`. |
| `embedded-bridge.ts` | `StoreBridge` over registries / installed / bridge-settings stores. |
| `cursor-store.ts` | AsyncStorage-backed `CursorStore` (RN glue; not isolation-tested). |
| `device-id.ts` | Stable per-install device id (the HLC `node`). |
| `sync-config.ts` | Persisted pairing/sync config + `useSyncConfig` hook. |
| `controller.ts` | App-facing `syncController` — wires stores → replica → engine, runs sync rounds. |

The load-bearing guarantee: **a later, stale progress write never rolls read position back** —
verified in the replica, at the real `ChapterProgress` store level, through the write-through
wrapper, and (in host-server's suite) through the real HTTP hub.

## Testing

**Unit / integration (no app, no device):**

```bash
cd apps/mobile && bun test src/data/sync   # 33 tests
```

Covers the replica + engine, the bridges against the real `InMemoryLibraryStore`, the Tier-1 client
over real HTTP, and the crypto. The merge itself is tested in the comical repo
(`bun test packages/sync`), and the hub in `bun test packages/host-server`.

**End-to-end against the real server (no device needed):** the hub is host-server, so just run the
dev server with sync switched on:

```bash
COMICAL_SYNC=1 COMICAL_TOKEN=dev-secret bun run dev    # from the workspace root → :3100
```

`COMICAL_SYNC=1` mounts `/sync/push` + `/sync/pull`. A token is **required** — the hub holds the
library in cleartext, partitioned only by an account id in a header, so it refuses to start an
unauthenticated one.

**On-device (needs an RN build):** run the above so it's reachable on your LAN, then on two devices
go to **Settings → Sync** and enter the **same** three values: the server URL (`http://<lan-ip>:3100`),
the **server token** (its `COMICAL_TOKEN` — the hub refuses unauthenticated clients), and the
**pairing code**. Toggle it on. Add a series on one device and confirm it appears on the other.
Requires native embedded mode ("Run bridges on this device") — on web, sync is a no-op.

The token and the pairing code are different secrets doing different jobs: the token is what lets you
talk to that server at all; the pairing code is what decides *which account* on it is yours (it's
what the account id is derived from). Two devices with the same token but different pairing codes
sync into two separate, invisible-to-each-other accounts.

## Phase 1b — done

The `comical` submodule is checked out, so everything below builds and tests against real types
(`bun test src/data/sync`: **23 tests**; strict `tsc` clean incl. `@comical/library`, `-host-rn`,
`-registry`, `-contract`):

- **`LibraryStoreBridge`** — real `LibraryStore` ↔ envelopes, tested against the actual
  `InMemoryLibraryStore`. Two decisions the real model forced (documented in its header): the
  entry's **resume cache syncs whole but self-heals** from the monotonic `progress` table, and
  **`ChapterProgress.updatedAt` is derived** from the winning HLC.
- **`EmbeddedStoresBridge`** — registries + installed bridges (sets) and per-bridge settings
  (register), over the host-rn store interfaces.
- **`wrapLibraryStore`** — write-through capture of steady-state edits (the alternative to
  re-hydrating), tested end-to-end across two devices.
- **`asyncStorageCursor`** — persisted pull cursor.

## Phase 2 — done, bar the on-device smoke test

- **The hub is real.** `@comical/host-server` serves `/sync/push` + `/sync/pull` (enable with
  `COMICAL_SYNC=1`, token required), backed by a `FileSyncStore` — one JSON file of merged records
  per account, with a per-account write lock and an atomic write. The merge is the shared
  `@comical/sync` join, so the server and every device compute the same result by construction, not
  by two implementations agreeing. Tested over real HTTP in that repo, including the monotonic
  progress guarantee end-to-end through the server. The old standalone `dev-server.ts` reference hub
  is gone — it existed only to make this testable before host-server had the routes.

- **`httpSyncBackend`** — the Tier-1 hub client (`http-backend.ts`), tested over **real HTTP**
  against a Bun.serve reference server that implements the endpoint contract (convergence, offline
  catch-up, account isolation, auth-failure keeps the outbox queued). That in-test server stays as
  the client-side executable spec.

- **`crypto-box.ts`** — the real E2E `CryptoBox` (phase 3, done early since it's self-contained):
  AES-GCM over a random DEK, the DEK wrapped by a PBKDF2-stretched pairing secret, plus
  `deriveAccountId` and account-level rotation. WebCrypto-only (Bun/browser native, RN via the
  Hermes shim). Tested: round-trip, no-plaintext-leak, two devices recovering the same DEK from a
  shared secret, wrong-secret rejection, rotation lockout, and engine convergence with only
  ciphertext on the wire. (PBKDF2 is the WebCrypto baseline; swapping in Argon2id later touches only
  `deriveWrappingKey`.)

- **App wiring** — `syncController` (`controller.ts`) is attached in `../embedded/startup.ts`: it
  wraps the AsyncStorage library store with write-through, builds the library + embedded bridges,
  restores the persisted replica, one-time-bootstraps existing data, and runs a sync round on start,
  on a 60s interval, and on app foreground (push outbox → pull → merge → apply → refresh queries).
  A **Sync** screen (`app/settings-sync.tsx`, reached from the Settings table-of-contents) drives it:
  enable toggle, server URL, pairing code, "sync now" + status. Local state uses **Legend State**
  (`sync-config.ts` via `persisted$`, the status observable in `controller.ts`) per the app's
  state convention — no `useSyncExternalStore`. Device id persists (`device-id.ts`).
  ⚠️ **Code-review-only so far** — this can't be built/run in the current session (no RN toolchain),
  so it needs an on-device smoke test. v1 targets the trusted self-hosted hub (cleartext records);
  the E2E `CryptoBox` is wired for the Tier-2 path, not the hub.

Next:

- **On-device verification** of the app wiring above — the one layer still unproven. It needs a real
  device or emulator: sync only runs in native embedded mode (`startup.web.ts` is a no-op), so the
  web build can't exercise it.
- **Pairing UX** — today you type the same secret phrase on each device; a QR / second-device-approval
  flow would be nicer (the design anticipates it).
- **Tier-2 blob adapter** over `encryptedBackend` (WebDAV/S3/Drive), using the real `CryptoBox`.
