#!/usr/bin/env bash
# Republishes one of the two rolling Android channels, each a GitHub Release whose single APK asset
# lives at a stable, public, unauthenticated download URL:
#
#   android-release  the PUBLIC channel — the newest TAGGED release's APK. Refreshed only by
#                    release.yml. This is what the README's download button points at and what an
#                    `android-release` build's in-app update check follows.
#   android-latest   the ROLLING channel — whatever main last built. Refreshed only by
#                    build-android.yml. For dev/testing, the Android counterpart of ios-main.
#
# THE TWO USED TO BE ONE, and both lanes republished it. That had two consequences, both fixed by
# the split. A user on a tagged release was told "update available" the first time any commit
# landed on main, and the button handed them a main build — Android had no equivalent of the
# ios-release/ios-main separation that keeps iOS users on the channel they chose. And because the
# two lanes run in different concurrency groups (`android-*` vs `release-*`), merging a release
# bump and then dispatching the release had both of them delete-and-recreate the same Release at
# once: last writer wins, with a 404 window on the download URL in between. Different tags, no race.
#
# The Release is deleted and recreated rather than edited: that's what keeps the asset URL
# byte-identical across builds (a second asset of the same name would otherwise be served as
# `comical-android.1.apk`). `--cleanup-tag` takes the lightweight tag with it.
#
# Usage: publish-android-channel.sh <android-release|android-latest> <path-to-apk> [version] [commit]
# Requires gh + GH_TOKEN and GITHUB_REPOSITORY in the environment.
set -euo pipefail

TAG="${1:?usage: publish-android-channel.sh <channel> <path-to-apk> [version] [commit]}"
APK="${2:?usage: publish-android-channel.sh <channel> <path-to-apk> [version] [commit]}"
VERSION="${3:-}"
COMMIT="${4:-}"
COMMIT="${COMMIT:0:7}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

[ -f "$APK" ] || { echo "::error::APK not found at $APK"; exit 1; }

case "$TAG" in
  android-release)
    TITLE="Comical Android — release channel"
    LANE_NOTES="This link is rolling: it always serves the newest **tagged** release's APK. Every
version also stays permanently downloadable from its own \`vX.Y.Z\` entry in
[Releases](https://github.com/${REPO}/releases)."
    ;;
  android-latest)
    TITLE="Comical Android — main channel (rolling)"
    LANE_NOTES="This link is rolling: it always serves whatever **main** last built, which may be
ahead of the newest tagged release and is not a stable channel. For released builds use
\`${BASE%/*}/android-release/comical-android.apk\`."
    ;;
  *)
    echo "::error::unknown channel '$TAG' (expected android-release or android-latest)"; exit 1 ;;
esac

# The version is only ever shown in the notes; a caller that doesn't know it (the rolling lane
# reads it from the build job) still gets a valid release.
[ -n "$VERSION" ] && TITLE="$TITLE — $VERSION"

# version.json: what the in-app update checker (apps/mobile/src/data/use-app-update.ts) compares
# BUILD_COMMIT against to decide "there's a newer build on my channel than the one I'm running".
# Equality-only, not ordering — Android's versionName never moves per-build (see
# build-android-reusable.yml), so the commit is the only thing that changes between two APKs.
WORK="$(mktemp -d)"
jq -n --arg commit "$COMMIT" --arg version "$VERSION" --arg publishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{commit: $commit, version: $version, publishedAt: $publishedAt}' > "$WORK/version.json"

gh release delete "$TAG" --repo "$REPO" --yes --cleanup-tag || true
gh release create "$TAG" \
  "$APK" "$WORK/version.json" \
  --repo "$REPO" \
  --title "$TITLE" \
  --notes "Installable release APK (debug-keystore signed).

**Install directly:**
\`${BASE}/comical-android.apk\`

On-device: enable \"Install unknown apps\" for your browser, open the link, install.

${LANE_NOTES}"

echo "Refreshed ${TAG} -> ${VERSION:-unknown} (${COMMIT:-no commit})."
