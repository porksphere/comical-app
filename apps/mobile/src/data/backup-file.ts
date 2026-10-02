/**
 * Getting a library backup out of the app and back in, as a file the user keeps. The browser's
 * version of the same two functions is `backup-file.web.ts`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/** `shared`: handed to the share sheet, which doesn't report whether anything was done with it. */
export type SaveOutcome = 'saved' | 'shared' | 'cancelled';

const JSON_MIME = 'application/json';

// Both pickers reject on a dismissal instead of resolving with nothing.
const isCancel = (err: unknown) => /cancel/i.test(err instanceof Error ? err.message : String(err));

export async function saveBackupFile(name: string, json: string): Promise<SaveOutcome> {
  if (Platform.OS === 'android') {
    // Android's share sheet has no "save to a folder" of its own — it depends on which apps are
    // installed — so ask for the folder directly.
    let dir: Directory;
    try {
      dir = await Directory.pickDirectoryAsync();
    } catch (err) {
      if (isCancel(err)) return 'cancelled';
      throw err;
    }
    dir.createFile(name, JSON_MIME).write(json);
    return 'saved';
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: JSON_MIME, UTI: 'public.json' });
  return 'shared';
}

/** The picked file's text, or `null` when the picker was dismissed. */
export async function pickBackupFile(): Promise<string | null> {
  try {
    const picked = await File.pickFileAsync({ mimeTypes: [JSON_MIME, 'text/plain', 'application/octet-stream'] });
    return picked.canceled ? null : await picked.result.text();
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}
