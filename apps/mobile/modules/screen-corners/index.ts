/**
 * `screen-corners` — the radius of each corner of the app's window, in points, clockwise from the
 * top left: the display's own rounded corners where the window reaches them, and nothing where it
 * meets a hard edge (a folding phone's hinge side). The page curl gives a page that reaches into a
 * corner that corner's shape (`components/reader/viewport-corners.ts`).
 *
 * Null where the module isn't linked (web, a build from before it existed) or the system won't say:
 * the curl's pages then turn square.
 */
import { requireOptionalNativeModule } from 'expo';

type ScreenCorners = {
  windowCorners(): Promise<[number, number, number, number] | null>;
};

export default requireOptionalNativeModule<ScreenCorners>('ScreenCorners');
