#!/usr/bin/env bash
# Republishes the `desktop-release` channel: a GitHub Release carrying the newest TAGGED release's
# installers at stable, public, unauthenticated download URLs. This is what the README's desktop
# links point at. Refreshed only by release.yml; every version also stays downloadable from its own
# vX.Y.Z Release.
#
# Same shape as publish-android-channel.sh — delete-and-recreate so the asset URLs stay
# byte-identical, plus a version.json carrying the commit and the CHANGELOG section, which a
# desktop-release build's in-app update check (apps/mobile/src/data/use-app-update.ts) reads. The
# electron-builder feeds (latest.yml, latest-linux.yml) ride along: they are what the app's own
# updater (apps/desktop/src/updater.ts) downloads the new installer by.
#
# Usage: publish-desktop-channel.sh <dir> <version> <commit>
#   <dir> holds the installers under their fixed names (collect-desktop-installers.sh).
# Requires gh + jq, GH_TOKEN and GITHUB_REPOSITORY in the environment.
set -euo pipefail

DIR="${1:?usage: publish-desktop-channel.sh <dir> <version> <commit>}"
VERSION="${2:?usage: publish-desktop-channel.sh <dir> <version> <commit>}"
FULL_COMMIT="${3:?usage: publish-desktop-channel.sh <dir> <version> <commit>}"
COMMIT="${FULL_COMMIT:0:7}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="desktop-release"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

INSTALLER="$DIR/comical-desktop-setup.exe"
APPIMAGE="$DIR/comical-desktop-x86_64.AppImage"
DEB="$DIR/comical-desktop-amd64.deb"
FEEDS=("$DIR/latest.yml" "$DIR/latest-linux.yml")
for f in "$INSTALLER" "$APPIMAGE" "$DEB" "${FEEDS[@]}"; do
  [ -f "$f" ] || { echo "::error::$f not found — run collect-desktop-installers.sh first"; exit 1; }
done

NOTES="$(bash .github/scripts/changelog-section.sh "${VERSION#v}" || true)"

WORK="$(mktemp -d)"
jq -n --arg commit "$COMMIT" --arg version "$VERSION" --arg notes "$NOTES" \
  --arg publishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{commit: $commit, version: $version, notes: $notes, publishedAt: $publishedAt}' > "$WORK/version.json"

# Built here rather than inline in the body below: bash parses the word of a `${var:+…}`
# expansion, so an apostrophe in the heading would open a quote inside the release notes string.
WHATS_NEW=""
[ -n "$NOTES" ] && WHATS_NEW="
## What changed

${NOTES}
"

gh release delete "$TAG" --repo "$REPO" --yes --cleanup-tag || true
gh release create "$TAG" \
  "$INSTALLER" "$APPIMAGE" "$DEB" "${FEEDS[@]}" "$WORK/version.json" \
  --repo "$REPO" \
  --target "$FULL_COMMIT" \
  --title "Comical Desktop — release channel — $VERSION" \
  --notes "Installers for the newest tagged release.

**Windows:** \`${BASE}/comical-desktop-setup.exe\`
**Linux (AppImage):** \`${BASE}/comical-desktop-x86_64.AppImage\` — \`chmod +x\` and run.
**Linux (Debian/Ubuntu):** \`${BASE}/comical-desktop-amd64.deb\`

⚠️ Neither is code-signed. Windows SmartScreen warns on first run (**More info → Run anyway**).
On Linux, if the AppImage exits with a libfuse error, either install \`libfuse2\` or run it with
\`--appimage-extract-and-run\`.

This link is rolling: it always serves the newest **tagged** release's installers. Every version
also stays permanently downloadable from its own \`vX.Y.Z\` entry in
[Releases](https://github.com/${REPO}/releases).
${WHATS_NEW}"

echo "Refreshed ${TAG} -> ${VERSION} (${COMMIT})."
