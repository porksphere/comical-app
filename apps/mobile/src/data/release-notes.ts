/**
 * Reading a publishing channel's manifest: what version it offers, and what each version changed.
 *
 * Split out of `use-app-update.ts` so it can be tested — that module pulls in `build-info`, and so
 * react-native, which the test runner can't load. Everything here is pure: the running version and
 * commit are arguments, not imports, which is also what lets one test drive every channel shape.
 *
 * The manifests are minted by CI and documented where they're written:
 *   - iOS — an AltStore/SideStore source, `.github/scripts/refresh-ios-release-source.sh`
 *     (ios-release, every tag) and `build-ios.yml`'s publish job (ios-main, the current build).
 *   - Android/web — a flat `version.json`, `.github/scripts/publish-android-channel.sh` and
 *     `deploy-web.yml`.
 * The notes inside them come from `changelog-section.sh` on a tagged lane and
 * `rolling-changelog.sh` on a rolling one.
 */

/** One version's changes, as the publishing lane wrote them: a CHANGELOG section for a tagged
 *  release, the commits since the last publish for a rolling channel. `body` is plain text, one
 *  change per line — the two lanes bullet it differently ("- " vs "• "), which `noteLines` strips
 *  rather than the publishers being made to agree. */
export type ReleaseNote = { version: string; date?: string; body: string };

/** What a manifest says, before it's turned into an `AppUpdateCheck`. */
export type ChannelRead = {
  newer: boolean;
  latestVersionLabel?: string;
  downloadUrl?: string;
  /** Versions newer than the running build, newest first. Only an ios-release source can hold more
   *  than one: it lists every tag, while the rolling channels keep a single current build. */
  pending: ReleaseNote[];
  /** The RUNNING build's own entry, when its channel still lists it. */
  running?: ReleaseNote;
};

export type IosSourceJson = {
  apps?: {
    version?: string;
    downloadURL?: string;
    versions?: { version?: string; date?: string; localizedDescription?: string }[];
  }[];
};

export type ChannelVersionJson = { commit?: string; version?: string; notes?: string };

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

/** Drop an entry with nothing to say. An empty body is normal — a release cut before the publishers
 *  carried notes, or a rolling lane whose fallback found no commits — and listing a version under a
 *  blank space is worse than not listing it. */
function toNote(version: string | undefined, body: string | undefined, date?: string): ReleaseNote | undefined {
  const text = (body ?? '').trim();
  return version && text ? { version, date, body: text } : undefined;
}

export function readIosSource(json: IosSourceJson, runningVersion: string): ChannelRead {
  const app = json.apps?.[0];
  // `versions[]` is the whole history on ios-release and a single entry on ios-main. Both are
  // ordered newest-first by their publisher, but the split is made on the running version rather
  // than by trusting that order.
  const all = app?.versions ?? [];
  const pending = all
    .filter((v) => v.version && compareVersions(v.version, runningVersion) > 0)
    .map((v) => toNote(v.version, v.localizedDescription, v.date))
    .filter((n): n is ReleaseNote => !!n);
  const mine = all.find((v) => v.version && compareVersions(v.version, runningVersion) === 0);
  const running = toNote(mine?.version, mine?.localizedDescription, mine?.date);

  // The legacy TOP-LEVEL fields, not versions[0], still decide whether an update exists — they are
  // what every published source has carried from the start, so the verdict can't regress on a
  // manifest written before `versions[]` did.
  if (!app?.version || !app.downloadURL || compareVersions(app.version, runningVersion) <= 0) {
    return { newer: false, pending: [], running };
  }
  return { newer: true, latestVersionLabel: app.version, downloadUrl: app.downloadURL, pending, running };
}

/** The rolling channels' shared shape: one `version.json` describing the channel's current build,
 *  which is the update when its commit differs from ours and the running build's own notes when it
 *  doesn't. `downloadUrl` is the caller's — web reloads rather than downloading. */
export function readChannelVersion(
  json: ChannelVersionJson,
  runningCommit: string,
  downloadUrl?: string,
): ChannelRead {
  const note = toNote(json.version, json.notes);
  // No commit either side means "can't tell", which is reported as up to date: an update prompt
  // that can't say what it's offering is worse than a missed one.
  if (!json.commit || !runningCommit || json.commit === runningCommit) {
    return { newer: false, pending: [], running: note };
  }
  return {
    newer: true,
    latestVersionLabel: json.version,
    downloadUrl,
    pending: note ? [note] : [],
  };
}

/** Split a note body into display lines, dropping the publisher's own bullet glyph — the two lanes
 *  spell it differently ("- " from CHANGELOG.md, "• " from the git log format) and the screen draws
 *  its own. Nothing else about the text is touched: it is the published release note, and a screen
 *  that quietly rewrites what a release said is worse than one that shows a stray "(#131)". */
export function noteLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^[-•*]\s+/, ''))
    .filter(Boolean);
}
