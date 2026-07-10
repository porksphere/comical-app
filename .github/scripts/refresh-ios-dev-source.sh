#!/usr/bin/env bash
# Regenerates the single stable "ios-dev" SideStore/AltStore source: one app
# (com.porksphere.comical) whose versions[] lists main's latest build at index 0
# — the canonical "latest"/update target, since AltStore uses ARRAY ORDER, not
# version-string comparison — followed by every open PR build, newest-first.
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

# main first (index 0). Prefix "00-" so the glob lists it ahead of PRs; the jq
# below re-sorts anyway, but keep the on-disk order deterministic.
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

# versions[]: main entry first, then PRs by descending sort key (run number).
VERSIONS="$(jq -s '
  (map(select(.channel == "main")))                              as $main
  | (map(select(.channel != "main")) | sort_by(.sort) | reverse) as $prs
  | ($main + $prs)
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
