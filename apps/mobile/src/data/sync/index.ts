/**
 * Cross-device sync — the app's half.
 *
 * The contract and the merge itself now live in **`@comical/sync`** (in the comical monorepo),
 * because the hub has to compute exactly the same merge these replicas do; re-exported here so call
 * sites have one import. What lives in *this* folder is the client machinery built on top: the
 * replica and its outbox, the sync engine, the store bridges that project records in and out of the
 * real library/embedded stores, the crypto seam, and the app-facing controller.
 *
 * The server half is `@comical/host-server`'s `/sync` routes — see README.md.
 */
export {
  ALL_TABLES,
  Clock,
  compare,
  comparePacked,
  compositeId,
  DEVICE_LOCAL_KEYS,
  isLive,
  MemoryBackend,
  MemoryCursor,
  mergeEnvelope,
  pack,
  Replica,
  splitCompositeId,
  SyncEngine,
  TABLE_STRATEGY,
  unpack,
  type CursorStore,
  type Envelope,
  type Hlc,
  type Progress,
  type PullResult,
  type Register,
  type SetElement,
  type Strategy,
  type StoreBridge,
  type SyncBackend,
  type SyncRecord,
  type SyncStats,
  type TableId,
} from '@comical/sync';
export { plaintextBox, encryptedBackend, type CryptoBox, type BlobBackend } from './crypto';
