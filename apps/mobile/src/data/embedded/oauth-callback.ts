/**
 * The app's custom-scheme OAuth redirect base, used both at startup (threaded into host-rn's
 * `EmbeddedBootstrapConfig.oauthCallbackUrl`, see `startup.ts`) and by `setting-field.tsx`'s
 * on-device Connect flow (as `openAuthSessionAsync`'s redirect-detection prefix) — one computed
 * value, so the two sides can't drift apart.
 */
import * as Linking from 'expo-linking';

/** `comical://oauth-callback` on a native standalone/dev-client build (see `app.json`'s `scheme`). */
export const embeddedOAuthCallbackUrl = Linking.createURL('oauth-callback');
