/**
 * Whether a newer build exists than the one running, for the channels that ship an artifact a
 * user actually follows (ios-release, ios-nightly, android-release, desktop-release,
 * desktop-nightly, web-pages). Every other channel — the unpublished nightly, per-branch and dev
 * lanes (android-nightly, ios-pr, ios-devclient, android-pr, desktop-pr, *-e2e, local-dev) — is
 * `'unsupported'` and triggers no network request at all (`enabled: false` below).
 *
 * Per-channel check:
 *  - ios-release / ios-nightly: compare the channel's AltStore/SideStore source's
 *    `apps[0].version` against APP_VERSION via `compareVersions`. The source carries the same
 *    string the build baked into APP_VERSION — the git tag's `X.Y.Z` on ios-release, `X.Y.Z.<Nth
 *    build of that series>` on ios-nightly (build-ios-reusable.yml's "Compute full version").
 *  - android-release / desktop-release / desktop-nightly: compare `version.json`'s `commit`
 *    against BUILD_COMMIT, on the channel's Release. Commit equality, not version ordering: ANY
 *    mismatch means "there's a newer build", since the URL is always rebuilt from the channel's
 *    newest build. A desktop build that updates itself (the Windows installer, the AppImage) is
 *    told to fetch the update the moment this check finds one, and its button restarts into it;
 *    the rest open the Release page rather than one installer, since the user picks theirs by OS
 *    (`useAppUpdateAction`, `lib/desktop-shell.ts`).
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
import { openBrowserAsync } from 'expo-web-browser';
import { AppState, Platform } from 'react-native';

import { showToast } from '@/components/toast';
import { queryKeys } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import {
  type ChannelRead,
  type ChannelVersionJson,
  type IosSourceJson,
  type ReleaseNote,
  type UpdateStep,
  readChannelVersion,
  readIosSource,
  updateStep,
} from '@/data/release-notes';
import { APP_VERSION, BUILD_CHANNEL, BUILD_COMMIT, WEB_BASE_URL } from '@/lib/build-info';
import {
  desktopSelfUpdates,
  desktopShell,
  downloadDesktopUpdate,
  installDesktopUpdate,
  useDesktopUpdate,
} from '@/lib/desktop-shell';

export { compareVersions, type ReleaseNote } from '@/data/release-notes';

export type AppUpdateStatus = 'checking' | 'up-to-date' | 'update-available' | 'unsupported' | 'error';

export type AppUpdateCheck = {
  status: AppUpdateStatus;
  /** The newer version/commit label to show next to "Update available" — undefined when there's
   *  nothing to show (up-to-date/unsupported/error) or the channel doesn't carry one. */
  latestVersionLabel?: string;
  /** Where the Update button should send the user. Undefined on web-pages — that row's action is
   *  `window.location.reload()`, not a URL. Desktop is web too, so callers test this, not the
   *  platform. */
  downloadUrl?: string;
  /** Versions newer than the running build, newest first — what "What's new" offers. Only
   *  ios-release can hold more than one: its source lists every tag, while the rolling channels
   *  keep a single current build. */
  pending?: ReleaseNote[];
  /** The RUNNING build's own entry, when its channel still lists it. This is the "what did the
   *  version I'm on bring" half, and it is why the check is worth running on an up-to-date app at
   *  all — on the rolling channels it is present exactly when there's no update. */
  running?: ReleaseNote;
};

const IOS_RELEASE_APPS_JSON_URL = 'https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json';
/** Whatever main last built (.github/scripts/publish-ios-nightly-source.sh). Its own URL, so a
 *  release user is never offered a nightly. */
const IOS_NIGHTLY_APPS_JSON_URL = 'https://github.com/porksphere/comical-app/releases/download/ios-nightly/apps.json';
/** Build channel → the Release its update check reads. `android-release` carries the newest TAGGED
 *  build, refreshed only by release.yml; see .github/scripts/publish-android-channel.sh. */
const ANDROID_CHANNEL_TAG: Record<string, string> = {
  'android-release': 'android-release',
};
const channelVersionJsonUrl = (tag: string) =>
  `https://github.com/porksphere/comical-app/releases/download/${tag}/version.json`;
const androidApkUrl = (tag: string) =>
  `https://github.com/porksphere/comical-app/releases/download/${tag}/comical-android.apk`;
/** The desktop channels, each its own Release under its own name — so a release user is never
 *  offered a nightly (.github/scripts/publish-desktop-channel.sh, publish-desktop-nightly.sh). */
const DESKTOP_CHANNELS = ['desktop-release', 'desktop-nightly'];
const releasePageUrl = (tag: string) => `https://github.com/porksphere/comical-app/releases/tag/${tag}`;

/** Derived, not re-listed: the Android entries come from the map above, so adding a channel there
 *  can't leave this Set behind. A channel that's "supported" here but unrouted in
 *  `fetchAppUpdateCheck` would fetch nothing and sit on 'checking' forever. */
const SUPPORTED_CHANNELS = new Set([
  'ios-release',
  'ios-nightly',
  ...Object.keys(ANDROID_CHANNEL_TAG),
  ...DESKTOP_CHANNELS,
  'web-pages',
]);

/** Identifies the binary doing the checking, so its verdict can't be inherited by the build that
 *  replaces it — see `queryKeys.appUpdateCheck`, which this is the second half of. */
const RUNNING_BUILD_ID = `${APP_VERSION}+${BUILD_COMMIT}`;

function isSupportedChannel(channel: string): boolean {
  return SUPPORTED_CHANNELS.has(channel);
}

/** Both iOS channels publish the same AltStore/SideStore manifest shape, differing only in which
 *  Release hosts it and how the version string is minted — so one reader serves both, given its
 *  channel's source URL. */
async function checkIosSource(url: string, signal?: AbortSignal): Promise<AppUpdateCheck> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`apps.json fetch failed: ${res.status}`);
  return toCheck(readIosSource((await res.json()) as IosSourceJson, APP_VERSION));
}

async function checkChannelRelease(tag: string, downloadUrl: string, signal?: AbortSignal): Promise<AppUpdateCheck> {
  const json = await fetchReleaseJson(channelVersionJsonUrl(tag), signal);
  return toCheck(readChannelVersion(json as ChannelVersionJson, BUILD_COMMIT, downloadUrl));
}

/** Through the desktop shell where there is one: a Release asset carries no CORS headers, so a
 *  page — which is what the desktop app is — has its own fetch of one refused. Native has no such
 *  policy to fail. */
async function fetchReleaseJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const viaShell = desktopShell()?.releaseJson;
  if (viaShell) return viaShell(url);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`version.json fetch failed: ${res.status}`);
  return res.json();
}

async function checkWebPages(signal?: AbortSignal): Promise<AppUpdateCheck> {
  const res = await fetch(`${WEB_BASE_URL}/version.json`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`version.json fetch failed: ${res.status}`);
  // No downloadUrl — the row's action is a reload onto whatever the server is already serving.
  return toCheck(readChannelVersion((await res.json()) as ChannelVersionJson, BUILD_COMMIT));
}

/** The one place a manifest read becomes a status. `pending` is dropped when it's empty so the
 *  cached object stays the shape the UI checks (`update.pending ?? []`) rather than carrying an
 *  array that means the same as absent. */
function toCheck(read: ChannelRead): AppUpdateCheck {
  if (!read.newer) return { status: 'up-to-date', running: read.running };
  return {
    status: 'update-available',
    latestVersionLabel: read.latestVersionLabel,
    downloadUrl: read.downloadUrl,
    pending: read.pending.length ? read.pending : undefined,
    running: read.running,
  };
}

async function fetchAppUpdateCheck(signal?: AbortSignal): Promise<AppUpdateCheck> {
  if (BUILD_CHANNEL === 'ios-release') return checkIosSource(IOS_RELEASE_APPS_JSON_URL, signal);
  if (BUILD_CHANNEL === 'ios-nightly') return checkIosSource(IOS_NIGHTLY_APPS_JSON_URL, signal);
  const androidTag = ANDROID_CHANNEL_TAG[BUILD_CHANNEL];
  if (androidTag) return checkChannelRelease(androidTag, androidApkUrl(androidTag), signal);
  if (DESKTOP_CHANNELS.includes(BUILD_CHANNEL)) {
    const check = await checkChannelRelease(BUILD_CHANNEL, releasePageUrl(BUILD_CHANNEL), signal);
    if (check.status === 'update-available') downloadDesktopUpdate();
    return check;
  }
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

/** The Update button, for the two screens that have one: which step this build is at, the version
 *  it concerns, and what a press does — nothing while a download is under way. Null with no update. */
export type AppUpdateAction = { step: UpdateStep; version?: string; run?: () => void };

export function useAppUpdateAction(): AppUpdateAction | null {
  const check = useAppUpdateCheck();
  const shell = useDesktopUpdate();
  const { downloadUrl, latestVersionLabel: version } = check;
  const step = updateStep({
    available: check.status === 'update-available',
    hasDownloadUrl: !!downloadUrl,
    selfUpdates: desktopSelfUpdates(),
    shellPhase: shell.phase,
  });
  switch (step) {
    case null:
      return null;
    case 'restart':
      return { step, version: shell.version ?? version, run: installDesktopUpdate };
    case 'downloading':
      return { step, version };
    case 'fetch':
      return { step, version, run: downloadDesktopUpdate };
    case 'open':
      return { step, version, run: () => void (downloadUrl && openBrowserAsync(downloadUrl)) };
    case 'reload':
      return { step, version, run: () => void (Platform.OS === 'web' && window.location.reload()) };
  }
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
