#!/usr/bin/env bash
# Record the README demo GIF by driving the app with Maestro (../demo/demo.yaml) while the
# platform's own screen recorder runs.
#
# Usage:
#   bash apps/mobile/e2e/scripts/record-demo.sh ios                 # booted simulator
#   bash apps/mobile/e2e/scripts/record-demo.sh android             # attached device/emulator
#   OUT=docs/media/demo.gif WIDTH=420 FPS=15 bash .../record-demo.sh ios
#
# Expects the app already installed on the target and built with EXPO_PUBLIC_COMICAL_DEMO_MODE=1
# (deterministic mock data) + EXPO_PUBLIC_COMICAL_CAPTURE_MODE=1 (suppresses the demo-preview
# pill, which would otherwise sit in frame). .github/workflows/capture-demo.yml builds exactly
# that and runs this script; locally, `bun run ios`/`android` with those vars set does the same.
#
# WHY THE PLATFORM RECORDER, NOT MAESTRO'S `startRecording`: both work, but simctl and
# screenrecord encode in hardware at a framerate we choose, and write a plain mp4 to a path we
# name instead of into Maestro's debug-output tree. The flow also stays a flow — readable and
# runnable on its own without recording side effects.
#
# SMOOTHNESS. Frames dropped by the device are baked into the recording; no filter recovers them.
# Two things do most of the work here: a warm-up pass (../demo/warmup.yaml) so nothing in the
# recorded pass is paying first-load costs, and the fact that a GIF is only ~15fps, so the device
# has to sustain 15-20fps during the animations rather than 60. What remains is checked, not
# hoped for: the recording is measured for inter-frame gaps below and the run fails if it hitched.
set -euo pipefail

PLATFORM="${1:-}"
# RENDER_FROM re-runs only the second half — plan the cut, encode the GIF — against a capture that
# already exists, with no device, no Maestro and no 11-minute wait. It is how the analysis and
# encode get exercised locally against real footage (`RENDER_FROM=demo.mp4 ... record-demo.sh`),
# and how a published take can be re-cut at different settings without recapturing it. It exists
# because the encode half once shipped an unbound variable that `bash -n` cannot see and only a CI
# run could find.
RENDER_FROM="${RENDER_FROM:-}"
if [ -z "$RENDER_FROM" ] && [ "$PLATFORM" != "android" ] && [ "$PLATFORM" != "ios" ]; then
  echo "Usage: $0 <android|ios>   (or: RENDER_FROM=take.mp4 $0)" >&2
  exit 1
fi

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"     # apps/mobile/e2e
REPO_ROOT="$(cd "$E2E_DIR/../../.." && pwd)"

OUT="${OUT:-$REPO_ROOT/docs/media/demo.gif}"
WORK="${WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
RAW="$WORK/demo.mp4"

# Output tuning, measured against a real capture rather than guessed. A phone frame is ~2.2x
# taller than wide, so 220 lands at 220x478.
#
# Size is frame count x area x palette. The frame count is the kept duration (see STILL_GAP/HOLD
# below) times FPS, so all three of these move it: on the reference take 220px/96 colours/15fps
# came to 82 frames and 1.6MB, while 240px/128 colours came to 3.9MB.
WIDTH="${WIDTH:-220}"
FPS="${FPS:-15}"
MAX_COLORS="${MAX_COLORS:-96}"
# What counts as the screen holding rather than animating. Frames closer together than this are
# part of a movement; anything sparser is a hold — including the multi-minute head of every take,
# while Maestro's driver starts up, which is how the lead-in gets found rather than configured.
STILL_GAP="${STILL_GAP:-0.4}"
# How much of each hold survives into the GIF. The reference take ran 97s of stillness against
# 5.7s of movement; at zero this reads as one frantic sequence with no beats between the steps.
HOLD="${HOLD:-0.35}"
# Padding either side of the kept material.
LEAD_IN="${LEAD_IN:-0.6}"
TAIL_OUT="${TAIL_OUT:-1.2}"

# `set -u` is on, so this has to exist before the first use. An earlier edit deleted it along with
# the neighbouring block it had been tucked next to, and the script then died at its first ffmpeg
# call — after a full 11-minute run that had otherwise gone perfectly.
FFMPEG="${FFMPEG:-ffmpeg}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "!! $1 not found on PATH" >&2; exit 1; }; }
[ -n "$RENDER_FROM" ] || need maestro
# `$FFMPEG`, not the literal name: an override has to be the thing that gets checked, or the check
# passes on a PATH ffmpeg that is not the binary the rest of the script will call.
need "$FFMPEG"

# A watchable copy of the take, written as soon as the recording exists rather than at the end.
# Everything after this point can fail, and when it does the raw file is exactly what needs
# inspecting — but the raw file is hopeless in a general player: simctl writes it at the
# simulator's full panel size (1206x2622 on the reference take, past the height many hardware
# decoders accept), QuickTime-branded, with multi-second gaps between frames (one take held its
# first frame for 50 seconds). VLC will not open it.
playable_copy() {
  "$FFMPEG" -v error -y -i "$RAW" -vf "fps=15,scale=-2:1280" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$WORK/demo-playable.mp4" 2>/dev/null \
    && echo "==> Watchable copy: $WORK/demo-playable.mp4" \
    || echo "!! Could not write the watchable copy (no libx264?)" >&2
}

RECORDER_PID=""
cleanup() {
  if [ -n "$RECORDER_PID" ] && kill -0 "$RECORDER_PID" 2>/dev/null; then
    kill -INT "$RECORDER_PID" 2>/dev/null || true
    wait "$RECORDER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ -n "$RENDER_FROM" ]; then
  [ -f "$RENDER_FROM" ] || { echo "!! no such capture: $RENDER_FROM" >&2; exit 1; }
  cp "$RENDER_FROM" "$RAW"
  echo "==> Rendering from $RENDER_FROM (no device)"
  playable_copy
elif [ "$PLATFORM" = "ios" ]; then
  need xcrun
  UDID="${UDID:-$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=json.load(sys.stdin)["devices"]; print(next(x["udid"] for v in d.values() for x in v))')}"
  echo "==> Simulator $UDID"

  # A pinned status bar keeps consecutive captures identical: without this the clock and the
  # battery differ between takes, which is the kind of detail that makes a re-recorded GIF look
  # like a different app.
  xcrun simctl status_bar "$UDID" override \
    --time "9:41" --batteryState charged --batteryLevel 100 \
    --cellularBars 4 --wifiBars 3 --dataNetwork wifi >/dev/null 2>&1 || true

  MAESTRO_DEVICE=(--device "$UDID")
  start_recorder() {
    xcrun simctl io "$UDID" recordVideo --codec h264 --force "$RAW" &
    RECORDER_PID=$!
  }
  stop_recorder() {
    kill -INT "$RECORDER_PID" 2>/dev/null || true
    wait "$RECORDER_PID" 2>/dev/null || true
    RECORDER_PID=""
  }
else
  need adb
  ADB="${ADB:-adb}"
  echo "==> Android device: $("$ADB" get-serialno)"

  # SystemUI demo mode: same reasoning as the simctl status_bar override above.
  "$ADB" shell settings put global sysui_demo_allowed 1 >/dev/null 2>&1 || true
  "$ADB" shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null 2>&1 || true
  "$ADB" shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null 2>&1 || true
  "$ADB" shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null 2>&1 || true
  "$ADB" shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null 2>&1 || true
  "$ADB" shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null 2>&1 || true

  MAESTRO_DEVICE=()
  start_recorder() {
    # --bit-rate well above the default 4Mbps: the source is re-encoded to a GIF, so compression
    # artifacts here would survive into the final image.
    "$ADB" shell screenrecord --bit-rate 12000000 /sdcard/comical-demo.mp4 &
    RECORDER_PID=$!
  }
  stop_recorder() {
    # screenrecord only finalizes the mp4 container on SIGINT — killing the adb client alone
    # leaves an unplayable file on the device.
    "$ADB" shell pkill -INT screenrecord || true
    wait "$RECORDER_PID" 2>/dev/null || true
    RECORDER_PID=""
    sleep 2   # let the device flush the moov atom before pulling
    "$ADB" pull /sdcard/comical-demo.mp4 "$RAW" >/dev/null
    "$ADB" shell rm -f /sdcard/comical-demo.mp4 || true
  }
fi

if [ -z "$RENDER_FROM" ]; then
echo "==> Warm-up pass (not recorded)"
maestro "${MAESTRO_DEVICE[@]}" test "$E2E_DIR/demo/warmup.yaml"

echo "==> Launching the app (not recorded)"
maestro "${MAESTRO_DEVICE[@]}" test "$E2E_DIR/demo/launch.yaml"

echo "==> Recording"
start_recorder
sleep 1   # let the recorder actually open its output before the flow starts moving
maestro "${MAESTRO_DEVICE[@]}" test "$E2E_DIR/demo/demo.yaml"
stop_recorder
echo "==> Raw capture: $RAW"
playable_copy
fi

echo "==> Planning the cut"
# One showinfo pass gives every frame's timestamp; demo-ranges.py turns those into the slices worth
# keeping and prints the filtergraph that produces them. See that file for why the cut is expressed
# as time ranges rather than as mpdecimate + a re-timestamp — the short version is that re-timing
# discards duration, so animations play at a speed set by how many frames happened to be captured.
"$FFMPEG" -v info -i "$RAW" -vf showinfo -f null - 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 > "$WORK/frames.txt"

TAIL_FILTERS="scale=$WIDTH:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=$MAX_COLORS:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5"
if ! GRAPH=$(python3 "$E2E_DIR/scripts/demo-ranges.py" \
      "$STILL_GAP" "$HOLD" "$LEAD_IN" "$TAIL_OUT" "$FPS" "$TAIL_FILTERS" < "$WORK/frames.txt"); then
  echo "!! Could not plan a cut from this recording. Raw file kept at $RAW" >&2
  exit 2
fi

echo "==> Encoding GIF"
mkdir -p "$(dirname "$OUT")"
"$FFMPEG" -v error -y -i "$RAW" -filter_complex "$GRAPH" -loop 0 "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
FRAMES=$("$FFMPEG" -v info -i "$OUT" -vf showinfo -f null - 2>&1 | grep -c 'pts_time:')
echo "==> Wrote $OUT ($SIZE, $FRAMES frames)"
echo "    raw capture kept at $RAW"
