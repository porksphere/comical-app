#!/usr/bin/env bash
# Publishes the "ios-nightly" SideStore/AltStore source: one app (com.porksphere.comical) whose
# single version is whatever main last built. For following main on a device between tagged
# releases — a PROFILING build (Release + on-device Hermes profiler), like every build-ios.yml
# build. The clean public channel is ios-release.
#
# One version only: the Release keeps one IPA, so an older entry's downloadURL would serve the
# newer binary under the older version string, and AltStore rejects that mismatch.
#
# The Release is created once and its assets clobbered in place, like the other two iOS sources —
# a delete+recreate would 404 the source URL for anyone refreshing mid-publish. The body is
# rewritten LAST: it carries the `built-sha` marker rolling-changelog.sh measures the next night's
# notes from, so a publish that fails half way leaves the marker where the source still is.
#
# Usage: publish-ios-nightly-source.sh <path-to-ipa> <version> <commit>
# Requires gh + jq, GH_TOKEN (contents: write), GITHUB_REPOSITORY, and a full-history checkout.
set -euo pipefail

USAGE="usage: publish-ios-nightly-source.sh <path-to-ipa> <version> <commit>"
IPA="${1:?$USAGE}"
VERSION="${2:?$USAGE}"
COMMIT="${3:?$USAGE}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="ios-nightly"
IPA_NAME="comical-unsigned.ipa"
BASE="https://github.com/${REPO}/releases/download/${TAG}"
WORK="$(mktemp -d)"

[ -f "$IPA" ] || { echo "::error::IPA not found at $IPA"; exit 1; }

# Read before anything is written: the range is measured from the marker in the CURRENT body.
NOTES="$(bash .github/scripts/rolling-changelog.sh "$TAG")"
[ -n "$NOTES" ] || NOTES="• Routine build (${VERSION})"

cp "$IPA" "$WORK/$IPA_NAME"
cp apps/mobile/assets/images/icon.png "$WORK/icon.png"

# Legacy top-level fields mirror versions[0] for older clients; modern SideStore/AltStore read
# versions[]. jq does the escaping — commit subjects carry quotes, $ and backticks.
jq -n \
  --arg version "$VERSION" \
  --arg date "$(date -u +%Y-%m-%d)" \
  --arg notes "$NOTES" \
  --arg dl "${BASE}/${IPA_NAME}" \
  --argjson size "$(stat -c%s "$IPA")" \
  --arg icon "${BASE}/icon.png" \
  '{
    name: "Comical (nightly)",
    identifier: "com.porksphere.comical.source.nightly",
    apps: [{
      name: "Comical (nightly)",
      bundleIdentifier: "com.porksphere.comical",
      developerName: "porksphere",
      localizedDescription: "Comical nightly channel — whatever main last built (profiling: Release + on-device Hermes profiler). Unsigned; re-signed on-device by SideStore/AltStore. Same bundle id as the release app, so it installs over it; subscribe to the release source for the clean, profiler-free build.",
      iconURL: $icon,
      tintColor: "2E2E2E",
      versions: [{version: $version, date: $date, localizedDescription: $notes, downloadURL: $dl, size: $size}],
      version: $version,
      versionDate: $date,
      versionDescription: $notes,
      downloadURL: $dl,
      size: $size
    }]
  }' > "$WORK/apps.json"

BODY="Unsigned profiling IPA of \`main\` (${VERSION}), rebuilt nightly when main has moved.

**Install via source:** add this URL once in SideStore/AltStore → Sources → +
\`${BASE}/apps.json\`

**Or install the IPA directly:**
\`${BASE}/${IPA_NAME}\`

⚠️ Same bundle id as the release app — installing this replaces Comical on your device.

## What changed

${NOTES}

$(bash .github/scripts/rolling-changelog.sh stamp-line "$COMMIT")"

# A prerelease, so it never takes the repo's "Latest" badge from a tagged version.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$REPO" --target "$COMMIT" --prerelease \
    --title "Comical iOS — nightly source (main)" --notes "First publish in progress."
fi

gh release upload "$TAG" "$WORK/$IPA_NAME" "$WORK/apps.json" "$WORK/icon.png" --repo "$REPO" --clobber
# The tag follows the build, so the Release page names the commit its IPA came from.
gh api -X PATCH "repos/${REPO}/git/refs/tags/${TAG}" -f sha="$COMMIT" -F force=true >/dev/null
gh release edit "$TAG" --repo "$REPO" --notes "$BODY"

echo "Refreshed ${TAG} -> ${VERSION} (${COMMIT:0:7})."
