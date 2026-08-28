#!/usr/bin/env bash
# Regenerates a single stable SideStore/AltStore source aggregating every OPEN PR's build: one app
# (com.porksphere.comical) whose versions[] lists them all, ordered newest-first by run number.
# SideStore/AltStore pick the installable "latest" by ARRAY ORDER (not version-string comparison),
# so whatever you built most recently sits at versions[0] and installs with one tap — no digging
# into version history to find your branch.
#
# TWO CHANNELS, selected by the first argument (default `pr`):
#
#   pr           build-ios.yml's per-PR PROFILING build (Release + on-device Hermes profiler).
#                Releases ios-pr-<N> -> source ios-pr.
#   devclient-pr build-ios-devclient.yml's per-PR DEV-CLIENT shell (Debug + expo-dev-client,
#                loads JS from your Metro server). Releases ios-devclient-pr-<N> -> source
#                ios-devclient-pr.
#
# They are separate sources rather than one, because both carry the SAME bundle id
# (com.porksphere.comical — see plugins/with-devclient-variant.js): listed together they would be
# two entries named "PR #123" that silently replace each other on install, and no field in the
# manifest distinguishes them to the user. Add whichever one you want; adding both is fine too.
#
# main is NOT in either aggregate — it has its own standalone ios-main source.
#
# Rebuilt from scratch on every run by enumerating the channel's per-PR releases and reading the
# meta.json fragment each publish leaves on its release, so it is stateless and race-tolerant (the
# caller job is also concurrency-locked as a backstop). Add the source once; branches
# appear/disappear inside it as PRs open/close. Requires gh + jq (present on ubuntu runners) and a
# checkout of the repo (for the icon). Same bundle id as the release app => a dev build replaces
# Comical on device; pick a version to switch.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

# Per-channel identity. Only presentation lives here — the download URL and size of each build
# come from the meta.json fragment its publish job left on the per-PR release.
case "${1:-pr}" in
  pr)
    TAG="ios-pr"
    SOURCE_NAME="Comical (PR builds)"
    SOURCE_ID="com.porksphere.comical.source.pr"
    APP_NAME="Comical (PR)"
    APP_DESC="Comical PR channel — every open PR build (profiling: Release + on-device Hermes profiler). Unsigned; re-signed on-device by SideStore/AltStore. Same bundle id as the release app, so a PR build replaces Comical; pick a version to switch."
    TITLE="Comical iOS — PR source (every open PR build)"
    KIND_NOTE="profiling"
    ;;
  devclient-pr)
    TAG="ios-devclient-pr"
    SOURCE_NAME="Comical (PR dev-clients)"
    SOURCE_ID="com.porksphere.comical.source.devclient.pr"
    APP_NAME="Comical (PR dev)"
    APP_DESC="Comical PR dev-client channel — every open PR's development-client shell (Debug + expo-dev-client). It ships NO JS: run \`bun run dev:device\` and connect from the launcher, so you iterate over Metro against the PR's native code. Unsigned; re-signed on-device by SideStore/AltStore. Same bundle id as the release app, so it replaces Comical; pick a version to switch."
    TITLE="Comical iOS — PR dev-client source (every open PR shell)"
    KIND_NOTE="dev-client"
    ;;
  *)
    echo "unknown channel '${1}' (expected: pr | devclient-pr)" >&2
    exit 2
    ;;
esac
PREFIX="${TAG}-"

WORK="$(mktemp -d)"
METAS="$WORK/metas"
mkdir -p "$METAS"

# Copy the meta.json fragment off a release into $METAS/<out>, if it has one.
fetch_meta() {
  local rel="$1" out="$2"
  if gh release download "$rel" --repo "$REPO" -p meta.json -D "$WORK/dl/$rel" 2>/dev/null; then
    cp "$WORK/dl/$rel/meta.json" "$METAS/$out"
  fi
}

# Every open PR. cleanup-pr normally deletes a PR's per-PR release on close, but
# that races with publish-pr: an in-flight build from a push made just before the
# merge can recreate it *after* cleanup-pr deleted it, leaving a merged PR
# squatting at the top of the source. So don't trust the release's mere
# existence — check each PR's actual state and include only OPEN ones. Any release
# whose PR is closed/merged (or gone) is orphaned: exclude it and delete it so the
# source self-heals without hand-pruning.
#
# NOTE: the grep matches `<TAG>-<N>` (trailing dash) so the `<TAG>` source release itself (this
# script's own output) is never enumerated as a PR. The two channels' prefixes don't overlap
# either: `ios-devclient-pr-12` does not start with `ios-pr-`.
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  num="${rel#"$PREFIX"}"
  state="$(gh pr view "$num" --repo "$REPO" --json state -q .state 2>/dev/null || true)"
  case "$state" in
    OPEN)
      fetch_meta "$rel" "pr-${num}.json" || true
      ;;
    MERGED|CLOSED)
      # Confirmed dead: exclude from the source and delete the orphaned release.
      echo "PR #${num} is ${state} — excluding and deleting orphaned release ${rel}."
      gh release delete "$rel" --repo "$REPO" --yes --cleanup-tag 2>/dev/null || true
      ;;
    *)
      # Indeterminate (gh pr view errored: permissions, rate limit, transient).
      # Fail SAFE — never delete on uncertainty: keep and include the release, and
      # let a later refresh correct it once the PR state resolves. This is the
      # important guard: an empty state must NOT be treated as "closed", or a
      # single API hiccup would wipe every open PR's release.
      echo "PR #${num}: indeterminate state ('${state}') — keeping release ${rel} (fail-safe)."
      fetch_meta "$rel" "pr-${num}.json" || true
      ;;
  esac
done < <(gh release list --repo "$REPO" --limit 200 --json tagName -q '.[].tagName' \
           | grep "^${PREFIX}" || true)

shopt -s nullglob
meta_files=("$METAS"/*.json)
if [ ${#meta_files[@]} -eq 0 ]; then
  # No open PRs => nothing to list. Publish an empty-versions source rather than
  # leaving a stale one pointing at a since-deleted PR IPA.
  echo "No open-PR build metadata found; publishing an empty ${TAG} source."
fi

# versions[]: every open PR build, newest-first by run number. SideStore/AltStore
# treat versions[0] as the headline installable version (by ARRAY ORDER, not
# version-string comparison), so the most recently built PR lands on top and
# installs with one tap.
if [ ${#meta_files[@]} -gt 0 ]; then
  VERSIONS="$(jq -s '
    sort_by(.sort) | reverse
    | map({version, date, localizedDescription, downloadURL, size})
  ' "${meta_files[@]}")"
else
  VERSIONS='[]'
fi

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cp apps/mobile/assets/images/icon.png "$WORK/icon.png"

# Legacy top-level fields mirror versions[0] for older clients; modern
# SideStore/AltStore read versions[]. When there are no open PRs the top-level
# fields are omitted (empty versions[]).
jq -n \
  --arg icon "${BASE}/icon.png" \
  --arg sourceName "$SOURCE_NAME" \
  --arg sourceId "$SOURCE_ID" \
  --arg appName "$APP_NAME" \
  --arg appDesc "$APP_DESC" \
  --argjson versions "$VERSIONS" \
  '{
    name: $sourceName,
    identifier: $sourceId,
    apps: [({
      name: $appName,
      bundleIdentifier: "com.porksphere.comical",
      developerName: "porksphere",
      localizedDescription: $appDesc,
      iconURL: $icon,
      tintColor: "2E2E2E",
      versions: $versions
    } + (if ($versions | length) > 0 then {
      version: ($versions[0].version),
      versionDate: ($versions[0].date),
      versionDescription: ($versions[0].localizedDescription),
      downloadURL: ($versions[0].downloadURL),
      size: ($versions[0].size)
    } else {} end))]
  }' > "$WORK/apps.json"

# Ensure the stable release exists (create once), then clobber its assets in
# place — avoids the 404 window a delete+recreate would open on the source URL.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" \
    --repo "$REPO" \
    --title "$TITLE" \
    --notes "Single SideStore/AltStore source listing every open PR build (${KIND_NOTE}).

Add this URL once in SideStore/AltStore → Sources → +
\`${BASE}/apps.json\`

Then pick a PR's version and install. Same bundle id as the release app, so a PR
build replaces Comical on your device — reinstall main or a tagged release to switch back."
fi

gh release upload "$TAG" "$WORK/apps.json" "$WORK/icon.png" --repo "$REPO" --clobber

echo "Refreshed $TAG source with $(jq 'length' <<<"$VERSIONS") version(s)."
