/**
 * Durable on-disk store for captured library-entry cover bytes — the device `BlobStore` behind the
 * embedded router's guaranteed-offline covers (`/library/entries/:b/:s/cover`). Mirrors the
 * downloads blob store (`data/downloads/blob-store.ts`) but rooted separately (covers live and die
 * with library entries, not downloads) and WITH `read`: the reused router serves cover bytes back
 * through the in-process transport, so `<Image>` can render them via `resolveAssetSource`'s
 * data-URI path with the source unreachable.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { BlobStore } from '@comical/downloads';

const ROOT = 'comical-covers';

function fileFor(relPath: string): File {
  return new File(Paths.document, ROOT, ...relPath.split('/'));
}

export const expoCoversBlobStore: BlobStore = {
  async write(relPath, data) {
    const file = fileFor(relPath);
    const dir = file.parentDirectory;
    if (!dir.exists) dir.create({ intermediates: true });
    if (file.exists) file.delete();
    file.write(data);
    return { bytes: file.size ?? data.byteLength };
  },
  async read(relPath) {
    try {
      const file = fileFor(relPath);
      if (!file.exists) return undefined;
      return await file.bytes();
    } catch {
      return undefined;
    }
  },
  async remove(relPaths) {
    for (const relPath of relPaths) {
      try {
        const file = fileFor(relPath);
        if (file.exists) file.delete();
      } catch {
        // best-effort — an orphaned cover blob is harmless
      }
    }
  },
  async removeAll() {
    try {
      const dir = new Directory(Paths.document, ROOT);
      if (dir.exists) dir.delete();
    } catch {
      // best-effort
    }
  },
};
