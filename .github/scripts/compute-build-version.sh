#!/usr/bin/env bash
# The version string a build stamps into its binary — printed on stdout, nothing else.
#
# Two shapes, one per lane:
#   - release (a v* tag): the tag itself, passed in as $VERSION_INPUT. Printed verbatim.
#   - every rolling lane (ios-main, ios-pr, ios-devclient, android-main, …): `<base>.<N>`, where
#     `base` is app.json's `expo.version` and N counts THIS release series' builds — the commits
#     from the one that last moved `expo.version` up to HEAD, +1. So the first build after
#     `release: 0.2.0` is `0.2.0.1`, the next `0.2.0.2`, and cutting 0.3.0 starts over at
#     `0.3.0.1`.
#
# N used to be $GITHUB_RUN_NUMBER, which is the workflow's lifetime run counter: it never reset,
# so a release series that had just begun still shipped `0.2.0.4288`. The number said nothing
# about the build, and a fresh series inherited the previous one's arbitrary height.
#
# The reset is safe for updaters. `compareVersions` (src/data/use-app-update.ts) and AltStore both
# order these part-by-part, most significant first, so `0.2.0.1` still beats `0.1.1.4287` — the
# base moving up outranks the counter dropping. Within a series N only ever climbs, since commits
# are only ever added to main.
#
# The trade-off, for the PR lane only: two builds of the same PR at the same commit depth (a
# force-push/rebase that keeps the commit count) mint the same string, so SideStore may not see
# the rebuilt IPA as an update. Install it from the ios-pr-<N> release's direct IPA link when
# that bites. Keeping run numbers here instead would have been worse — PR builds would sit
# permanently above main's counter, and every dev who installed one would stop being offered
# main builds after the PR merged.
#
# Usage: compute-build-version.sh          (run from the repo root)
#   VERSION_INPUT  optional explicit version; when non-empty it's echoed and nothing else runs.
set -euo pipefail

APP_JSON="apps/mobile/app.json"

if [ -n "${VERSION_INPUT:-}" ]; then
  echo "$VERSION_INPUT"
  exit 0
fi

BASE="$(node -p "require('./${APP_JSON}').expo.version")"

# The walk below reads historical blobs, so a depth-1 checkout would silently mint `<base>.1` on
# every build. Fail loudly instead — the callers set fetch-depth: 0 for exactly this.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "::error::compute-build-version.sh needs full history (found a shallow clone). Set fetch-depth: 0 on the checkout." >&2
  exit 1
fi

# Walk the commits that touched app.json, newest first, past every one that already carried the
# current base; the last one still carrying it is the commit that introduced this version. (An
# empty read — the commit that first added app.json — ends the walk the same way a different
# version does.)
BUMP=""
while read -r sha; do
  [ -n "$sha" ] || continue
  version="$(git show "${sha}:${APP_JSON}" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).expo.version" 2>/dev/null || true)"
  [ "$version" = "$BASE" ] || break
  BUMP="$sha"
done < <(git log --format=%H -- "$APP_JSON")

if [ -n "$BUMP" ]; then
  COUNT="$(git rev-list --count "${BUMP}..HEAD")"
  echo "series base ${BASE} introduced by ${BUMP}, ${COUNT} commit(s) since" >&2
else
  # No commit touching app.json carries the current base — it's an uncommitted local edit, or the
  # file is untracked. Neither happens in CI; count the whole history so the number still moves.
  COUNT="$(git rev-list --count HEAD)"
  echo "::warning::No commit found introducing version ${BASE}; falling back to total commit count." >&2
fi

echo "${BASE}.$((COUNT + 1))"
