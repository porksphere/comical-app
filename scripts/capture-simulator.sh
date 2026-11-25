#!/usr/bin/env bash
# Create and boot a simulator for a capture, install the app on it, and dress it for the camera.
# Prints the simulator's UDID, and nothing else, on stdout.
#
#   scripts/capture-simulator.sh iphone|duo <path to .app>
#
# Used by `.github/workflows/capture-page-turn.yml`.
set -euo pipefail

kind=${1:?usage: capture-simulator.sh iphone|duo <app>}
app=${2:?usage: capture-simulator.sh iphone|duo <app>}

case "$kind" in
  # A plain or Pro iPhone, never a Plus, Max, Air or SE: the promo's phone is one size.
  iphone) match='^iPhone [0-9]+( Pro)?$' ;;
  duo) match='Duo' ;;
  *) echo "!! unknown device \"$kind\"" >&2; exit 2 ;;
esac

# The device type comes out of a runtime's own supportedDeviceTypes: one picked apart from its
# runtime can be incompatible with it and fail `simctl create` with "Incompatible device". The
# runtime is the newest that has such a device, and the device the newest of them by the number in
# its name, then by name so "iPhone 17" and "iPhone 17 Pro" (different screens) don't tie.
pick=$(xcrun simctl list runtimes -j | jq -r --arg match "$match" '
  [.runtimes[] | select(.name | test("iOS")) | select(.isAvailable)
    | {runtime: .identifier,
       version: (.version | split(".") | map(tonumber? // 0)),
       device: ([.supportedDeviceTypes[] | select(.name | test($match))]
                | sort_by((.name | (capture("(?<n>[0-9]+)") // {n: "0"}).n | tonumber), .name)
                | last | .identifier)}
    | select(.device != null)]
  | sort_by(.version) | last // empty | "\(.runtime) \(.device)"')
if [ -z "$pick" ]; then
  echo "!! no installed iOS runtime has a device matching /$match/" >&2
  xcrun simctl list runtimes >&2
  exit 1
fi
runtime=${pick% *}
device=${pick#* }
echo "Using runtime=$runtime device_type=$device" >&2

udid=$(xcrun simctl create "comical-capture-$kind" "$device" "$runtime")
xcrun simctl boot "$udid" >&2
xcrun simctl bootstatus "$udid" -b >&2
xcrun simctl install "$udid" "$app" >&2

# Dark, since the app's theme follows the system's and every other shot of it is dark; and the
# status bar pinned, or the clock and battery differ in every take.
xcrun simctl ui "$udid" appearance dark >&2
xcrun simctl status_bar "$udid" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 --dataNetwork wifi >&2

echo "$udid"
