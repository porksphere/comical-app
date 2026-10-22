/**
 * `web-cookies` — reads and clears the cookies the app's web views hold, for a bridge's in-app
 * sign-in (`web-login` settings). The web view's store keeps HttpOnly session cookies out of
 * `document.cookie`, so they can only be read from the native side.
 *
 * Null when the module isn't linked (web, or a build from before it existed): the sign-in falls
 * back to pasting cookies, and since `react-native-webview` arrived in the same build, a null here
 * also means there may be no web view to sign in with.
 */
import { requireOptionalNativeModule } from 'expo';

type WebCookies = {
  /** The cookies the web views would send to `url`, as a `Cookie` header: `"a=1; b=2"`. */
  getCookies(url: string): Promise<string>;
  /** Forget every cookie the web views hold for these URLs' sites. */
  clearCookies(urls: string[]): Promise<void>;
};

export default requireOptionalNativeModule<WebCookies>('WebCookies');
