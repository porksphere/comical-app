#!/usr/bin/env bash
# One-shot setup for the Comical remote dev server box. Idempotent — safe to re-run after a
# config change or to pull newer scripts.
#
#   curl -fsSL https://raw.githubusercontent.com/porksphere/comical-app/main/infra/dev-server/bootstrap.sh | sudo bash
#
# Assumes: fresh Ubuntu 24.04, run as root, and /etc/comical-dev/env already filled in (the script
# writes a template and stops if it is missing, so the first run is: run it, fill in the env, run
# it again). See infra/dev-server/README.md for what goes in that file and where each secret comes from.
#
# TWO CHECKOUTS, deliberately:
#   /opt/comical/control  pinned to main — the scripts and units this box runs
#   /opt/comical/app      moved between PR heads by the watcher — what Metro serves
# One checkout cannot do both: the watcher yanks the app tree to whatever PR was pushed last, and
# a service must not have its own source change underneath it mid-run.
set -euo pipefail

REPO_URL="https://github.com/porksphere/comical-app.git"
# Branch the CONTROL checkout tracks — the scripts and units this box runs. Normally main; override
# to test a branch before it merges (the watcher reads the same variable, so both stay in step).
CONTROL_BRANCH="${DEV_CONTROL_BRANCH:-main}"
BASE=/opt/comical
ENV_FILE=/etc/comical-dev/env
USER_NAME=comical

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

# ── 1. Packages ──────────────────────────────────────────────────────────────
# Assume nothing is preinstalled — Minimal cloud images ship a deliberately thin package set, and
# ufw in particular is absent from them. The firewall step below is a no-op without it, which would
# leave the box with no host firewall and no error to notice. unzip is bun's installer dep.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl jq unzip sudo ca-certificates ufw iptables

# watchman separately, and non-fatally. Without it Metro falls back to a plain fs.watch crawl, which
# is what drops events on a checkout that rewrites hundreds of files — so it matters. It is not in
# every arch/release suite though, and a missing optional package must not abort an otherwise-fine
# setup. Fall back to DEV_ALWAYS_RESTART=1, which restarts Metro on every sync instead.
if ! apt-get install -y -qq watchman 2>/dev/null; then
  echo "WARNING: watchman unavailable for $(dpkg --print-architecture) — set DEV_ALWAYS_RESTART=1 in $ENV_FILE" >&2
fi

# ── 2. Tailscale ─────────────────────────────────────────────────────────────
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# ── 3. Service user ──────────────────────────────────────────────────────────
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$BASE" --shell /bin/bash "$USER_NAME"
fi
mkdir -p "$BASE" && chown "$USER_NAME:$USER_NAME" "$BASE"

# ── 4. Env file (template on first run) ──────────────────────────────────────
mkdir -p /etc/comical-dev
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'TEMPLATE'
# Fine-grained PAT: repos comical-app + comical, Contents:read, Pull requests:read, Metadata:read.
GH_TOKEN=

# The box's MagicDNS name. Metro advertises this to the phone, so it must be what the phone can
# resolve on the tailnet — not localhost, not the public IP.
REACT_NATIVE_PACKAGER_HOSTNAME=comical-dev.tailXXXX.ts.net
METRO_PORT=8081

# The backend the app calls. Colocated on this box, so the dev build gets real data instead of
# DEMO_MODE — the one thing the GitHub Pages preview structurally cannot do.
EXPO_PUBLIC_COMICAL_SERVER=http://comical-dev.tailXXXX.ts.net:3100

# Restart Metro on every sync instead of letting its watcher hot-reload a JS-only push. Set to 1 if
# watchman is unavailable on this box, or if edits stop showing up on the device without a restart.
# DEV_ALWAYS_RESTART=1

# Branch the control checkout follows. Leave unset for main; set it to test a branch pre-merge.
# DEV_CONTROL_BRANCH=claude/remote-expo-dev-server-8pxwxk
TEMPLATE
  chmod 600 "$ENV_FILE"
  echo "Wrote template $ENV_FILE — fill it in, then re-run this script." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN empty in $ENV_FILE" >&2; exit 1; }
chmod 600 "$ENV_FILE"

# ── 5. Git auth ──────────────────────────────────────────────────────────────
# insteadOf rather than a deploy key, because the `comical` submodule is a SEPARATE repo: one PAT
# scoped to both covers the superproject fetch and the submodule fetch with no per-repo key juggling.
sudo -u "$USER_NAME" git config --global \
  "url.https://x-access-token:${GH_TOKEN}@github.com/.insteadOf" "https://github.com/"
sudo -u "$USER_NAME" git config --global --replace-all credential.helper ""

# ── 6. Checkouts ─────────────────────────────────────────────────────────────
for d in control app; do
  if [ ! -d "$BASE/$d/.git" ]; then
    sudo -u "$USER_NAME" git clone --quiet "$REPO_URL" "$BASE/$d"
  fi
done
sudo -u "$USER_NAME" git -C "$BASE/control" fetch --quiet origin "$CONTROL_BRANCH"
sudo -u "$USER_NAME" git -C "$BASE/control" reset --hard --quiet "origin/$CONTROL_BRANCH"

# ── 7. Bun + first install ───────────────────────────────────────────────────
if [ ! -x "$BASE/.bun/bin/bun" ]; then
  sudo -u "$USER_NAME" env BUN_INSTALL="$BASE/.bun" bash -c 'curl -fsSL https://bun.sh/install | bash'
fi
# `bun run setup` does submodule + deps + the hoisted submodule install Metro needs (see setup.ts).
sudo -u "$USER_NAME" env BUN_INSTALL="$BASE/.bun" PATH="$BASE/.bun/bin:$PATH" \
  bash -c "cd $BASE/app && bun run setup"

# ── 8. systemd ───────────────────────────────────────────────────────────────
install -m 644 "$BASE/control/infra/dev-server/systemd/comical-metro.service"   /etc/systemd/system/
install -m 644 "$BASE/control/infra/dev-server/systemd/comical-prwatch.service" /etc/systemd/system/
install -m 755 "$BASE/control/infra/dev-server/comical-dev" /usr/local/bin/comical-dev

# The watcher restarts Metro on a branch switch; that is the only privileged thing it does.
cat > /etc/sudoers.d/comical-dev <<SUDO
${USER_NAME} ALL=(root) NOPASSWD: /usr/bin/systemctl restart comical-metro.service
SUDO
chmod 440 /etc/sudoers.d/comical-dev
visudo -c -f /etc/sudoers.d/comical-dev >/dev/null

systemctl daemon-reload
systemctl enable --now comical-metro.service comical-prwatch.service

# ── 9. Firewall ──────────────────────────────────────────────────────────────
# Metro is completely unauthenticated — it will serve the whole source tree and accept
# /symbolicate POSTs from anyone who can reach the port. The tailnet is what protects it, so the
# public interface must not expose it. Your provider's own network firewall should deny the same
# ports too; this is the second layer, not the only one.
if ! command -v ufw >/dev/null; then
  echo "ERROR: ufw missing after install — refusing to leave this box without a host firewall" >&2
  exit 1
fi
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 >/dev/null
ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null

# Some cloud images ship a persisted iptables ruleset whose INPUT chain ends in a blanket REJECT.
# ufw installs its own chains but that trailing REJECT still runs, so inbound on tailscale0 is
# dropped and the phone cannot reach Metro even though ufw reports the port open. Insert an explicit
# ACCEPT ahead of it. Harmless otherwise: with no such rules there is nothing to sit in front of.
if command -v iptables >/dev/null && iptables -C INPUT -i tailscale0 -j ACCEPT 2>/dev/null; then
  : # already present
elif command -v iptables >/dev/null; then
  iptables -I INPUT 1 -i tailscale0 -j ACCEPT 2>/dev/null || true
  # Direct WireGuard needs inbound UDP; without it Tailscale still works but every packet detours
  # through a DERP relay, which is slower for a multi-MB bundle.
  iptables -I INPUT 2 -p udp --dport 41641 -j ACCEPT 2>/dev/null || true
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
fi

echo
echo "Done."
if tailscale status >/dev/null 2>&1; then
  echo "  Tailscale is already up — nothing to do there."
else
  # Deliberately NOT --advertise-tags here. Tags must exist in the tailnet's ACL policy
  # (tagOwners) first; on a default tailnet `tailscale up --advertise-tags=...` is rejected
  # outright, which is a poor thing to hand someone as their next step. Add tags later, once
  # the box works — they are what stops a tagged node's key expiring after 90 days.
  echo "  Next: sudo tailscale up --hostname=comical-dev"
fi
echo "  Then:  comical-dev status"
