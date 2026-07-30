/**
 * What THIS build is — the constants the About screen shows and any bug report needs: which
 * version, which CI lane produced it, which commit, and how its JS is being hosted.
 *
 * **Why the version can't just come from `Constants.expoConfig.version`.** `app.json`'s
 * `expo.version` is a *base* ("0.1.0") that only moves on a release; the real shipped version is
 * `<base>.<run number>` (or the git tag, for a release), computed inside the build workflow and
 * patched straight into the generated `Info.plist` — see build-ios-reusable.yml's "Compute full
 * version" / "Stamp full version" steps. The embedded Expo manifest that `Constants` reads is
 * generated from `app.json` *before* that patch, so it keeps saying "0.1.0" while the installed app
 * (and the AltStore/SideStore source manifest) says "0.1.0.142". The workflows therefore also bake
 * the computed string in as `EXPO_PUBLIC_COMICAL_APP_VERSION`, which is what we prefer here; the
 * manifest value is only the local-dev fallback.
 *
 * Everything `process.env.EXPO_PUBLIC_*` here is inlined by Expo at bundle time, so an unset var
 * folds to the fallback rather than being read at runtime.
 *
 * Deliberately build-time constants ONLY, with no imports beyond `expo-constants`/`react-native`:
 * `lib/sentry.ts` re-exports the channel from here, which puts this module on the app's startup
 * path. The device/OS probing the About screen pairs this with lives in that screen, so
 * `expo-device` (and its web UA parser) stays off startup.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { SENTRY_BUILD_CHANNEL } from './sentry';

/** Which CI build produced this binary (ios-main, android-release, web-docker, … or 'local-dev'
 *  outside CI). Defined in `lib/sentry.ts`, which tags every crash with it — see the note there for
 *  why that module, not this one, holds the definition. Re-exported through a local const rather
 *  than `export … from`, so `buildSummary()` below can read it. */
export const BUILD_CHANNEL = SENTRY_BUILD_CHANNEL;

/** The full shipped version string (see the header for why this isn't the manifest's version). */
export const APP_VERSION =
  process.env.EXPO_PUBLIC_COMICAL_APP_VERSION || Constants.expoConfig?.version || '0.0.0';

/** Short git SHA of the commit this bundle was built from; empty outside CI. Truncated here rather
 *  than in each workflow, so a lane that bakes the full `github.sha` (deploy-web.yml, where the
 *  value comes straight from an expression with no shell to cut it) still renders as a short SHA. */
export const BUILD_COMMIT = (process.env.EXPO_PUBLIC_COMICAL_BUILD_COMMIT || '').slice(0, 7);

/** ISO timestamp of the build; empty outside CI. */
export const BUILD_TIME = process.env.EXPO_PUBLIC_COMICAL_BUILD_TIME || '';

/** JS-side debug vs release. Orthogonal to the channel: an `ios-devclient` build is a release
 *  binary that loads DEBUG JS from Metro, and a local `expo run:ios --configuration Release` is a
 *  release bundle on the `local-dev` channel. */
export const BUILD_TYPE: 'debug' | 'release' = __DEV__ ? 'debug' : 'release';

/**
 * How this JS bundle is being hosted: 'metro' when it's served by a dev server (a dev client or
 * `expo start`), 'embedded' when it's the bundle baked into the binary, 'web' in a browser.
 *
 * `ExecutionEnvironment.StoreClient` covers both Expo Go and an `expo-dev-client` build, and this
 * app never runs in Expo Go (it needs `modules/comical-runtime`), so StoreClient here means "dev
 * client". `hostUri` is only set while a Metro server is in play, which is the actual distinction
 * worth showing — a dev-client shell pointed at Metro is the one build whose binary and JS can be
 * from completely different commits.
 */
export const BUNDLE_HOST: 'metro' | 'embedded' | 'web' =
  Platform.OS === 'web'
    ? 'web'
    : Constants.expoConfig?.hostUri || Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? 'metro'
      : 'embedded';

/** The engine running THIS bundle (the app's own JS) — not the engine bridges run in, which is the
 *  native module's (JavaScriptCore on iOS, QuickJS on Android; see `modules/comical-runtime`). */
export const JS_ENGINE: string =
  Platform.OS === 'web' ? 'Browser' : 'HermesInternal' in globalThis ? 'Hermes' : 'JavaScriptCore';

/** Expo SDK the bundle was built against, e.g. "56.0.0". */
export const EXPO_SDK_VERSION = Constants.expoConfig?.sdkVersion || '';

/** The web export's base path (`/comical-app`, or `/comical-app/branches/<slug>` for a PR/branch
 *  preview) — baked in by deploy-web.yml from the same value it patches into app.json's
 *  `experiments.baseUrl` before `expo export`. Only meaningful on the web-pages channel; empty
 *  everywhere else. Exists so the in-app update checker (`data/use-app-update.ts`) can build an
 *  absolute, route-independent URL for `version.json` — a plain relative fetch breaks once
 *  expo-router's client-side navigation has moved off the root path, and Expo's static web export
 *  emits no `<base href>` to fix that for us. */
export const WEB_BASE_URL = process.env.EXPO_PUBLIC_COMICAL_BASE_URL || '';

/** `BUILD_TIME` as a local date-time, or '' when it wasn't baked in. */
export function buildTimeLabel(): string {
  if (!BUILD_TIME) return '';
  const date = new Date(BUILD_TIME);
  return Number.isNaN(date.getTime()) ? BUILD_TIME : date.toLocaleString();
}

/** One-line summary of what kind of build this is, e.g. "release · ios-main" — the line that
 *  answers "is this a shipped build or a PR one?" without reading three separate rows. */
export function buildSummary(): string {
  return `${BUILD_TYPE} · ${BUILD_CHANNEL}`;
}
