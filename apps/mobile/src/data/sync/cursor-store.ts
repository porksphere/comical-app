/**
 * AsyncStorage-backed `CursorStore` — persists this device's pull cursor across app restarts, so a
 * sync round only pulls what's new since last time. One key per sync backend (a device may sync to
 * more than one), namespaced like the other embedded stores. Mirrors the AsyncStorage pattern in
 * embedded/settings-store.ts.
 *
 * Not exercised by the sync unit tests (they use engine.ts's in-memory `MemoryCursor`), since this
 * file imports the React Native AsyncStorage module; it's thin glue over the same proven pattern.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CursorStore } from '@comical/sync';

export function asyncStorageCursor(backendId: string): CursorStore {
  const key = `comical:sync:cursor:${backendId}`;
  return {
    async get() {
      return AsyncStorage.getItem(key);
    },
    async set(cursor: string) {
      await AsyncStorage.setItem(key, cursor);
    },
  };
}
