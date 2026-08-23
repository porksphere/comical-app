#!/usr/bin/env bash
# Joins a Claude Code (web/remote) session container to the tailnet, so Claude can reach the dev
# server: read Metro's log, see the redbox and console output your PHONE produced, and hit the dev
# server directly. Without this Claude pushes blind and you have to relay "it crashed" by hand.
#
# Wire it up as a SessionStart hook (see infra/dev-server/README.md). No-ops when TS_AUTHKEY is unset, so
# it is safe in every other environment — local sessions, CI, a contributor's clone.
#
# The key MUST be ephemeral: these containers are reclaimed on idle, and a non-ephemeral key leaves
# a dead node on the tailnet for every session that ever ran.
#
# VERIFIED: a container of this type completes the Tailscale registration handshake — control-plane
# key exchange, nodekey generation, RegisterReq accepted — with UDP egress and direct TCP/443 both
# open, /dev/net/tun present and CAP_NET_ADMIN held. NOT VERIFIED: a completed join and a data-plane
# connection to the box, which needs a real auth key. Treat the first run as a test.
set -euo pipefail

[ -n "${TS_AUTHKEY:-}" ] || { echo "TS_AUTHKEY unset — skipping tailnet join"; exit 0; }
command -v tailscaled >/dev/null || {
  echo "tailscaled not installed — skipping (see infra/dev-server/README.md)"; exit 0; }

STATE_DIR="${TS_STATE_DIR:-/var/lib/tailscale-claude}"
mkdir -p "$STATE_DIR"

if ! pgrep -x tailscaled >/dev/null; then
  # Kernel TUN mode when the container allows it: that gives a real 100.x interface, so Metro's
  # host:port is reachable directly the way the phone reaches it. Userspace networking still lets
  # Claude make OUTBOUND tailnet connections (enough to read logs and curl Metro), so it is a fine
  # fallback rather than a failure.
  if [ -w /dev/net/tun ]; then TUN_ARGS=(); else TUN_ARGS=(--tun=userspace-networking); fi
  setsid tailscaled --statedir="$STATE_DIR" "${TUN_ARGS[@]}" \
    > "$STATE_DIR/tailscaled.log" 2>&1 < /dev/null &
  for _ in $(seq 1 30); do tailscale status >/dev/null 2>&1 && break; sleep 1; done
fi

tailscale up \
  --authkey="${TS_AUTHKEY}" \
  --hostname="claude-$(hostname | tr -cd 'a-z0-9-' | cut -c1-20)" \
  --accept-dns=true \
  --ssh=false || { echo "tailscale up failed — continuing without the tailnet"; exit 0; }

echo "joined tailnet as $(tailscale status --self --peers=false 2>/dev/null | head -1 || echo '?')"
