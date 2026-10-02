#!/usr/bin/env bash
# Decides whether a scheduled (nightly) main build has anything to build: it does when any of the
# given pathspecs changed since the commit the workflow's last SUCCESSFUL scheduled run built.
# Anything other than a schedule always builds — a PR or a dispatch asked for this build.
#
# Measuring from the last success, not the last night, is what keeps a failed night from being
# forgotten: the next night still sees the change and tries again.
#
# Builds whenever it can't tell: no earlier scheduled success, or a commit that can no longer be
# fetched (history rewritten).
#
# Writes `build=true|false` to $GITHUB_OUTPUT.
#
# Usage: nightly-gate.sh <workflow-file> <pathspec>...
# Requires gh + GH_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_EVENT_NAME, a checkout of HEAD.
set -euo pipefail

WORKFLOW="${1:?usage: nightly-gate.sh <workflow-file> <pathspec>...}"
shift
[ $# -gt 0 ] || { echo "::error::nightly-gate.sh needs at least one pathspec"; exit 1; }

decide() {
  echo "$2"
  echo "build=$1" >> "$GITHUB_OUTPUT"
  exit 0
}

[ "${GITHUB_EVENT_NAME:-}" = "schedule" ] || decide true "Not a scheduled run — building."

LAST="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow "$WORKFLOW" --branch main \
  --event schedule --status success --limit 1 --json headSha -q '.[0].headSha // empty')"
[ -n "$LAST" ] || decide true "No earlier successful nightly — building."

HEAD_SHA="$(git rev-parse HEAD)"
[ "$LAST" != "$HEAD_SHA" ] || decide false "main hasn't moved since the last nightly (${LAST:0:7}) — skipping."

git fetch -q --depth=1 origin "$LAST" 2>/dev/null \
  || decide true "Couldn't fetch the last nightly's commit ${LAST:0:7} — building."

# Docs-only and eas.json changes don't change a binary (CI does a bare `expo prebuild`).
if git diff --quiet "$LAST" HEAD -- "$@" \
  ':(exclude,glob)**/*.md' ':(exclude)apps/mobile/docs' ':(exclude)apps/mobile/eas.json'; then
  decide false "Nothing this build depends on changed since ${LAST:0:7} — skipping."
fi
decide true "Changes since ${LAST:0:7} — building."
