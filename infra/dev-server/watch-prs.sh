#!/usr/bin/env bash
# Comical remote dev server — the PR follower.
#
# Keeps ONE checkout (/opt/comical/app) pointed at whichever open PR was pushed to most recently,
# and restarts Metro when that requires it. The phone talks to Metro over Tailscale, so a push from
# any Claude session (or from you) shows up on-device without a PC in the loop.
#
# WHY OPEN PRs AND NOT `claude/*` BRANCHES. This mirrors the ios-pr / android-pr install channels
# exactly (.github/scripts/refresh-ios-pr-source.sh): the unit of "work in flight" in this repo is
# an open PR, drafts included. Reusing that rule means the dev server, the SideStore source and the
# APK channels all agree on what is live, and a PR closing retires it from all three. The cost is
# that a branch with no PR is never served — same contract as ios-pr-<N>, and sentry-autofix.yml
# already opens drafts, so nothing new is required of Claude beyond opening one.
#
# WHY POLLING AND NOT A WEBHOOK. A webhook needs an inbound path from GitHub, which means a public
# hostname, which throws away the reason this box is tailnet-only. `git ls-remote` returns every
# PR head SHA in one unauthenticated-to-the-API call, so the poll costs nothing and the GitHub API
# is only touched when a SHA actually moves.
#
# WHY `refs/pull/*/head` IS NOT ENOUGH ON ITS OWN. Those refs persist after a PR closes, so the ref
# existing proves nothing about the PR being alive — the same trap refresh-ios-pr-source.sh
# documents for release artifacts. Every switch is therefore confirmed against the PR's actual
# state, and an INDETERMINATE answer (rate limit, transient failure) holds position rather than
# falling back: only positively-confirmed states are acted on, matching that script's `*)` case.
set -euo pipefail

REPO="${DEV_REPO:-porksphere/comical-app}"
APP_DIR="${DEV_APP_DIR:-/opt/comical/app}"
CONTROL_DIR="${DEV_CONTROL_DIR:-/opt/comical/control}"
STATE_DIR="${DEV_STATE_DIR:-/var/lib/comical-dev}"
POLL_INTERVAL="${DEV_POLL_INTERVAL:-15}"
# Full reconcile every Nth cycle (20 x 15s = 5 min). The SHA diff catches pushes; this catches the
# things a push never signals — a PR closing, or anything that happened while the box was down.
RECONCILE_EVERY="${DEV_RECONCILE_EVERY:-20}"
METRO_UNIT="${DEV_METRO_UNIT:-comical-metro.service}"

STATE="$STATE_DIR/state.json"
STATUS="$STATE_DIR/status.json"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# ── GitHub API ───────────────────────────────────────────────────────────────

api() {
  curl -fsS -m 20 \
    -H "Authorization: Bearer ${GH_TOKEN:?GH_TOKEN not set (see /etc/comical-dev/env)}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${REPO}$1"
}

# OPEN | MERGED | CLOSED | UNKNOWN. UNKNOWN is deliberately distinct from CLOSED — callers hold
# position on it instead of acting, so a rate limit can never yank the box off a live PR.
pr_state() {
  local j st
  j="$(api "/pulls/$1" 2>/dev/null)" || { echo UNKNOWN; return 0; }
  st="$(jq -r '.state' <<<"$j" 2>/dev/null)" || { echo UNKNOWN; return 0; }
  case "$st" in
    open) echo OPEN ;;
    closed) [ "$(jq -r '.merged' <<<"$j")" = true ] && echo MERGED || echo CLOSED ;;
    *) echo UNKNOWN ;;
  esac
}

# ── State ────────────────────────────────────────────────────────────────────

state_get() { jq -r "$1" "$STATE" 2>/dev/null || echo ""; }

state_set() {
  local tmp; tmp="$(mktemp)"
  jq "$@" "$STATE" > "$tmp" && mv "$tmp" "$STATE"
}

write_status() {
  local tmp; tmp="$(mktemp)"
  # -c, not state_get's -r: --argjson needs the value's real JSON type preserved (a pinned "124"
  # must stay a string, not decay into a number).
  jq -n \
    --argjson current "$(jq -c '.current // null' "$STATE")" \
    --argjson pinned "$(jq -c '.pinned // null' "$STATE")" \
    --arg updated "$(date -u +%FT%TZ)" \
    --arg host "${REACT_NATIVE_PACKAGER_HOSTNAME:-unset}" \
    --arg port "${METRO_PORT:-8081}" \
    '{current:$current, pinned:$pinned, updatedAt:$updated,
      metro:("exp://" + $host + ":" + $port)}' > "$tmp" && mv "$tmp" "$STATUS"
}

# ── Sync ─────────────────────────────────────────────────────────────────────

# Move the app checkout to <kind> <ref> @ <sha>, reinstalling and restarting Metro only when the
# change actually requires it. A JS-only push on the branch already being served is left to Metro's
# own watcher, which is the fast path (HMR on the device, no reconnect). Everything else restarts:
# a branch switch rewrites too many files to trust a watcher with, and a dependency or native-config
# change can't be hot-reloaded at all.
sync() {
  local kind="$1" ref="$2" sha="$3" oldref="$4" oldsha="$5"
  local fetchref changed need_restart=0 need_install=0

  if [ "$kind" = pr ]; then fetchref="refs/pull/$ref/head"; else fetchref="refs/heads/main"; fi
  log "sync -> ${kind} ${ref} @ ${sha:0:7}"

  git -C "$APP_DIR" fetch --quiet origin "+${fetchref}:refs/comical-dev/target" || {
    log "fetch failed"; return 1; }

  if [ -n "$oldsha" ] && [ "$ref" = "$oldref" ]; then
    changed="$(git -C "$APP_DIR" diff --name-only "$oldsha" "$sha" 2>/dev/null)" || changed="__ALL__"
  else
    changed="__ALL__"
  fi

  git -C "$APP_DIR" checkout --quiet --detach refs/comical-dev/target || { log "checkout failed"; return 1; }
  git -C "$APP_DIR" submodule update --init --recursive --quiet || log "submodule update failed (continuing)"

  if grep -qx '__ALL__' <<<"$changed"; then
    need_restart=1; need_install=1
  else
    # Dependency changes need an install AND a restart — Metro resolves node_modules at startup.
    grep -qE '(^|/)(bun\.lock|package\.json)$' <<<"$changed" && { need_install=1; need_restart=1; }
    # Config Metro only reads at boot, plus the submodule pointer (it moves the @comical/* sources
    # Metro resolves through metro.config.js's extraNodeModules).
    grep -qE '(^|/)(app\.json|metro\.config\.js)$|^apps/mobile/plugins/|^apps/mobile/modules/|^external/comical$' \
      <<<"$changed" && need_restart=1
  fi

  if [ "$need_install" = 1 ]; then
    log "installing deps"
    ( cd "$APP_DIR" && bun install --frozen-lockfile ) || { log "bun install failed"; return 1; }
    # Hoisted, because metro.config.js resolves hono/zod/cheerio out of external/comical/node_modules
    # and bun's default layout tucks them into per-package dirs. See setup.ts step 3.
    ( cd "$APP_DIR/external/comical" && bun install --linker hoisted ) || log "submodule install failed (continuing)"
  fi

  if [ "$need_restart" = 1 ]; then
    log "restarting ${METRO_UNIT}"
    sudo -n systemctl restart "$METRO_UNIT" || { log "restart failed"; return 1; }
  else
    log "JS-only change on the served branch — leaving Metro to hot-reload"
  fi
  return 0
}

# ── Target selection ─────────────────────────────────────────────────────────

target_kind=""; target_ref=""; target_sha=""

# Fallback when there is nothing to follow from a SHA diff: newest open PR, else main.
# `sort=updated` is approximate — a comment bumps it too — but this only ever picks the STARTING
# point (cold boot, or the served PR dying). From then on the SHA diff is exact.
pick_newest_open() {
  local j n
  j="$(api "/pulls?state=open&sort=updated&direction=desc&per_page=100")" || {
    log "pulls API failed — holding position"; return 1; }
  n="$(jq -r '.[0].number // empty' <<<"$j")"
  if [ -n "$n" ]; then
    target_kind="pr"; target_ref="$n"; target_sha="$(jq -r '.[0].head.sha' <<<"$j")"
  else
    target_kind="main"; target_ref=main
    target_sha="$(git -C "$APP_DIR" ls-remote origin refs/heads/main | head -1 | awk '{print $1}')"
    [ -n "$target_sha" ] || return 1
  fi
  return 0
}

run_cycle() {
  local reconcile="$1"
  target_kind=""; target_ref=""; target_sha=""

  # Keep the control checkout (this script's own source) current, so updating the dev server is a
  # push to main. It is a SEPARATE clone from the one Metro serves precisely because that one gets
  # yanked between PR heads — scripts must not move under a running service.
  if [ "$reconcile" = 1 ]; then
    git -C "$CONTROL_DIR" fetch --quiet origin main 2>/dev/null &&
      git -C "$CONTROL_DIR" reset --hard --quiet origin/main 2>/dev/null || log "control refresh failed (continuing)"
  fi

  local remote now_shas
  remote="$(git -C "$APP_DIR" ls-remote origin 'refs/pull/*/head' 2>/dev/null)" || { log "ls-remote failed"; return 0; }
  now_shas="$(awk '{ n=$2; sub("refs/pull/","",n); sub("/head","",n); print n, $1 }' <<<"$remote" |
    jq -Rn '[inputs | split(" ") | {(.[0]): .[1]}] | add // {}')"

  local prev_shas pinned current cur_ref cur_sha changed n st
  prev_shas="$(state_get '.shas')"; [ -n "$prev_shas" ] || prev_shas='{}'
  pinned="$(state_get '.pinned // empty')"
  current="$(state_get '.current // empty')"
  cur_ref=""; cur_sha=""
  if [ -n "$current" ]; then
    cur_ref="$(jq -r '.ref // empty' <<<"$current")"
    cur_sha="$(jq -r '.sha // empty' <<<"$current")"
  fi

  # PR numbers whose head moved since last cycle, newest PR first as the same-cycle tiebreak.
  # Capped, because each candidate costs an API call to confirm its state and a burst of activity
  # must not turn into an unbounded probe loop every 15s.
  changed="$(jq -r --argjson prev "$prev_shas" \
    'to_entries | map(select($prev[.key] != .value) | .key | tonumber) | sort | reverse | .[]' \
    <<<"$now_shas" 2>/dev/null | head -n "${DEV_MAX_PROBE:-10}" || true)"

  # FIRST EVER RUN. `refs/pull/N/head` is never deleted, so a repo with 120+ historical PRs presents
  # 120+ "changed" refs against an empty map — and probing each one to discover that it closed a year
  # ago would cost a hundred API calls, repeated every cycle until a sync finally succeeds and the map
  # persists. Seed from the open-PR list instead: one call, and the exact SHA diff takes over next cycle.
  local cold=0
  [ "$prev_shas" = "{}" ] && cold=1

  # A pin overrides the follow entirely — that is its whole point during a review.
  if [ -n "$pinned" ] && [ "$reconcile" = 1 ]; then
    st="$(pr_state "$pinned")"
    case "$st" in
      OPEN) : ;;
      MERGED|CLOSED) log "pinned PR #${pinned} is ${st} — unpinning"; state_set '.pinned = null'; pinned="" ;;
      *) log "pinned PR #${pinned} indeterminate — holding" ;;
    esac
  fi

  if [ -n "$pinned" ]; then
    target_sha="$(jq -r --arg n "$pinned" '.[$n] // empty' <<<"$now_shas")"
    if [ -z "$target_sha" ]; then log "pinned PR #${pinned} has no head ref — holding"; return 0; fi
    target_kind="pr"; target_ref="$pinned"
  elif [ "$cold" = 0 ]; then
    for n in $changed; do
      st="$(pr_state "$n")"
      case "$st" in
        OPEN) target_kind="pr"; target_ref="$n"; target_sha="$(jq -r --arg n "$n" '.[$n]' <<<"$now_shas")"; break ;;
        UNKNOWN) log "PR #${n} indeterminate — skipping this cycle" ;;
        *) ;;  # closed/merged: its ref still exists, that is expected, ignore it
      esac
    done
  fi

  # Nothing pushed. Hold, unless this is a reconcile tick and what we are serving has died.
  if [ -z "$target_kind" ]; then
    if [ -z "$current" ]; then
      pick_newest_open || return 0
    elif [ "$reconcile" = 1 ]; then
      if [ "$(jq -r '.kind' <<<"$current")" = pr ]; then
        st="$(pr_state "$cur_ref")"
        case "$st" in
          OPEN) target_kind="pr"; target_ref="$cur_ref"
                target_sha="$(jq -r --arg n "$cur_ref" '.[$n] // empty' <<<"$now_shas")"
                [ -n "$target_sha" ] || return 0 ;;
          MERGED|CLOSED) log "served PR #${cur_ref} is ${st} — falling back"; pick_newest_open || return 0 ;;
          *) return 0 ;;
        esac
      else
        pick_newest_open || return 0   # sitting on main: adopt a PR if one exists
      fi
    else
      return 0
    fi
  fi

  if [ "$target_ref" = "$cur_ref" ] && [ "$target_sha" = "$cur_sha" ]; then
    state_set --argjson s "$now_shas" '.shas = $s'
    write_status
    return 0
  fi

  sync "$target_kind" "$target_ref" "$target_sha" "$cur_ref" "$cur_sha" || return 0

  state_set --argjson s "$now_shas" --arg k "$target_kind" --arg r "$target_ref" --arg h "$target_sha" \
    '.shas = $s | .current = {kind:$k, ref:$r, sha:$h, since:(now|todate)}'
  write_status
  return 0
}

# ── Main ─────────────────────────────────────────────────────────────────────

mkdir -p "$STATE_DIR"
[ -f "$STATE" ] || echo '{"shas":{},"current":null,"pinned":null}' > "$STATE"

log "watching ${REPO} (poll ${POLL_INTERVAL}s, reconcile every ${RECONCILE_EVERY} cycles)"
cycle=0
while :; do
  cycle=$((cycle + 1))
  if [ $((cycle % RECONCILE_EVERY)) -eq 1 ]; then r=1; else r=0; fi
  run_cycle "$r" || log "cycle error (continuing)"
  sleep "$POLL_INTERVAL"
done
