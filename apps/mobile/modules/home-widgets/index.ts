/**
 * `home-widgets` — the app's side of its home-screen widgets (`targets/widgets` on iOS, this
 * module's `android/` on Android). A widget reads none of the app's state, only a folder the app
 * can write to (iOS: the App Group it shares with the widget extension; Android: its own files),
 * so the app leaves the feed there as a JSON file with its covers beside it and asks the system
 * to redraw. `data/home-widgets/publish.ts` is the one caller, and `docs/WIDGETS.md` says what
 * each function owes it.
 *
 * Null where the module isn't linked (web, a build from before it existed).
 */
import { requireOptionalNativeModule } from 'expo';

type HomeWidgets = {
  /** False when the build carries no App Group the app can open (iOS, a signer that dropped it). */
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
