#!/usr/bin/env bash
# Regenerates the single stable "ios-dev" SideStore/AltStore source: one app
# (com.porksphere.comical) whose versions[] lists main + every open PR build,
# ordered newest-first by run number. SideStore/AltStore pick the installable
# "latest" by ARRAY ORDER (not version-string comparison), so whatever you built
# most recently sits at versions[0] and installs with one tap — no digging into
# version history to find your branch.
#
# Rebuilt from scratch on every run by enumerating the ios-latest + ios-pr-*
# releases and reading the meta.json fragment each publish leaves on its release,
# so it is stateless and race-tolerant (the caller job is also concurrency-locked
# as a backstop). Add the source once; branches appear/disappear inside it as
# PRs open/close. Requires gh + jq (present on ubuntu runners) and a checkout of
# the repo (for the icon). Same bundle id as the release app => a dev build
# replaces Comical on device; pick a version to switch.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="ios-dev"
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

# main's build (the jq below sorts everything by run number, so on-disk order
# doesn't matter — the "00-" prefix is just for readable listings).
fetch_meta "ios-latest" "00-main.json" || true

# every open PR (its release is deleted on close, so this is the live set)
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  fetch_meta "$rel" "pr-${rel#ios-pr-}.json" || true
done < <(gh release list --repo "$REPO" --limit 200 --json tagName -q '.[].tagName' \
           | grep '^ios-pr-' || true)

shopt -s nullglob
meta_files=("$METAS"/*.json)
if [ ${#meta_files[@]} -eq 0 ]; then
  echo "No build metadata found on any release; leaving $TAG untouched."
  exit 0
fi

# versions[]: ALL builds (main + every open PR) newest-first by run number.
# SideStore/AltStore treat versions[0] as the headline installable version (by
# ARRAY ORDER, not version-string comparison), so the most recently built thing
# — whichever branch/main you just pushed — lands on top and installs with one
# tap. (This is a dev-only source; the public ios-latest source stays main-only.)
VERSIONS="$(jq -s '
  sort_by(.sort) | reverse
  | map({version, date, localizedDescription, downloadURL, size})
' "${meta_files[@]}")"

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cp apps/mobile/assets/images/icon.png "$WORK/icon.png"

# Legacy top-level fields mirror versions[0] for older clients; modern
# SideStore/AltStore read versions[].
jq -n \
  --arg icon "${BASE}/icon.png" \
  --argjson versions "$VERSIONS" \
  '{
    name: "Comical (dev / branch builds)",
    identifier: "com.porksphere.comical.source.dev",
    apps: [{
      name: "Comical (dev)",
      bundleIdentifier: "com.porksphere.comical",
      developerName: "porksphere",
      localizedDescription: "Comical dev channel — main plus every open PR build. Unsigned; re-signed on-device by SideStore/AltStore. Same bundle id as the release app, so a dev build replaces Comical; pick a version to switch.",
      iconURL: $icon,
      tintColor: "208AEF",
      versions: $versions,
      version: ($versions[0].version),
      versionDate: ($versions[0].date),
      versionDescription: ($versions[0].localizedDescription),
      downloadURL: ($versions[0].downloadURL),
      size: ($versions[0].size)
    }]
  }' > "$WORK/apps.json"

# Ensure the stable release exists (create once), then clobber its assets in
# place — avoids the 404 window a delete+recreate would open on the source URL.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" \
    --repo "$REPO" \
    --title "Comical iOS — dev source (main + PR builds)" \
    --notes "Single SideStore/AltStore source listing main plus every open PR build.

Add this URL once in SideStore/AltStore → Sources → +
\`${BASE}/apps.json\`

Then pick a version — **main is the top entry** — and install. Same bundle id as
the release app, so a dev build replaces Comical on your device."
fi

gh release upload "$TAG" "$WORK/apps.json" "$WORK/icon.png" --repo "$REPO" --clobber

echo "Refreshed $TAG source with $(jq 'length' <<<"$VERSIONS") version(s)."
