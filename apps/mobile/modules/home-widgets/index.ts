/**
 * `home-widgets` — the app's side of its home-screen widgets (`targets/widgets`, iOS). A widget
 * is another process that can read only the App Group folder it shares with the app, so the app
 * leaves the feed there as a JSON file with its covers beside it and asks WidgetKit to redraw.
 * `data/home-widgets/publish.ts` is the one caller.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireOptionalNativeModule } from 'expo';

type HomeWidgets = {
  /** False when the build carries no App Group the app can open (a signer that dropped it). */
  isAvailable(): boolean;
  /** The cover files already stored. */
  covers(): Promise<string[]>;
  /** Copies the image at `uri` into the shared folder as `name`. */
  storeCover(name: string, uri: string): Promise<void>;
  /** Writes the feed, drops every stored cover not in `covers`, and reloads the widgets when the
   *  feed changed. Resolves to whether it had. */
  publish(snapshot: string, covers: string[]): Promise<boolean>;
};

export default requireOptionalNativeModule<HomeWidgets>('HomeWidgets');
