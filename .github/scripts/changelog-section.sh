#!/usr/bin/env bash
# Prints the CHANGELOG.md entries for one released version — the bullet list under its
# `## X.Y.Z — DATE` heading, with the heading and surrounding blanks stripped.
#
# This is the notes source for everything TAGGED: the ios-release SideStore source (every version
# it lists) and the android-release channel. Rolling lanes have no release to look up and use
# rolling-changelog.sh instead.
#
# CHANGELOG.md is read from the working tree, which for the release lanes is the release commit —
# and it carries EVERY version's section, not just the newest, which is what lets
# refresh-ios-release-source.sh annotate the whole back catalogue in one pass without checking out
# each tag.
#
# Prints nothing (exit 0) for a version with no section: the callers all have a fallback, and a
# missing section is normal for anything released before this existed.
#
# Usage: changelog-section.sh <version> [changelog-path]
set -euo pipefail

VERSION="${1:?usage: changelog-section.sh <version> [changelog-path]}"
CHANGELOG="${2:-CHANGELOG.md}"

[ -f "$CHANGELOG" ] || exit 0

# Match the heading by its version FIELD, not a prefix: `## 0.2.1 — …` must not be found by a
# search for `## 0.2`, and `awk` index-matching would do exactly that.
# Blank lines are buffered rather than printed, and flushed only when another non-blank line turns
# up — which trims the section's leading and trailing blanks (both of which the generator emits)
# without losing the ones between paragraphs.
awk -v want="$VERSION" '
  # `## <version> — <date>`; $2 is the version however the dash and date are spelled.
  /^## / { inside = ($2 == want); next }
  !inside { next }
  /^$/ { if (seen) pending++; next }
  { while (pending-- > 0) print ""; pending = 0; seen = 1; print }
' "$CHANGELOG"
