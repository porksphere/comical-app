#!/usr/bin/env bash
# Publishes the `desktop-nightly` channel: a GitHub Release carrying whatever main last built — the
# Windows installer, the AppImage and the .deb — at stable, public download URLs. For following
# main on a desktop between tagged releases. The channel normal users follow is desktop-release.
#
# The version.json beside the installers is what a desktop-nightly build's in-app update check
# reads (apps/mobile/src/data/use-app-update.ts): commit equality, with the commits picked up since
# the last nightly as its notes. The electron-builder feeds are NOT published: the app's own
# updater follows desktop-release only (apps/desktop/src/updater.ts), so a nightly updates by
# downloading the next installer from this Release.
#
# The Release is created once and its assets clobbered in place, like the ios-nightly source. The
# installers go up first and the body last: version.json is what announces a build, and the body
# carries the `built-sha` marker rolling-changelog.sh measures the next night's notes from, so a
# publish that fails half way announces nothing it hasn't uploaded.
#
# Usage: publish-desktop-nightly.sh <dir> <version> <commit>
#   <dir> holds the installers under their fixed names (collect-desktop-installers.sh).
# Requires gh + jq, GH_TOKEN (contents: write), GITHUB_REPOSITORY, and a full-history checkout.
set -euo pipefail

USAGE="usage: publish-desktop-nightly.sh <dir> <version> <commit>"
DIR="${1:?$USAGE}"
VERSION="${2:?$USAGE}"
FULL_COMMIT="${3:?$USAGE}"
COMMIT="${FULL_COMMIT:0:7}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="desktop-nightly"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

INSTALLER="$DIR/comical-desktop-setup.exe"
APPIMAGE="$DIR/comical-desktop-x86_64.AppImage"
DEB="$DIR/comical-desktop-amd64.deb"
for f in "$INSTALLER" "$APPIMAGE" "$DEB"; do
  [ -f "$f" ] || { echo "::error::$f not found — run collect-desktop-installers.sh first"; exit 1; }
done

# Read before anything is written: the range is measured from the marker in the CURRENT body.
NOTES="$(bash .github/scripts/rolling-changelog.sh "$TAG")"
[ -n "$NOTES" ] || NOTES="• Routine build (${VERSION})"

WORK="$(mktemp -d)"
jq -n --arg commit "$COMMIT" --arg version "$VERSION" --arg notes "$NOTES" \
  --arg publishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{commit: $commit, version: $version, notes: $notes, publishedAt: $publishedAt}' > "$WORK/version.json"

BODY="Installers of \`main\` (${VERSION}), rebuilt nightly when main has moved.

**Windows:** \`${BASE}/comical-desktop-setup.exe\`
**Linux (AppImage):** \`${BASE}/comical-desktop-x86_64.AppImage\` — \`chmod +x\` and run.
**Linux (Debian/Ubuntu):** \`${BASE}/comical-desktop-amd64.deb\`

⚠️ Neither is code-signed. Windows SmartScreen warns on first run (**More info → Run anyway**).
On Linux, if the AppImage exits with a libfuse error, either install \`libfuse2\` or run it with
\`--appimage-extract-and-run\`.

A nightly doesn't update itself: Settings → About says when a newer one is here. The installers
of the newest **tagged** release are on the \`desktop-release\` entry in
[Releases](https://github.com/${REPO}/releases).

## What changed

${NOTES}

$(bash .github/scripts/rolling-changelog.sh stamp-line "$FULL_COMMIT")"

# A prerelease, so it never takes the repo's "Latest" badge from a tagged version.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$REPO" --target "$FULL_COMMIT" --prerelease \
    --title "Comical Desktop — nightly (main)" --notes "First publish in progress."
fi

gh release upload "$TAG" "$INSTALLER" "$APPIMAGE" "$DEB" --repo "$REPO" --clobber
gh release upload "$TAG" "$WORK/version.json" --repo "$REPO" --clobber
# The tag follows the build, so the Release page names the commit its installers came from.
gh api -X PATCH "repos/${REPO}/git/refs/tags/${TAG}" -f sha="$FULL_COMMIT" -F force=true >/dev/null
gh release edit "$TAG" --repo "$REPO" --notes "$BODY"

echo "Refreshed ${TAG} -> ${VERSION} (${COMMIT})."
