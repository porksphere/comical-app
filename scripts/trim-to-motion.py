#!/usr/bin/env python3
"""Cut a screen recording down to the one stretch where the screen was moving, as an MP4 and a GIF.

    python3 scripts/trim-to-motion.py <recording> <out.mp4> [--gif out.gif] [--width 600] [--gif-width 360]

Used by `.github/workflows/capture-page-turn.yml`. A recording of a gesture has to start before the
gesture and end after it, and how long before is not something the script that sends the gesture
knows: on the iPhone it is however long Maestro's driver took to come up. So the recording is left
long, and this finds the turns in it instead of being told where they are.

"Moving" is a frame that differs from the one before it. The stretches of movement are grouped
into bursts, a burst ending where the screen then holds still for `--still` seconds, and the burst
kept is the one with the most movement in it, not the last: the reader's bar fading out on its own
timer some seconds after the last turn is a burst too, and a small one.

Exits 1 when nothing moved. That is the gesture not landing, and a clip of a still page is not a
result to upload.

Needs ffmpeg and Pillow.
"""
import argparse
import glob
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageStat

# Frames a second the recording is sampled at to look for movement, and how small they are made.
# A page turning moves most of the screen, so neither needs to be fine.
SAMPLE_FPS = 10
SAMPLE_WIDTH = 96
# Mean difference between two samples, of 255, above which the screen is moving. A still screen's
# is the encoder's noise, a few hundredths; a turn's is in the tens.
MOVING = 0.6


def bursts(moving, gap):
    """`moving` (one flag a sample) as `(first, last)` runs of movement, runs joined across any
    stillness shorter than `gap` samples."""
    out = []
    for i, m in enumerate(moving):
        if not m:
            continue
        if out and i - out[-1][1] <= gap:
            out[-1][1] = i
        else:
            out.append([i, i])
    return [tuple(b) for b in out]


def busiest(diffs, still_seconds):
    """The burst with the most movement in it, as `(first, last)` sample indices, or None."""
    found = bursts([d > MOVING for d in diffs], round(still_seconds * SAMPLE_FPS))
    if not found:
        return None
    return max(found, key=lambda b: sum(diffs[b[0]:b[1] + 1]))


def sample_diffs(recording):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-i', recording, '-vf', f'fps={SAMPLE_FPS},scale={SAMPLE_WIDTH}:-2,format=gray',
             os.path.join(tmp, '%06d.png')],
            check=True,
        )
        frames = sorted(glob.glob(os.path.join(tmp, '*.png')))
        diffs = [0.0]
        previous = Image.open(frames[0]).convert('L') if frames else None
        for path in frames[1:]:
            frame = Image.open(path).convert('L')
            diffs.append(ImageStat.Stat(ImageChops.difference(previous, frame)).mean[0])
            previous = frame
        return diffs if frames else []


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('recording')
    parser.add_argument('mp4')
    parser.add_argument('--gif')
    parser.add_argument('--width', type=int, default=600)
    parser.add_argument('--gif-width', type=int, default=360)
    parser.add_argument('--still', type=float, default=4.0, help='seconds of stillness that end a burst')
    parser.add_argument('--lead', type=float, default=0.7, help='seconds kept before the first movement')
    parser.add_argument('--tail', type=float, default=1.0, help='seconds kept after the last')
    args = parser.parse_args()

    diffs = sample_diffs(args.recording)
    kept = busiest(diffs, args.still)
    if kept is None:
        sys.exit(f'!! nothing moved in {args.recording} ({len(diffs) / SAMPLE_FPS:.1f}s)')
    start = max(0.0, kept[0] / SAMPLE_FPS - args.lead)
    end = min(len(diffs) / SAMPLE_FPS, kept[1] / SAMPLE_FPS + args.tail)
    print(f'  {args.recording}: {len(diffs) / SAMPLE_FPS:.1f}s recorded, keeping {start:.1f}s to {end:.1f}s')

    cut = ['-ss', f'{start:.2f}', '-to', f'{end:.2f}', '-i', args.recording, '-an']
    # yuv420p and an even height are what a browser's and QuickTime's H.264 decoders ask for.
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', *cut, '-vf', f'scale={args.width}:-2', '-c:v', 'libx264', '-crf', '20',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.mp4],
        check=True,
    )
    if args.gif:
        # A palette of the clip's own colours: the default one bands a painted page badly.
        look = f'fps=20,scale={args.gif_width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', *cut, '-filter_complex', look, args.gif], check=True)
    for path in filter(None, (args.mp4, args.gif)):
        print(f'  {path}: {os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    main()
