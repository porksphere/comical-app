#!/usr/bin/env bash
# Regenerates the public "ios-release" SideStore/AltStore source: one app
# (com.porksphere.comical) whose versions[] lists every tagged release
# (v*), newest-first, each pointing at that tag's PERMANENT IPA asset.
#
# This is the clean, PROFILER-FREE, public channel a normal user subscribes to
# (the profiling ios-main / ios-pr sources are for dev/perf testing). Because
# each vX.Y.Z Release is immutable and keeps its own IPA forever, this source can
# list the FULL version history and every entry stays installable — unlike the
# rolling ios-main/ios-pr sources, which keep only one IPA.
#
# Rebuilt from scratch on every tag by enumerating the v* Releases — stateless,
# so deleting a bad release drops it on the next run. Requires gh + jq (present
# on ubuntu runners) and a checkout of the repo (for the icon). Run AFTER the
# new tag's Release + IPA asset exist so the download URLs resolve.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TAG="ios-release"
IPA_NAME="comical-unsigned.ipa"
WORK="$(mktemp -d)"
ENTRIES="$WORK/entries"
mkdir -p "$ENTRIES"

# Enumerate every version-tag Release (v1.2.3, v0.0.1, …). The `^v[0-9]` filter
# excludes the rolling channel tags (ios-main, ios-pr, ios-devclient,
# android-release, android-latest, and this script's own ios-release output).
while IFS= read -r rel; do
  [ -n "$rel" ] || continue

  # Per-release metadata: creation time (for ordering), title, and the IPA
  # asset's size (AltStore wants a real byte size). Skip any tag missing the IPA.
  meta="$(gh release view "$rel" --repo "$REPO" \
            --json createdAt,name,assets 2>/dev/null || true)"
  [ -n "$meta" ] || { echo "skip $rel: no release metadata"; continue; }

  size="$(jq -r --arg n "$IPA_NAME" \
            '.assets[] | select(.name == $n) | .size' <<<"$meta" | head -n1)"
  [ -n "$size" ] && [ "$size" != "null" ] || { echo "skip $rel: no $IPA_NAME asset"; continue; }

  createdAt="$(jq -r '.createdAt' <<<"$meta")"
  name="$(jq -r '.name // empty' <<<"$meta")"
  version="${rel#v}"
  date="${createdAt%%T*}"
  dl="https://github.com/${REPO}/releases/download/${rel}/${IPA_NAME}"

  # What SideStore/AltStore shows under the version: the CHANGELOG section for it, so the public
  # channel says what CHANGED rather than restating its own title. CHANGELOG.md carries every
  # version's section, so one read of the working tree annotates the whole back catalogue — no
  # checkout per tag. Releases cut before the changelog existed have no section; those keep the
  # release title, which is what this field used to be for all of them.
  notes="$(bash .github/scripts/changelog-section.sh "$version" || true)"
  desc="${notes:-${name:-Comical $rel}}"

  jq -n \
    --arg version "$version" \
    --arg date "$date" \
    --arg createdAt "$createdAt" \
    --arg desc "$desc" \
    --arg dl "$dl" \
    --argjson size "$size" \
    '{version: $version, date: $date, createdAt: $createdAt,
      localizedDescription: $desc, downloadURL: $dl, size: $size}' \
    > "$ENTRIES/${rel}.json"
done < <(gh release list --repo "$REPO" --limit 200 --json tagName -q '.[].tagName' \
           | grep -E '^v[0-9]' || true)

shopt -s nullglob
entry_files=("$ENTRIES"/*.json)
if [ ${#entry_files[@]} -eq 0 ]; then
  echo "No tagged releases with an $IPA_NAME asset found; leaving $TAG untouched."
  exit 0
fi

# versions[]: every tag newest-first by creation time. SideStore/AltStore treat
# versions[0] as the headline installable version (by ARRAY ORDER), so the most
# recently published tag installs with one tap; older tags stay selectable and
# their permanent IPAs still download.
#
# The app's own update check reads this same array (data/use-app-update.ts): entries newer than the
# running build are the "what's new" it offers, and the entry MATCHING the running build is how
# Settings can show what the installed version brought. That second use is why the full history
# stays here even though only versions[0] is installable-with-one-tap.
VERSIONS="$(jq -s '
  sort_by(.createdAt) | reverse
  | map({version, date, localizedDescription, downloadURL, size})
' "${entry_files[@]}")"

BASE="https://github.com/${REPO}/releases/download/${TAG}"
cp apps/mobile/assets/images/icon.png "$WORK/icon.png"

# Legacy top-level fields mirror versions[0] for older clients; modern
# SideStore/AltStore read versions[].
jq -n \
  --arg icon "${BASE}/icon.png" \
  --argjson versions "$VERSIONS" \
  '{
    name: "Comical",
    identifier: "com.porksphere.comical.source",
    apps: [{
      name: "Comical",
      bundleIdentifier: "com.porksphere.comical",
      developerName: "porksphere",
      localizedDescription: "Comical — cross-platform comic reader. The public release channel: every tagged version, newest first. Unsigned build; re-signed on-device by SideStore/AltStore with your free Apple ID.",
      iconURL: $icon,
      tintColor: "2E2E2E",
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
    --title "Comical iOS — release source (all tagged versions)" \
    --notes "The public SideStore/AltStore source: every tagged Comical release, newest first.

Add this URL once in SideStore/AltStore → Sources → +
\`${BASE}/apps.json\`

Clean release builds (no profiler). Unsigned; re-signed on-device with your free Apple ID."
fi

gh release upload "$TAG" "$WORK/apps.json" "$WORK/icon.png" --repo "$REPO" --clobber

echo "Refreshed $TAG source with $(jq 'length' <<<"$VERSIONS") version(s)."
