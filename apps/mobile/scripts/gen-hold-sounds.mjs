#!/usr/bin/env node
/**
 * Synthesises the hold-to-arm ramp's sounds (`useRampedHold`) into assets/sounds/. Generated rather
 * than sourced so there is no licence to carry and the ramp can be retuned by editing numbers:
 * `node scripts/gen-hold-sounds.mjs`, then commit the WAVs.
 *
 * Modelled on the Apple Watch Digital Crown's detent: a click, not a note. Each one is a few
 * milliseconds of high, inharmonic resonance over a sub-millisecond contact, so nothing in it lasts
 * long enough to be heard as a pitch; a click that rings for 15ms+ reads as a woodblock or a beep.
 * The countdown's three get louder and a little heavier as the haptics do, the way a detent feels
 * firmer the harder it is pushed, and the commit is the same click with a short low body under it,
 * so it lands as a detent bottoming out rather than as a sound of its own.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

// Seeded, so regenerating without a change reproduces the same bytes.
let seed = 0x2f6b1d;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x80000000 - 1;
};

/** One struck voice: `partials` are [ratio, gain, decay ms] over a fundamental that starts `bend`
 *  sharp and falls to pitch over `bendMs`. */
function strike(out, { freq, partials, bend = 0.04, bendMs = 5, gain = 1 }) {
  for (const [ratio, partialGain, decayMs] of partials) {
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / RATE;
      const f = freq * ratio * (1 + bend * Math.exp(-(t * 1000) / bendMs));
      phase += (2 * Math.PI * f) / RATE;
      out[i] += gain * partialGain * Math.sin(phase) * Math.exp(-(t * 1000) / decayMs);
    }
  }
}

/** The contact: a few ms of noise, first-differenced so it is a click rather than a hiss. */
function contact(out, { gain, decayMs = 2 }) {
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const n = noise();
    out[i] += gain * (n - prev) * 0.5 * Math.exp(-((i / RATE) * 1000) / decayMs);
    prev = n;
  }
}

function render(ms, peak, build) {
  const out = new Float64Array(Math.round((RATE * ms) / 1000));
  build(out);
  // The attack is short enough to keep the transient's snap; the release only has to stop the tail
  // being cut off mid-sample.
  const attack = (RATE * 0.1) / 1000;
  const release = (RATE * 4) / 1000;
  for (let i = 0; i < out.length; i++) {
    out[i] *= Math.min(1, i / attack, (out.length - i) / release);
  }
  const max = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return out.map((v) => (v / max) * peak);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** The detent's modes, as [ratio, gain, decay ms]: inharmonic so they never agree on a pitch, and
 *  gone within a few ms. `weight` lowers them and lets them ring fractionally longer. */
const click = (out, { weight = 0, gain = 1 }) => {
  const k = 1 + weight;
  strike(out, {
    freq: 3400 / k,
    partials: [[1, 1, 1.4 * k], [1.71, 0.6, 0.8 * k], [0.58, 0.35, 2.2 * k], [2.43, 0.3, 0.5]],
    bend: 0,
    gain,
  });
  contact(out, { gain: 0.9 * gain, decayMs: 0.35 });
};

const tick = (weight, peak) => render(18, peak, (out) => click(out, { weight }));

const sounds = {
  'hold-1.wav': tick(0, 0.3),
  'hold-2.wav': tick(0.06, 0.42),
  'hold-3.wav': tick(0.12, 0.55),
  'hold-arm.wav': render(40, 0.85, (out) => {
    click(out, { weight: 0.22 });
    // The body: low enough to feel like mass rather than a note, and over before it can sing.
    strike(out, { freq: 420, partials: [[1, 0.8, 6], [2.3, 0.3, 3]], bend: 0.25, bendMs: 2 });
  }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(join(OUT, name), wav(samples));
  console.log(`${name}  ${samples.length} samples`);
}
