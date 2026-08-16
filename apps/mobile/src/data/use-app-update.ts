/**
 * Whether a newer build exists than the one running, for the channels that ship a rolling or
 * tagged artifact a user actually follows (ios-release, ios-main, android-release/android-main,
 * web-pages). Every other channel — the per-branch/dev lanes (ios-pr, ios-devclient, android-pr,
 * *-e2e, local-dev) — is `'unsupported'` and triggers no network request at all (`enabled: false`
 * below).
 *
 * Per-channel check:
 *  - ios-release / ios-main: compare the channel's AltStore/SideStore source's `apps[0].version`
 *    against APP_VERSION via `compareVersions`. Both sources carry the same string the build baked
 *    into APP_VERSION — see build-ios-reusable.yml's "Compute full version", whose two branches
 *    give ios-release a plain `X.Y.Z` (the git tag) and ios-main a `X.Y.Z.<Nth build of that
 *    release series>`. Each channel only ever compares against its own source, so the two formats
 *    never meet; `compareVersions` handles the extra part either way.
 *  - android-release / android-main: compare `version.json`'s `commit` against BUILD_COMMIT, on the
 *    build's OWN channel Release — `android-release` (newest tag) or `android-latest` (tip of
 *    main). Commit equality, not version ordering: the counter in APP_VERSION restarts at .1 each
 *    release series, so two APKs' versions can legitimately compare in either direction. ANY
 *    mismatch means "there's a newer build", since each URL is always rebuilt from its lane's head.
 *  - web-pages: same commit-equality check, against a `version.json` written into `dist/` by
 *    deploy-web.yml, fetched with `cache: 'no-store'` so a stale CDN/browser cache can't mask it.
 *
 * Two ways to consume this:
 *  - `useAppUpdateCheck()` — a plain cache read (About screen row, `useSettingsBadgeCount` rollup).
 *  - `installAppUpdateAutoCheck()` — called once from app/_layout.tsx (mirrors
 *    `activity/auto-check.ts`'s `installActivityAutoCheck`): actually PERFORMS the check on launch
 *    and on every foreground return (throttled), populating the same query-cache entry the hook
 *    reads, and fires the one-time "update available" toast. Without this, the check would only
 *    ever run while the About screen itself is mounted — the tab pip and toast need it running
 *    app-wide.
 */
import { useQuery } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { showToast } from '@/components/toast';
import { queryKeys } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import { APP_VERSION, BUILD_CHANNEL, BUILD_COMMIT, WEB_BASE_URL } from '@/lib/build-info';

export type AppUpdateStatus = 'checking' | 'up-to-date' | 'update-available' | 'unsupported' | 'error';

export type AppUpdateCheck = {
  status: AppUpdateStatus;
  /** The newer version/commit label to show next to "Update available" — undefined when there's
   *  nothing to show (up-to-date/unsupported/error) or the channel doesn't carry one. */
  latestVersionLabel?: string;
  /** Where the Update button should send the user. Undefined on web-pages — that row's action is
   *  `window.location.reload()`, not a URL. */
  downloadUrl?: string;
};

const IOS_RELEASE_APPS_JSON_URL = 'https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json';
/** The rolling main source (build-ios.yml's `publish` job). Same manifest shape as ios-release's,
 *  but it lists only the one current build — the rolling Release keeps a single IPA. */
const IOS_MAIN_APPS_JSON_URL = 'https://github.com/porksphere/comical-app/releases/download/ios-main/apps.json';
/** The two rolling Android channels, each its own Release — `android-release` carries the newest
 *  TAGGED build (refreshed only by release.yml), `android-latest` whatever main last built
 *  (refreshed only by build-android.yml). A build checks the channel it was built on and no other,
 *  which is what stops a release user being offered a main build; see
 *  .github/scripts/publish-android-channel.sh. */
const ANDROID_CHANNEL_TAG: Record<string, string> = {
  'android-release': 'android-release',
  'android-main': 'android-latest',
};
const androidVersionJsonUrl = (tag: string) =>
  `https://github.com/porksphere/comical-app/releases/download/${tag}/version.json`;
const androidApkUrl = (tag: string) =>
  `https://github.com/porksphere/comical-app/releases/download/${tag}/comical-android.apk`;

const SUPPORTED_CHANNELS = new Set(['ios-release', 'ios-main', 'android-release', 'android-main', 'web-pages']);

/** Identifies the binary doing the checking, so its verdict can't be inherited by the build that
 *  replaces it — see `queryKeys.appUpdateCheck`, which this is the second half of. */
const RUNNING_BUILD_ID = `${APP_VERSION}+${BUILD_COMMIT}`;

function isSupportedChannel(channel: string): boolean {
  return SUPPORTED_CHANNELS.has(channel);
}

/** Numeric part-by-part compare of `MAJOR.MINOR.PATCH[.N]` strings (missing parts treated as 0),
 *  positive when `a` is newer than `b`. Not general semver — doesn't need to be: every version this
 *  compares is minted by CI as numeric parts only, never a pre-release suffix — a `vX.Y.Z` tag on
 *  ios-release, `X.Y.Z.<series build number>` on ios-main. The optional 4th part is why the shorter
 *  side's missing parts count as 0: that's what makes a tag and the main builds derived from it
 *  order correctly, though in practice the two never meet (each channel compares only against its
 *  own source). Most-significant-part-first is also what makes the counter safe to restart at .1
 *  on a release: the base moving up outranks the counter dropping, so 0.2.0.1 > 0.1.1.4287. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Both iOS channels publish the same AltStore/SideStore manifest shape, differing only in which
 *  Release hosts it and how the version string is minted — so one reader serves both, given its
 *  channel's source URL. `apps[0]`'s legacy top-level `version`/`downloadURL` (which both
 *  publishers emit alongside `versions[]`) is the headline build on either source. */
async function checkIosSource(url: string, signal?: AbortSignal): Promise<AppUpdateCheck> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`apps.json fetch failed: ${res.status}`);
  const json = (await res.json()) as { apps?: { version?: string; downloadURL?: string }[] };
  const latest = json.apps?.[0];
  if (!latest?.version || !latest.downloadURL || compareVersions(latest.version, APP_VERSION) <= 0) {
    return { status: 'up-to-date' };
  }
  return { status: 'update-available', latestVersionLabel: latest.version, downloadUrl: latest.downloadURL };
}

async function checkAndroidChannel(tag: string, signal?: AbortSignal): Promise<AppUpdateCheck> {
  const res = await fetch(androidVersionJsonUrl(tag), { signal });
  if (!res.ok) throw new Error(`version.json fetch failed: ${res.status}`);
  const json = (await res.json()) as { commit?: string; version?: string };
  if (!json.commit || !BUILD_COMMIT || json.commit === BUILD_COMMIT) return { status: 'up-to-date' };
  return { status: 'update-available', latestVersionLabel: json.version, downloadUrl: androidApkUrl(tag) };
}

async function checkWebPages(signal?: AbortSignal): Promise<AppUpdateCheck> {
  const res = await fetch(`${WEB_BASE_URL}/version.json`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`version.json fetch failed: ${res.status}`);
  const json = (await res.json()) as { commit?: string };
  if (!json.commit || !BUILD_COMMIT || json.commit === BUILD_COMMIT) return { status: 'up-to-date' };
  return { status: 'update-available' }; // no downloadUrl — the row's action is a reload
}

async function fetchAppUpdateCheck(signal?: AbortSignal): Promise<AppUpdateCheck> {
  if (BUILD_CHANNEL === 'ios-release') return checkIosSource(IOS_RELEASE_APPS_JSON_URL, signal);
  if (BUILD_CHANNEL === 'ios-main') return checkIosSource(IOS_MAIN_APPS_JSON_URL, signal);
  const androidTag = ANDROID_CHANNEL_TAG[BUILD_CHANNEL];
  if (androidTag) return checkAndroidChannel(androidTag, signal);
  if (BUILD_CHANNEL === 'web-pages') return checkWebPages(signal);
  return { status: 'unsupported' };
}

/** How long a check result is trusted before a remount refetches — deliberately much longer than
 *  the app's default 5-min staleTime: new builds ship far less often than content changes. Actual
 *  freshness comes from `installAppUpdateAutoCheck`'s foreground trigger below, not from this. */
const APP_UPDATE_STALE_TIME_MS = 30 * 60 * 1000;

/** Read-only: the current cached result. Never fetches on its own for unsupported channels
 *  (`enabled: false`) — no check for those, full stop, even if this hook is mounted on an
 *  internal/dev build. */
export function useAppUpdateCheck(): AppUpdateCheck {
  const supported = isSupportedChannel(BUILD_CHANNEL);
  const { data, isError } = useQuery({
    queryKey: queryKeys.appUpdateCheck(BUILD_CHANNEL, RUNNING_BUILD_ID),
    queryFn: ({ signal }) => fetchAppUpdateCheck(signal),
    enabled: supported,
    staleTime: APP_UPDATE_STALE_TIME_MS,
  });
  if (!supported) return { status: 'unsupported' };
  if (data) return data;
  return { status: isError ? 'error' : 'checking' };
}

// ─── App-wide launch + foreground trigger (mirrors activity/auto-check.ts) ───────────────────────

const LAUNCH_DELAY_MS = 8000; // after activity auto-check's own 5s delay — don't contend for the transport on cold start
const THROTTLE_MS = 60 * 60 * 1000; // 1h — session-scoped (not persisted): a relaunch re-checking once is fine

let installed = false;
let lastCheckedAt = 0;
/** The version/commit key already toasted this app session — reset naturally on cold start since
 *  it's a plain module var. Keyed off the detected version/commit, not a boolean, so a second
 *  distinct update appearing later in the same long-lived session still gets its own toast. */
let toastedKey: string | null = null;

/** Wire the launch + foreground triggers. Called once from the root layout (all platforms) —
 *  see app/_layout.tsx. */
export function installAppUpdateAutoCheck(): void {
  if (installed) return;
  installed = true;
  if (!isSupportedChannel(BUILD_CHANNEL)) return; // no timer at all on internal/dev builds
  setTimeout(() => void run(), LAUNCH_DELAY_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void run();
  });
}

async function run(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckedAt < THROTTLE_MS) return;
  lastCheckedAt = now;
  try {
    // Same query key `useAppUpdateCheck` reads — populates its cache, so every mounted consumer
    // (About row, tab pip) updates reactively with no extra fetch of their own.
    const result = await queryClient.fetchQuery({
      queryKey: queryKeys.appUpdateCheck(BUILD_CHANNEL, RUNNING_BUILD_ID),
      queryFn: ({ signal }) => fetchAppUpdateCheck(signal),
      staleTime: APP_UPDATE_STALE_TIME_MS,
    });
    if (result.status !== 'update-available') return;
    const key = result.latestVersionLabel ?? result.downloadUrl ?? 'update';
    if (toastedKey === key) return;
    toastedKey = key;
    showToast('Update available — see Settings');
  } catch {
    // Best-effort: offline / GitHub unreachable is a normal state, never surface an error.
  }
}
