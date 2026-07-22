#!/usr/bin/env bash
# Run committed Maestro e2e flows against a local Expo dev-client build (Android or iOS).
#
# Generalized from the original apps/mobile/.maestro-local/run.sh: the dev client doesn't
# auto-reconnect to Metro on restart, so before each flow this deep-links it to the Metro
# server and waits for the app UI to load. The flows' `launchApp: { stopApp: false }`
# entrypoint variant then just foregrounds the (reloaded) app — but the COMMITTED entrypoints
# under ../android and ../ios use plain `runFlow: ../flows/<name>.yaml`, whose shared flow body
# uses a plain `launchApp` (stopApp: true, correct for CI's standalone builds). Against a
# dev-client build that matters: a restart bounces the client to its launcher instead of
# reconnecting to Metro. This script papers over that by reconnecting first, then letting the
# flow's own launchApp run as a no-op-ish foreground (the dev client is already loaded).
#
# Usage:
#   bash e2e/scripts/run-device.sh android smoke.yaml       # one flow
#   bash e2e/scripts/run-device.sh android                  # every flow for that platform, in order
#   bash e2e/scripts/run-device.sh ios browse-to-reader.yaml
#   METRO_URL=http://192.168.1.239:8081 bash e2e/scripts/run-device.sh android smoke.yaml  # physical device
#
# Env:
#   METRO_URL  Metro server the dev client should load. Default depends on platform:
#              Android emulator: http://10.0.2.2:8081 (the emulator's route to the host)
#              iOS simulator:    http://localhost:8081 (shares the host's network namespace)
#              Use the LAN IP for a physical device on either platform.
#   ADB        adb binary (Android only, default: adb on PATH).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # .../apps/mobile/e2e
PLATFORM="${1:-}"
FLOW="${2:-}"

if [ "$PLATFORM" != "android" ] && [ "$PLATFORM" != "ios" ]; then
  echo "Usage: $0 <android|ios> [flow.yaml]" >&2
  exit 1
fi

FLOW_DIR="$DIR/$PLATFORM"

if [ "$PLATFORM" = "android" ]; then
  ADB="${ADB:-adb}"
  METRO_URL="${METRO_URL:-http://10.0.2.2:8081}"
  enc=$(printf '%s' "$METRO_URL" | sed 's/:/%3A/g; s#/#%2F#g')
  reconnect() {
    echo "==> Reconnecting dev client to $METRO_URL"
    "$ADB" shell am start -a android.intent.action.VIEW \
      -d "comical://expo-development-client/?url=$enc" >/dev/null 2>&1 || true
    echo "==> Waiting for app UI (tab bar) to load..."
    for _ in $(seq 1 30); do
      if maestro hierarchy 2>/dev/null | grep -q '"resource-id" : "tab.browse"'; then
        echo "==> App loaded."
        return 0
      fi
      sleep 2
    done
    echo "!! App UI never appeared — is Metro running? (bun run dev:device)"
    return 1
  }
elif [ "$PLATFORM" = "ios" ]; then
  METRO_URL="${METRO_URL:-http://localhost:8081}"
  enc=$(printf '%s' "$METRO_URL" | sed 's/:/%3A/g; s#/#%2F#g')
  reconnect() {
    echo "==> Reconnecting dev client to $METRO_URL"
    xcrun simctl openurl booted "comical://expo-development-client/?url=$enc" >/dev/null 2>&1 || true
    echo "==> Waiting for app UI (tab bar) to load..."
    for _ in $(seq 1 30); do
      if maestro hierarchy 2>/dev/null | grep -q '"accessibilityIdentifier" : "tab.browse"'; then
        echo "==> App loaded."
        return 0
      fi
      sleep 2
    done
    echo "!! App UI never appeared — is Metro running? (bun run dev:device)"
    return 1
  }
fi

run_flow() { # $1 = flow file path
  reconnect || return 1
  echo "==> maestro test $1"
  maestro test "$1"
}

if [ -n "$FLOW" ]; then
  run_flow "$FLOW_DIR/$FLOW"
  exit $?
fi

# No specific flow given: run every entrypoint for this platform, each with a fresh reload.
rc=0
for f in "$FLOW_DIR"/*.yaml; do
  run_flow "$f" || rc=1
done
exit $rc
