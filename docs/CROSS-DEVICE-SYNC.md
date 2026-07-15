# Cross-device sync — design

Status: **proposal / RFC.** Nothing here is built yet. This document scopes what sync should
cover, surveys the off-the-shelf options, and proposes an architecture that fits Comical's
existing shape (native runs fully on-device; web talks to a self-hosted `@comical/host-server`).

## The problem, precisely

A user reads on several installs — an iPhone, an Android tablet, a laptop browser pointed at
their self-hosted host, maybe a second browser on a public deployment. They expect the same
library, the same read position, the same settings on all of them. Devices come and go from
networks; two of them are rarely online at the same instant on the same LAN.

Two facts about the current architecture make this non-trivial (see
[ARCHITECTURE.md](./ARCHITECTURE.md)):

1. **There is no server every device shares.** Native (iOS/Android) runs entirely on-device
   with state in `AsyncStorage`; there is no backend involved at all. Web talks to a
   `@comical/host-server` the user hosts — but that server is *theirs*, possibly LAN-only, and a
   different user (or the same user's phone on cellular) may not be able to reach it.
2. **State lives in two different stores that already share one interface.** The `LibraryStore`
   contract is implemented by `AsyncStorageLibraryStore` on-device
   (`apps/mobile/src/data/embedded/library-store.ts`) and by a file-backed store in
   `@comical/host-server`. That shared interface is the seam sync plugs into.

The hard requirement the user called out — *"reach a device on a certain network, but maybe only
later"* — is the defining constraint. **You cannot deliver a change to a device that is offline.**
Physics. So any design that claims to work "device to device" across networks and time actually
needs a **rendezvous point that is online when at least one party is** — a place changes are
parked until the other side shows up. The interesting design questions are all about *what that
rendezvous is*, *how changes merge when they finally meet*, and *how little the rendezvous is
trusted to see*.

## What should sync (and what must not)

Everything below is already persisted; the question is only which of it is *identity* (belongs to
the user, syncs) versus *device state* (belongs to this install, stays put).

### Syncs — user data

Source of truth is the `LibraryStore` "files" (`library-store.ts`) plus two sibling stores:

| Data | Store / key | Merge semantics |
| --- | --- | --- |
| **Library entries** (membership + metadata) | `comical:lib:entries` | LWW register per entry, with tombstone on remove |
| **Read status / resume position** | `comical:lib:progress:<key>` (`ChapterProgress` per chapter) | **Monotonic merge** — furthest-read wins, not last-write |
| **History** (last read per series) | `comical:lib:reading-log` (`HistoryItem`) | LWW by read timestamp (already a timestamp) |
| **Lists** | `comical:lib:lists` | LWW register per list; membership is an OR-set |
| **Groups** | `comical:lib:groups` | LWW register per group |
| **Tracker links** | `comical:lib:tracker-links` | LWW per `(entry, trackerId)` |
| **Bridge prefs** | `comical:lib:bridge-prefs` | LWW register per bridge |
| ~~Activity feed~~ | `comical:lib:activity` | **Does not sync — derived locally** (see below) |
| **Per-bridge settings** | `comical:embedded:settings:<id>` (`settings-store.ts`) | LWW register per bridge (per-field if we want finer) |
| **Registries** | `comical:embedded:registries` (`stores.ts`) | OR-set of URLs (add/remove with tombstones) |
| **Installed bridges** | `comical:embedded:installed` | OR-set keyed by bridge id |

Registries and installed-bridge *records* sync; the downloaded **bundles** do not — each device
re-downloads and re-verifies (SHA-256 / Ed25519) from the registry itself, exactly as it does on
first install. Sync moves the *decision* to install, not the artifact.

**Activity feed is derived, not synced.** `comical:lib:activity` is a high-volume append log, and
its rows are a function of data we already sync (progress + history + entries). **Decision: each
device regenerates its own activity feed locally** from synced state, rather than replicating the
log. That keeps the sync payload small and sidesteps a churny append-only union with its own GC.

### Stays local — device state

These describe *this install* and syncing them would actively break things:

- **Runtime mode** — `comical:embedded:enabled` (`preference.ts`). "Run bridges on this device"
  is meaningless on web and phone-specific on native.
- **Server URL override** — the host address a browser uses is per-deployment.
- **Mock-data / demo toggles**, `hideNsfw` if we decide it's per-device.
- **Reader display settings** — `comical:readerSettings` (`use-reader-settings.ts`: mode,
  direction, pageFit, prefetchAhead). *Arguably* syncable as a default, but they track the
  device's screen and are the kind of thing users set differently on phone vs. tablet.
  **Decision: local-only.** They track the device (RTL paged on a phone, webtoon on a tablet), so
  they do not sync — not even as a default.

The classification itself should live in code as an explicit allow-list, not a `*`-minus-a-few
rule, so a newly added key never silently starts (or stops) syncing.

## Conflict model — CRDT-lite, not full CRDT

The state is a **keyed document store**, not collaboratively-edited text. That means we do *not*
need Yjs/Automerge-grade sequence CRDTs. We need three primitives, all trivially mergeable and
order-independent:

1. **LWW register** — one value, tagged with a logical timestamp; higher timestamp wins. Covers
   entries, lists, groups, settings, prefs.
2. **OR-set with tombstones** — add and remove each carry a timestamp; an element is present iff
   its latest op is an add. Covers registries, installed bridges, list membership. Tombstones are
   what make "removed on phone" actually stick when the laptop (which still has it) syncs.
3. **Monotonic / max merge** — for read progress, the *furthest* position wins regardless of
   write order. Reading ch.10 on the phone then re-opening ch.3 on the laptop must **not** roll
   your progress back to ch.3. This is a bounded join, not LWW, and getting it wrong is the most
   common way sync corrupts a reader's history. **"Furthest" reuses the existing `chapter-order`
   logic** — the same decimal/number-based ordering the reader already treats as source of truth —
   rather than a sync-specific comparator. It inherits that logic's quirks with messy
   multi-scanlator numbering; good enough to ship, refine later if a real ordering bug surfaces.

**Clocks:** wall-clock time is unusable here — native devices have no shared server and their
clocks drift. Use a **Hybrid Logical Clock (HLC)**: a `(physicalTime, counter, deviceId)` tuple
that stays close to wall-clock for human readability but is monotonic per device and totally
ordered across devices via the tie-breaking `deviceId`. Every write stamps an HLC; merges compare
HLCs. This is ~100 lines and has no dependencies.

Net: each record becomes `{ value, hlc, deleted? }`, and merge is a pure function of two such
records. No central coordinator decides "who won" — every device computes the same winner
independently. That property is what lets the rendezvous be dumb (and untrusted — see below).

## Transport — the rendezvous, and the offline answer

The merge model is transport-agnostic; the same op-log can travel over any of these. The
recommendation is to **support a tiered set, sharing one protocol and payload format**, because
the topologies the user named genuinely differ.

### Protocol (same regardless of backend): outbox + cursor

Each device keeps:

- an **outbox** — the log of local ops not yet acknowledged by the backend (or a dirty-set +
  per-record HLC, which is equivalent and smaller);
- a **cursor** — the last backend position this device has pulled.

Sync = *push my outbox, then pull everything after my cursor, merge, advance cursor.* Because the
backend retains the log (or a merged snapshot), a device that was offline for a week just pushes
its week of ops and pulls everyone else's on reconnect. **This is exactly how "unreachable now,
reachable later" is handled — the rendezvous holds the changes; neither device has to be online at
the same time.** Ops are idempotent (keyed by record + HLC), so retries and duplicate deliveries
are safe.

### Tier 1 — host-server as sync hub (recommended primary) — **BUILT**

Comical *already* ships a self-hostable server with a persistent `/data` volume, so the sync surface
went there. As shipped in `@comical/host-server`:

- `POST /sync/push` (records) and `GET /sync/pull?cursor=<hlc>`. The server keeps a per-account
  merged `RecordSet`, persisted as one JSON file per account; the cursor is a packed HLC, so no
  separate op-log is needed — "everything stamped after X" is a comparison, not a log scan.
  (WebSocket live push remains possible later; polling was enough to start.)
- The account comes from the `X-Comical-Account` header, derived client-side from the pairing secret.
  Enabled with `COMICAL_SYNC=1`, and **the bearer token is mandatory** — the hub holds the library in
  cleartext, so it refuses to stand up unauthenticated.
- Crucially the server merges with the **same** `@comical/sync` join the devices run, rather than its
  own implementation of the same rules. Two implementations that agree today drift tomorrow, and a
  hub that merges differently from its devices is a silent divergence with no symptom until read
  position starts moving backwards.
- Native devices, which today talk to *nobody*, gain an **optional** "sync to a host" setting
  pointing at the same server the web build uses. They remain peer-equal — everyone pushes/pulls
  the same endpoint.

This reuses the user's existing hosting story (self-hosted LAN box *or* publicly-exposed with the
reverse-proxy + TLS the README already documents) and needs no new infrastructure. It is the best
default for anyone already running a host.

**Caveat it doesn't solve alone:** a LAN-only host is unreachable from cellular. That's fine — it's
still a correct rendezvous *for the networks it's on*; the phone syncs when it's home on Wi-Fi.
Users who want anywhere-access expose the host publicly (already supported) — which makes Tier 3's
encryption mandatory.

### Tier 2 — bring-your-own blob (no server to run)

For users who won't run a server: replicate the op-log to a **user-owned blob store** —
WebDAV / S3-compatible / Google Drive / Dropbox. The backend is just "a place to `PUT`/`GET` a
file (or an append-only set of op files)." This is precisely the path the **Mihon/Tachiyomi**
ecosystem took (Google Drive + self-hosted **SyncYomi**), and it's the lowest-friction option for
non-technical users. Same op-log, same merge; the blob is dumb storage.

### Tier 3 — LAN peer-to-peer (nice-to-have, not sufficient alone)

When two devices *are* on the same network, direct sync (mDNS/Bonjour discovery + a WebSocket, or
piggybacking on the embedded host) is fast and serverless. But it **only** works when both are
online together, so it can never be the *only* mechanism — it's an accelerator layered on Tier 1/2,
not a replacement. (Syncthing solves the offline case P2P-style via always-on relays; that's
effectively "run your own rendezvous," i.e. Tier 1 with more moving parts.)

### Decision: both Tier 1 and Tier 2, one protocol

Build the op-log + HLC + CRDT-lite core **backend-agnostic**, with the backend behind a small
adapter interface (`push(ops)` / `pull(since)`). Ship the **Tier 1 host-server hub adapter first**
(it reuses infra we already have), then the **Tier 2 blob adapter** right after, over the exact same
protocol and payload. Tier 3 LAN P2P stays a later latency optimization. The upfront cost is one
adapter abstraction — cheap, and it prevents baking host-hub assumptions into the core.

## Trust & security — mandatory once the relay is public

The README explicitly supports exposing the host publicly. A publicly-reachable rendezvous (or a
third-party blob in Tier 2) **must not be trusted with library contents** — a reading history is
sensitive. Therefore:

- **End-to-end encryption** is what makes "publicly exposed" safe. The server/blob stores opaque
  ciphertext and merges by envelope metadata (record id + HLC, kept cleartext) without reading
  values — or, simplest, the client pulls-merges-pushes and the relay stores one opaque blob per
  account.
- **Two-level key hierarchy (adopt from day one).** Do **not** encrypt the payload directly with a
  passphrase-derived key. Instead:
  - a random **Data Encryption Key (DEK)** actually encrypts the sync payload;
  - a **pairing secret** the user enters on each device is stretched (Argon2id/scrypt) into a
    *wrapping* key that only encrypts the DEK;
  - the relay stores the wrapped DEK alongside the ciphertext.

  This indirection is nearly free and buys **account-level key rotation**: "sign out other devices /
  re-key" regenerates the DEK and re-wraps it, so anything holding only the old passphrase material
  is locked out of future data. That alone covers the lost-phone case without a device registry.
- **Pairing = identity.** There are no user accounts today. Device pairing is a shared secret:
  device A shows a code / QR, device B enters it; both recover the wrapping key and thus the DEK.
  This doubles as the "these installs are the same user" mechanism the current single-user model
  lacks.
- **Optional bearer auth** already exists on host-server (`COMICAL_TOKEN`); reuse it to gate the
  sync endpoints in addition to E2E.

### Per-device keys — worth it? (decision: design for it, ship it later)

The tempting "revocable per-device keys" upgrade replaces the single DEK-wrap with **one wrap per
device**: each device gets an identity keypair, registers its public key, and the DEK is wrapped for
each; revoking a device means dropping its wrap and rotating the DEK so it can't decrypt future
data. Done rigorously it also wants an **existing device to approve new enrollments** (otherwise
anyone with the pairing passphrase enrolls freely, which collapses back to shared trust).

For a **single-user personal comic reader**, the cost/benefit is genuinely marginal, and worth being
honest about:

- **A lost phone is mostly an on-device problem.** Whoever holds the unlocked device already sees
  the whole library in the app; revoking its *sync* key only stops it pulling *future* history. The
  real mitigations are OS-level (device lock, remote wipe), and account-level DEK rotation already
  covers "re-key so the old device is cut off going forward."
- **Per-device revoke earns its keep in multi-user systems** where membership churns — not here,
  where it's one person's own devices.
- **The enrollment-approval UX cuts against the app's ethos** (sideloaded, no accounts, low
  ceremony). Adding "approve this new device" prompts is real friction for a small marginal gain
  over account-level re-key.

**Decision:** build the envelope with the DEK indirection above (which already accommodates
per-device wrapping — the DEK is wrapped *N* times instead of once, no format change), ship
**account-level rotation** first, and add **true per-device keypairs + a device-management list**
only if/when a device list proves worth its UX. This gets ~80% of the security value immediately
and leaves the door open without over-building.

## Library survey — what's actually out there

Honest read: **no single library both merges this state model *and* solves store-and-forward
delivery for you.** They split into "merge engines" and "replication engines," and this app's data
is simple enough that the merge half is ~a few hundred lines. Candidates, with the tradeoff that
matters here:

**Merge / CRDT engines**
- **Yjs** — best-in-class for *collaborative text/structured docs*; `y-websocket`, `y-webrtc`,
  `y-indexeddb`. Overkill for keyed KV state and its sequence CRDTs add weight we'd never use.
- **Automerge** (+ `automerge-repo`) — document CRDT with a real sync protocol and storage
  adapters; RN-workable. Closer than Yjs, but still a general document CRDT where we need three
  specific register types, and the Wasm core is a footprint hit on the JS engines Comical uses
  (JSC/QuickJS).

**Local-first replication engines (bring a server you implement)**
- **RxDB** — mature replication protocol (push/pull handlers, conflict handler), RN + browser +
  Node, backend-agnostic. Strong fit if we want a batteries-included path and are willing to adopt
  its collection model.
- **WatermelonDB** — RN-first, has a sync primitive (pull/push against a server you write). Great
  on native, weaker web/Node story — awkward given web is a first-class target here.
- **TinyBase** — tiny, TS-native, has a **`MergeableStore` (CRDT) + synchronizers + a sync
  server**, with persisters for RN, browser, and Node. The closest single dependency to "what we'd
  otherwise hand-roll," and its footprint suits the constrained engines. Worth a serious spike.
- **ElectricSQL / PowerSync / Zero / Replicache** — excellent local-first stacks, but they assume
  Postgres (Electric/PowerSync/Zero) or are commercially licensed (Replicache), which is a poor fit
  for a file-store-based, self-hosted, no-database app.

**Prior art in this exact niche (read these before building)**
- **Mihon / Tachiyomi** — the de-facto manga readers. Their cross-device story is (a) **trackers**
  (AniList / MyAnimeList) as the real read-progress backbone, (b) **backup export/restore** files,
  and (c) **cloud sync via Google Drive or self-hosted SyncYomi**. Comical already has tracker
  links (`comical:lib:tracker-links`) — trackers are a partial, coarse-grained sync we get *for
  free* for progress on tracked series, and worth leaning on as a complement.
- **Kavita / Komga / Suwayomi-Server** — self-hosted comic servers where the server *is* the source
  of truth, so "sync" is just "every client reads the same server." That's essentially Tier 1 taken
  to its logical end.

**Decision (spike done → hand-roll).** We spiked **TinyBase's MergeableStore** against the three
success criteria — (a) integrates with the existing `LibraryStore` seam without rewriting the
file/AsyncStorage layers, (b) runs on JSC **and** QuickJS without a Wasm/bundle blowup, (c) supports
the backend-agnostic push/pull adapter — and chose to **hand-roll the CRDT-lite core**. TinyBase is
pure-JS, no-Wasm, small (~36 KB), and correct on LWW registers/sets/tombstones, but its LWW-per-cell
merge **cannot express the monotonic read-progress join** (it rolls read position back on a stale
concurrent write) and it wants to *own* storage, which means migrating off — not wrapping — the
existing seam. Full evidence, scorecard, and a runnable harness live in
[`sync-eval/FINDINGS.md`](../sync-eval/FINDINGS.md). RxDB was not spiked: heavier, same
owns-the-storage problem, and TinyBase losing on the deciding criteria settled it. TinyBase stays on
the shelf as confirmation the merge model (HLC + LWW + tombstones) is industry-standard — we
re-implement it minus the one place it's wrong for a reader (progress).

## Phasing

0. **Library spike.** ✅ **Done — see [`sync-eval/FINDINGS.md`](../sync-eval/FINDINGS.md).**
   Outcome: **hand-roll the CRDT-lite core.** Both TinyBase and the hand-roll converge correctly on
   LWW registers, sets, and tombstones, but TinyBase's LWW-per-cell merge *cannot* express the
   monotonic read-progress join (it rolls a reader's position back on a stale concurrent write),
   and adopting TinyBase would mean migrating off the existing `LibraryStore` persistence rather
   than wrapping it. TinyBase is pure-JS/no-Wasm and small (~36 KB), so it stays validated as
   proof our merge semantics are industry-standard — we re-implement that model minus the one place
   it's wrong for us. RxDB not spiked (heavier, same "owns storage" problem; TinyBase losing
   settled it).
1. **Model.** ✅ **Core done — [`apps/mobile/src/data/sync/`](../apps/mobile/src/data/sync/)**
   (`bun test src/data/sync`, 16 tests, strict-typecheck clean). HLC + the three merge primitives
   (register/tombstone, LWW-element-set, monotonic progress), the sync/local allow-list as data, the
   backend-agnostic `SyncBackend` seam, an E2E `CryptoBox` seam, and the outbox/cursor engine — all
   pure, no RN/storage/`@comical` deps, so it runs the same on JSC, QuickJS, and in tests. The
   monotonic-progress no-rollback guarantee is verified end-to-end through the engine.
   **Phase 1b ✅ done** (`comical` submodule checked out; builds + tests against real types — 23
   tests, strict `tsc` clean incl. `@comical/library`/`-host-rn`/`-registry`/`-contract`):
   - `LibraryStoreBridge` — real `LibraryStore` ↔ envelopes, tested against the actual
     `InMemoryLibraryStore`. Two real-model decisions made explicit: (a) the library entry syncs
     whole as one LWW register, and its **resume cache self-heals** from the monotonic `progress`
     table rather than needing field-level merge; (b) `ChapterProgress.updatedAt` is **derived from
     the winning HLC**.
   - `EmbeddedStoresBridge` — registries + installed bridges (sets) + per-bridge settings (register).
   - `wrapLibraryStore` — write-through capture of live edits (steady-state alternative to re-hydrate).
   - `asyncStorageCursor` — persisted pull cursor.

   **Phase 2 (done, bar the on-device smoke test):** the Tier-1 hub exists on **both** sides.

   - **Server:** `@comical/host-server` serves `POST /sync/push` + `GET /sync/pull` over a
     `FileSyncStore` (one JSON file of merged records per account, per-account write lock, atomic
     write). `COMICAL_SYNC=1`; the bearer token is mandatory.
   - **Shared:** the merge and the wire contract moved to **`@comical/sync`**, so the hub and the
     devices run the *same* join rather than two implementations of it.
   - **Client:** `httpSyncBackend` ([`http-backend.ts`](../apps/mobile/src/data/sync/http-backend.ts)),
     tested over real HTTP (convergence, offline catch-up, account isolation, auth-failure retry).
   - **Crypto:** the real **E2E `CryptoBox`** ([`crypto-box.ts`](../apps/mobile/src/data/sync/crypto-box.ts))
     is done (WebCrypto AES-GCM DEK + PBKDF2-wrapped pairing key + `deriveAccountId` + rotation), but
     belongs to the untrusted Tier-2 path — the hub path is cleartext by design, since the server
     merges.
   - **App wiring** is in place (`syncController`, attached in `embedded/startup.ts`; a **Sync**
     screen in Settings) but remains **code-review-only** — it needs an on-device smoke test, which
     requires a real device: sync only runs in native embedded mode, so the web build can't exercise
     it.

   Next: that smoke test, then the Tier-2 blob adapter.
2. **Tier 1 hub.** Host-hub adapter: sync endpoints on `@comical/host-server`; outbox/cursor
   client; opt-in on native. Get two web browsers + one phone converging against one self-hosted
   host.
3. **E2E + pairing.** Two-level key envelope (pairing secret → wrapped DEK), pairing-code flow, and
   account-level rotation. Gate before any public exposure.
4. **Tier 2 blob.** WebDAV/S3/Drive adapter over the same protocol — the second backend behind the
   same interface built in phase 1.
5. **Later:** true per-device keypairs + device-management list (envelope already accommodates it);
   Tier 3 LAN P2P as a latency optimization; deeper tracker integration. (Reader-settings sync and
   activity-feed sync are out of scope — reader settings are local-only, activity is derived
   locally.)

## Open questions

None blocking. All major decisions are settled (below); the phase-0 spike is the next concrete step.

Resolved: **backends** — both Tier 1 and Tier 2 over one protocol, hub first; **library vs
hand-roll** — hand-roll the CRDT-lite core (phase-0 spike done, see `sync-eval/FINDINGS.md`); **reader settings** — local-only; **activity
feed** — derived locally, not synced; **key model** — two-level DEK hierarchy with account-level
rotation now, per-device keypairs deferred (envelope designed to accommodate them without a format
change); **progress ordering** — reuse the existing `chapter-order` logic for the monotonic merge,
inheriting its quirks; refine later only if a concrete ordering bug appears.
