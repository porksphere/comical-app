/**
 * Keeps the home-screen widgets' feed current (iOS; `modules/home-widgets` is null elsewhere).
 *
 * The widgets can read nothing of the app's but the folder they share with it, so the feed is
 * written there whenever it may have moved while the widgets could be seen: as the app is left
 * (reading reorders History, and marks Activity rows read), and after a background chapter check
 * (`activity/background.ts`). A widget is never on screen while the app is, so nothing writes
 * while it is in use.
 */
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { AppState } from 'react-native';

import homeWidgets from '../../../modules/home-widgets';
import { resolveAssetSourceCached } from '../api';
import { knownBridges } from '../known-bridges';
import { isMockActive } from '../mock';
import { hidesNsfwDurably } from '../nsfw';
import { getRealDataSource } from '../source';
import { activityRows, coverFileName, historyRows, toWidgetItem, type WidgetRow } from './feed';

/** A stored cover's size in pixels: a book's shape, enough for the largest a widget draws one. A
 *  widget's pictures count against the little memory its process gets. */
const COVER_WIDTH = 400;
const COVER_HEIGHT = 600;
/** How long one publish waits on covers. A cover that takes longer is stored when it arrives and
 *  joins the next publish; the row goes out without it rather than hold up a background window. */
const COVER_BUDGET_MS = 4000;

let running: Promise<void> | null = null;
let queued = false;

/** Write the feed and reload the widgets if it changed. Never rejects: a feed that can't be read
 *  (offline, a server away) leaves the last one written in place. */
export function publishHomeWidgets(): Promise<void> {
  if (!homeWidgets?.isAvailable() || isMockActive()) return Promise.resolve();
  if (running) {
    queued = true;
    return running;
  }
  running = publish()
    .catch(() => {})
    .finally(() => {
      running = null;
      if (queued) {
        queued = false;
        void publishHomeWidgets();
      }
    });
  return running;
}

let installed = false;

/** Publish each time the app is left. Called once from the root layout. */
export function installHomeWidgets(): void {
  if (installed || !homeWidgets) return;
  installed = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background') void publishHomeWidgets();
  });
}

async function publish(): Promise<void> {
  const ds = getRealDataSource();
  const [history, activity, bridges, missing, hideNsfw] = await Promise.all([
    ds.getHistory(),
    ds.getActivity(),
    ds.getBridges(),
    ds.getMissingBridges(),
    hidesNsfwDurably(),
  ]);
  const known = knownBridges(bridges, missing);
  const rows = {
    history: historyRows(history, known, hideNsfw),
    activity: activityRows(activity, known, hideNsfw),
  };
  const stored = await storeCovers([...rows.history, ...rows.activity]);
  const snapshot = {
    history: rows.history.map((row) => toWidgetItem(row, stored)),
    activity: rows.activity.map((row) => toWidgetItem(row, stored)),
  };
  await homeWidgets!.publish(JSON.stringify(snapshot), [...stored.values()]);
}

/** Store the covers not stored yet, and answer with the file of each one that is. */
async function storeCovers(rows: WidgetRow[]): Promise<Map<string, string>> {
  const existing = new Set(await homeWidgets!.covers());
  const stored = new Map<string, string>();
  const pending: Promise<void>[] = [];
  for (const row of rows) {
    const url = row.thumbnailUrl;
    if (!url || stored.has(url)) continue;
    const name = coverFileName(url);
    if (existing.has(name)) {
      stored.set(url, name);
      continue;
    }
    existing.add(name);
    pending.push(
      renderCover(url)
        .then((uri) => homeWidgets!.storeCover(name, uri))
        .then(() => void stored.set(url, name))
        .catch(() => {}),
    );
  }
  await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, COVER_BUDGET_MS))]);
  return new Map(stored);
}

/** The cover as a JPEG file, cropped about its centre to a book's shape. */
async function renderCover(url: string): Promise<string> {
  // Whole, never with a max size: see `lib/menu-thumb-files.ts`.
  const loaded = await Image.loadAsync(await resolveAssetSourceCached(url, { background: true }));
  try {
    const { width, height } = loaded;
    const cropWidth = Math.min(width, Math.round((height * COVER_WIDTH) / COVER_HEIGHT));
    const cropHeight = Math.min(height, Math.round((width * COVER_HEIGHT) / COVER_WIDTH));
    const cover = await ImageManipulator.manipulate(loaded)
      .crop({
        originX: Math.floor((width - cropWidth) / 2),
        originY: Math.floor((height - cropHeight) / 2),
        width: cropWidth,
        height: cropHeight,
      })
      .resize({ width: Math.min(COVER_WIDTH, cropWidth) })
      .renderAsync();
    try {
      return (await cover.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })).uri;
    } finally {
      cover.release();
    }
  } finally {
    loaded.release();
  }
}
