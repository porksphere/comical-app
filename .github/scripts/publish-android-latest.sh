#!/usr/bin/env bash
# Republishes the rolling "android-latest" Release, whose single APK asset lives at a stable,
# public, unauthenticated download URL — the link the README points Android users at.
#
# Called by BOTH android build lanes, which is the point of it being a script:
#   - build-android.yml, on every push to main (the rolling build), and
#   - release.yml, on a v* tag, so cutting a release also moves the download link.
# Without the second caller a tagged release would sit in the Releases list while the README's
# Android button still served whatever main last built — Android has no equivalent of the iOS
# AltStore source that tracks tags, so this URL is the only thing users follow.
#
# The Release is deleted and recreated rather than edited: that's what keeps the asset URL
# byte-identical across builds (a second asset of the same name would otherwise be served as
# `comical-android.1.apk`). `--cleanup-tag` takes the lightweight tag with it.
#
# Usage: publish-android-latest.sh <path-to-apk> [version-label]
# Requires gh + GH_TOKEN and GITHUB_REPOSITORY in the environment.
set -euo pipefail

APK="${1:?usage: publish-android-latest.sh <path-to-apk> [version-label]}"
VERSION="${2:-}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="android-latest"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

[ -f "$APK" ] || { echo "::error::APK not found at $APK"; exit 1; }

# The version is only ever shown in the notes; a caller that doesn't know it (the rolling lane
# reads it from the build job) still gets a valid release.
TITLE="Comical Android (latest APK)"
[ -n "$VERSION" ] && TITLE="$TITLE — $VERSION"

gh release delete "$TAG" --repo "$REPO" --yes --cleanup-tag || true
gh release create "$TAG" \
  "$APK" \
  --repo "$REPO" \
  --title "$TITLE" \
  --notes "Installable release APK (debug-keystore signed).

**Install directly:**
\`${BASE}/comical-android.apk\`

On-device: enable \"Install unknown apps\" for your browser, open the link, install.

This link is rolling — it always serves the newest build, whether that came from a push to main or a
tagged release. Versioned, archival releases (with the iOS IPA too) are the \`vX.Y.Z\` entries in
[Releases](https://github.com/${REPO}/releases)."
