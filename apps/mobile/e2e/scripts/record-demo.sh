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
RAW="$WORK/demo.mp4"

# Output tuning. WIDTH is the GIF's width in px; the phone aspect makes the height ~2.1x that,
# so 420 lands near 420x900 — big enough to read chapter titles on a README, small enough to stay
# a couple of MB.
WIDTH="${WIDTH:-420}"
FPS="${FPS:-15}"
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
# A gap longer than this between two recorded frames is a visible hitch. ~1/12s: at the 15fps the
# GIF is rendered at, anything beyond this drops a frame the viewer sees.
MAX_GAP_MS="${MAX_GAP_MS:-85}"

FFMPEG="${FFMPEG:-ffmpeg}"
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

echo "==> Finding the moving part of the take"
# `select` + `metadata=print` over a normal file input, deliberately not the `-f lavfi -i
# "movie=…"` form: that one selects the right frames but rebases their timestamps to zero, so
# every detection reports 0s and the trim silently does nothing.
SCENES=$("$FFMPEG" -v error -i "$RAW" -vf "select='gt(scene,$SCENE_THRESHOLD)',metadata=print:file=-" \
  -f null - 2>/dev/null | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 || true)
if [ -n "$SCENES" ]; then
  FIRST_MOVE=$(printf '%s\n' "$SCENES" | head -1)
  LAST_MOVE=$(printf '%s\n' "$SCENES" | tail -1)
  START=$(awk -v f="$FIRST_MOVE" -v l="$LEAD_IN" 'BEGIN { s = f - l; print (s > 0 ? s : 0) }')
  DURATION=$(awk -v s="$START" -v l="$LAST_MOVE" -v t="$TAIL_OUT" 'BEGIN { print l + t - s }')
  echo "    movement from ${FIRST_MOVE}s to ${LAST_MOVE}s -> clip ${START}s +${DURATION}s"
else
  echo "!! No scene changes detected — the app may never have moved. Falling back to a fixed trim." >&2
  START="$TRIM_START"
  DURATION=""
fi

echo "==> Checking for dropped frames"
# Both recorders write variable-framerate mp4, so a frame the device never rendered shows up as a
# long gap between presentation timestamps rather than as a missing entry. Only the part that ends
# up in the GIF is measured — a hitch in the dead air before the first tap is not a defect.
# Frame timestamps come from ffmpeg's own showinfo rather than ffprobe: the frame field ffprobe
# exposes for this was renamed across major versions (`pkt_pts_time` is gone in 7.x), and the
# runner installs whatever brew ships today. showinfo's format has been stable throughout.
GAP_REPORT=$("$FFMPEG" -v info -i "$RAW" -vf showinfo -f null - 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 \
  | awk -v trim="$START" '
      $1 == "" { next }
      { t = $1 + 0; if (t < trim) next; if (prev != "") { g = (t - prev) * 1000; if (g > max) { max = g; at = prev } } prev = t }
      END { printf "%.1f %.2f", max, at }')
MAX_GAP=${GAP_REPORT% *}
GAP_AT=${GAP_REPORT#* }
echo "    worst inter-frame gap: ${MAX_GAP}ms (at ${GAP_AT}s), budget ${MAX_GAP_MS}ms"
if awk -v m="$MAX_GAP" -v b="$MAX_GAP_MS" 'BEGIN { exit !(m > b) }'; then
  echo "!! The device dropped frames during the take, so the GIF would stutter." >&2
  echo "!! Re-run: this is usually contention on the host, not the app. Raw file kept at $RAW" >&2
  exit 2
fi

echo "==> Encoding GIF"
mkdir -p "$(dirname "$OUT")"
# Two passes over one input: palettegen builds a 256-colour palette from the actual frames
# (stats_mode=diff weights the moving parts, which is where banding shows), paletteuse applies it.
# An `if`, not `[ -n ... ] && ...`: under `set -e` the && form exits the script when DURATION is
# empty, because the test failing makes the whole line's status non-zero.
DURATION_ARG=()
if [ -n "$DURATION" ]; then
  DURATION_ARG=(-t "$DURATION")
fi
"$FFMPEG" -v error -y -ss "$START" "${DURATION_ARG[@]}" -i "$RAW" \
  -vf "fps=$FPS,scale=$WIDTH:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "==> Wrote $OUT ($SIZE)"
echo "    raw capture kept at $RAW"
