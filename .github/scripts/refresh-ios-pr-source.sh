#!/usr/bin/env bash
# Regenerates the single stable "ios-pr" SideStore/AltStore source: one app
# (com.porksphere.comical) whose versions[] lists every OPEN PR build, ordered
# newest-first by run number. SideStore/AltStore pick the installable "latest"
# by ARRAY ORDER (not version-string comparison), so whatever you built most
# recently sits at versions[0] and installs with one tap — no digging into
# version history to find your branch.
#
# main is NOT in this aggregate — it has its own standalone ios-main source. This
# source is purely the open-PR fan-out. Every build listed here is a PROFILING
# build (Release + on-device Hermes profiler), same as ios-main.
#
# Rebuilt from scratch on every run by enumerating the ios-pr-* releases and
# reading the meta.json fragment each publish leaves on its release, so it is
# stateless and race-tolerant (the caller job is also concurrency-locked as a
# backstop). Add the source once; branches appear/disappear inside it as PRs
# open/close. Requires gh + jq (present on ubuntu runners) and a checkout of the
# repo (for the icon). Same bundle id as the release app => a dev build replaces
# Comical on device; pick a version to switch.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="ios-pr"
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

# Every open PR. cleanup-pr normally deletes a PR's ios-pr-<N> release on close,
# but that races with publish-pr: an in-flight build from a push made just before
# the merge can recreate ios-pr-<N> *after* cleanup-pr deleted it, leaving a
# merged PR squatting at the top of the source. So don't trust the release's mere
# existence — check each PR's actual state and include only OPEN ones. Any release
# whose PR is closed/merged (or gone) is orphaned: exclude it and delete it so the
# source self-heals without hand-pruning.
#
# NOTE: the grep matches `ios-pr-<N>` (trailing dash) so the `ios-pr` source
# release itself (this script's own output) is never enumerated as a PR.
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  num="${rel#ios-pr-}"
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
           | grep '^ios-pr-' || true)

shopt -s nullglob
meta_files=("$METAS"/*.json)
if [ ${#meta_files[@]} -eq 0 ]; then
  # No open PRs => nothing to list. Publish an empty-versions source rather than
  # leaving a stale one pointing at a since-deleted PR IPA.
  echo "No open-PR build metadata found; publishing an empty ios-pr source."
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
  --argjson versions "$VERSIONS" \
  '{
    name: "Comical (PR builds)",
    identifier: "com.porksphere.comical.source.pr",
    apps: [({
      name: "Comical (PR)",
      bundleIdentifier: "com.porksphere.comical",
      developerName: "porksphere",
      localizedDescription: "Comical PR channel — every open PR build (profiling: Release + on-device Hermes profiler). Unsigned; re-signed on-device by SideStore/AltStore. Same bundle id as the release app, so a PR build replaces Comical; pick a version to switch.",
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
    --title "Comical iOS — PR source (every open PR build)" \
    --notes "Single SideStore/AltStore source listing every open PR build (profiling).

Add this URL once in SideStore/AltStore → Sources → +
\`${BASE}/apps.json\`

Then pick a PR's version and install. Same bundle id as the release app, so a PR
build replaces Comical on your device — reinstall main or a tagged release to switch back."
fi

gh release upload "$TAG" "$WORK/apps.json" "$WORK/icon.png" --repo "$REPO" --clobber

echo "Refreshed $TAG source with $(jq 'length' <<<"$VERSIONS") version(s)."
