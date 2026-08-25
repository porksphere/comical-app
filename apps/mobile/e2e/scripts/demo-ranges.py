"""Work out which slices of a screen recording belong in the demo GIF.

Reads the recording's frame timestamps on stdin (one per line, from ffmpeg's showinfo) and prints
an ffmpeg filter_complex to stdout, plus a human-readable summary on stderr.

WHY THIS EXISTS, and why the obvious one-liner is wrong. `simctl io recordVideo` and
`adb screenrecord` both write VARIABLE-framerate video: while the screen is still they emit no
frames at all, and during an animation they emit them at the device's real rate. On a reference
take that meant 284 frames across 103 seconds, of which 97.4s was stillness and only 5.7s held any
movement — at a median 17ms spacing, i.e. the simulator was rendering a smooth ~59fps throughout.

The tempting way to compress that is `mpdecimate,setpts=N/FPS/TB`: drop duplicate frames and
re-time what's left to a constant rate. It is wrong, and wrong in a way that looks like a rendering
bug rather than an encoding one. Re-timestamping DISCARDS DURATION, so playback speed becomes a
function of how many frames the encoder happened to emit rather than how long anything took: a
300ms zoom captured in 8 frames stretches to 533ms, while a 2s scroll captured in 3 frames
collapses to 200ms and appears to complete instantly. The first GIF built that way played parts of
itself at 4x slow motion and parts at 10x speed.

So instead: keep real timestamps, cut the dead air by SELECTING TIME RANGES, and let a plain `fps`
filter resample to the target rate. Each still stretch is trimmed down to `hold` seconds rather
than removed outright, so the result still has beats in it instead of reading as one frantic
sequence.
"""

import sys


def main() -> int:
    if len(sys.argv) != 7:
        print(
            "usage: demo-ranges.py STILL_GAP HOLD LEAD TAIL FPS SCALE_FILTERS < frame-timestamps",
            file=sys.stderr,
        )
        return 2

    still_gap, hold, lead, tail = (float(a) for a in sys.argv[1:5])
    fps, tail_filters = sys.argv[5], sys.argv[6]

    ts = sorted(float(line) for line in sys.stdin if line.strip())
    if len(ts) < 2:
        print("!! fewer than two frames in the recording", file=sys.stderr)
        return 1

    # Movement is where frames are dense. Anything separated by more than `still_gap` from its
    # neighbour is the screen holding — which is also how the launcher/driver-startup lead-in at
    # the head of every take identifies itself, without needing a separate scene-detection pass.
    dense = [i for i in range(len(ts) - 1) if ts[i + 1] - ts[i] <= still_gap]
    if not dense:
        print("!! no movement found — the app never animated during the take", file=sys.stderr)
        return 1
    first, last = ts[dense[0]], ts[dense[-1] + 1]

    lo, hi = max(0.0, first - lead), last + tail
    window = [t for t in ts if lo <= t <= hi]

    ranges, seg_start, prev = [], lo, None
    for t in window:
        if prev is not None and t - prev > still_gap:
            ranges.append((seg_start, min(prev + hold, t)))
            seg_start = t
        prev = t
    ranges.append((seg_start, hi))
    # Sub-frame slivers survive concat as duplicated frames rather than as anything visible.
    ranges = [(a, b) for a, b in ranges if b - a > 0.02]

    motion = [ts[i + 1] - ts[i] for i in dense]
    motion.sort()
    median = motion[len(motion) // 2]
    print(
        f"    movement {first:.1f}s-{last:.1f}s of {ts[-1]:.1f}s recorded; "
        f"in-motion cadence {median * 1000:.0f}ms median (~{1 / median:.0f}fps), "
        f"worst {motion[-1] * 1000:.0f}ms",
        file=sys.stderr,
    )
    print(
        f"    keeping {len(ranges)} range(s), {sum(b - a for a, b in ranges):.1f}s of {hi - lo:.1f}s "
        f"(holds capped at {hold:.2f}s)",
        file=sys.stderr,
    )

    # `setpts=PTS-STARTPTS` rebases each slice to its own zero so concat can butt them together;
    # within a slice the original spacing — and so the real speed of the animation — is untouched.
    parts = [f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[s{i}]" for i, (a, b) in enumerate(ranges)]
    joined = "".join(f"[s{i}]" for i in range(len(ranges)))
    print(
        ";".join(parts)
        + f";{joined}concat=n={len(ranges)}:v=1[cut];"
        + f"[cut]fps={fps},{tail_filters}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
