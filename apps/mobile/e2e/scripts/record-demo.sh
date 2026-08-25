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
if [ "$PLATFORM" != "android" ] && [ "$PLATFORM" != "ios" ]; then
  echo "Usage: $0 <android|ios>" >&2
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
# The head and tail are found, not configured. Maestro's CLI start-up sits between the recorder
# opening and the flow's first command, and it varies run to run, so a fixed trim would leave a
# different amount of dead air in every recapture. Instead the take is scanned for scene changes:
# the GIF starts LEAD_IN seconds before the first movement and ends TAIL_OUT after the last.
LEAD_IN="${LEAD_IN:-0.6}"
TAIL_OUT="${TAIL_OUT:-1.2}"
# Fraction of the frame that has to change to count as movement. 0.05 clears encoder noise on a
# still screen while a page turn or the zoom is far above it.
SCENE_THRESHOLD="${SCENE_THRESHOLD:-0.05}"
# Used only if scene detection finds nothing at all (a take with no movement is already a failure,
# but the script should say something useful rather than divide by it).
TRIM_START="${TRIM_START:-2.0}"
# What counts as the screen holding rather than animating. Frames closer together than this are
# part of a movement; anything sparser is a hold (and the multi-second head of every take, while
# Maestro's driver starts up, is just a very long one).
STILL_GAP="${STILL_GAP:-0.4}"
# How much of each hold survives into the GIF. Without a cap the reference take ran 97s of
# stillness against 5.7s of movement; at zero the result reads as one frantic sequence with no
# beats between the steps.
HOLD="${HOLD:-0.35}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "!! $1 not found on PATH" >&2; exit 1; }; }
need maestro
need ffmpeg

RECORDER_PID=""
cleanup() {
  if [ -n "$RECORDER_PID" ] && kill -0 "$RECORDER_PID" 2>/dev/null; then
    kill -INT "$RECORDER_PID" 2>/dev/null || true
    wait "$RECORDER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ "$PLATFORM" = "ios" ]; then
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

# A normalised copy of the take, purely so a human can watch it. The raw file is awkward on
# purpose-built players and worse on general ones: simctl writes a QuickTime-branded mp4 at the
# simulator's full panel size (1206x2622 on the reference take, past the height a lot of hardware
# decoders accept) with multi-second gaps between frames — one reference take held its first frame
# for 50 seconds. VLC will not play it. Constant framerate, half size, standard brand fixes that.
"$FFMPEG" -v error -y -i "$RAW" -vf "fps=15,scale=-2:1280" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$WORK/demo-playable.mp4" 2>/dev/null \
  || echo "   (skipped the playable copy — no libx264 in this ffmpeg)" >&2

SIZE=$(du -h "$OUT" | cut -f1)
FRAMES=$("$FFMPEG" -v info -i "$OUT" -vf showinfo -f null - 2>&1 | grep -c 'pts_time:')
echo "==> Wrote $OUT ($SIZE, $FRAMES frames)"
echo "    raw capture kept at $RAW"
