#!/usr/bin/env bash
# Prints the commit subjects a ROLLING channel has picked up since it last published — the notes
# for ios-main, android-latest and any other lane whose "version" is just whatever its branch last
# built. Tagged lanes have a CHANGELOG section to quote instead; see changelog-section.sh.
#
# The previous build's commit comes from a `built-sha: <40 hex>` marker in the channel Release's
# body, which `stamp-line` below emits for the publisher to append. That marker is the whole state:
# nothing is stored between runs, and a channel that has never published (or whose marker no longer
# describes an ancestor of HEAD, after a rebase or a re-run on the same commit) falls back to the
# most recent commits rather than claiming a range it can't compute.
#
# Usage: rolling-changelog.sh <channel-tag> [format]
#        rolling-changelog.sh stamp-line <sha>
#
# `format` is a git --pretty format (default '• %s', which is what the SideStore sources show).
# Requires gh + jq and a checkout with history; GITHUB_REPOSITORY must be set.
set -euo pipefail

# How many commits to list when there's no previous marker to measure from. A first publish would
# otherwise dump the repo's entire history into a patch-notes field.
FALLBACK_COMMITS=20

if [ "${1:-}" = "stamp-line" ]; then
  # The marker, emitted here so its exact spelling lives next to the regex that reads it.
  printf '<!-- built-sha: %s -->\n' "${2:?usage: rolling-changelog.sh stamp-line <sha>}"
  exit 0
fi

TAG="${1:?usage: rolling-changelog.sh <channel-tag> [format]}"
FORMAT="${2:-• %s}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
HEAD_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"

PREV_SHA="$(gh release view "$TAG" --repo "$REPO" --json body -q .body 2>/dev/null \
  | sed -n 's/.*built-sha: \([0-9a-f]\{40\}\).*/\1/p' | head -n1 || true)"

if [ -n "$PREV_SHA" ] && [ "$PREV_SHA" != "$HEAD_SHA" ] \
   && git merge-base --is-ancestor "$PREV_SHA" HEAD 2>/dev/null; then
  git log "${PREV_SHA}..HEAD" --no-merges --pretty=format:"$FORMAT"
else
  git log -n "$FALLBACK_COMMITS" --no-merges --pretty=format:"$FORMAT" HEAD
fi
