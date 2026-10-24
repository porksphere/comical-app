#!/usr/bin/env node
/**
 * Synthesises the hold-to-arm ramp's sounds (`useRampedHold`) into assets/sounds/. Generated rather
 * than sourced so there is no licence to carry and the ramp can be retuned by editing numbers:
 * `node scripts/gen-hold-sounds.mjs`, then commit the WAVs.
 *
 * Three countdown ticks climbing an E-major arpeggio, getting louder as the haptics get stronger,
 * then the commit: lower and fuller, a fifth with a thump under it, so the arm reads as an arrival
 * rather than a fourth tick. Every voice is a woodblock-style strike — an inharmonic overtone, a
 * pitch that drops in the first few ms, and a burst of noise for the contact — because a pure sine
 * at this length is a beep, not a tap.
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
  // A 1ms attack and 15ms release, so neither edge of the clip is a click of its own.
  const attack = RATE / 1000;
  const release = (RATE * 15) / 1000;
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

/** 2.76 is a woodblock's first overtone; it is what keeps the tick from sounding like a beep. */
const tick = (freq, peak) =>
  render(70, peak, (out) => {
    strike(out, { freq, partials: [[1, 1, 16], [2.76, 0.35, 7]] });
    contact(out, { gain: 0.5 });
  });

const sounds = {
  'hold-1.wav': tick(1318.5, 0.35), // E6
  'hold-2.wav': tick(1661.2, 0.5), // G#6
  'hold-3.wav': tick(1975.5, 0.65), // B6
  'hold-arm.wav': render(320, 0.85, (out) => {
    strike(out, { freq: 659.3, partials: [[1, 1, 90], [1.5, 0.55, 70], [2, 0.3, 45], [5.4, 0.12, 10]], bend: 0.02 }); // E5 + B5
    strike(out, { freq: 140, partials: [[1, 0.9, 28]], bend: 0.3, bendMs: 12 });
    contact(out, { gain: 0.6, decayMs: 3 });
  }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(join(OUT, name), wav(samples));
  console.log(`${name}  ${samples.length} samples`);
}
