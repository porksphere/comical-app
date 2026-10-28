/**
 * `nav-bar-scroll` — names the scroll view a screen's iOS navigation bar follows, so the bar can
 * be bare while the list is at the top and take its material once scrolled (`tab-stack`'s
 * scrolled material). UIKit finds that scroll view by itself only down a screen's first
 * subviews, which a feed with a backdrop in front of its list defeats; see `TabScrollMarker`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed): the bar
 * then keeps whichever appearance UIKit settles on by itself.
 */
import { requireOptionalNativeModule } from 'expo';

type NavBarScroll = {
  /** Hands the first scroll view under the view with this tag to the view controller owning it,
   *  as the scroll view its navigation bar reads its top edge from. False when there is none. */
  follow(viewTag: number): Promise<boolean>;
};

export default requireOptionalNativeModule<NavBarScroll>('NavBarScroll');
