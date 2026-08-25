#!/usr/bin/env node
// Advisory-only React Compiler coverage check. Never fails the job — a nudge, like
// check-flow-coverage.mjs, not a gate.
//
// `app.json` turns the React Compiler on for the whole app, but a component can opt itself out
// WITHOUT SAYING SO, and two ways of doing that are easy to write by accident:
//
//   1. Any `eslint-disable` of a `react-hooks/*` rule inside the function. The compiler refuses to
//      reason about a component whose hook rules were waived — the whole component, not the line.
//   2. A construct it cannot lower (a default parameter computed from another parameter, say).
//
// Either way the component keeps working and quietly loses all of its memoization: every derived
// value recomputed and every child element rebuilt on every render, however unrelated the state
// that caused it. That is invisible in review, invisible at runtime, and expensive exactly where
// components are biggest — a 2400-line screen re-rendering inside a swipe animation is what
// prompted this script.
//
// The three sanctioned suppression cases (see AGENTS.md → "Suppressing a React Compiler rule")
// haven't gone anywhere. What they need is a HOME: put the suppressed effect in a hook of its own
// and the suppression costs those few lines instead of the component around them
// (src/hooks/use-mount-effect.ts is the pattern).
//
// Usage: node scripts/check-compiler-bails.mjs   (run from apps/mobile)
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
const SRC = join(ROOT, 'src');

// Functions this small are not worth a warning: a bailing five-line hook is the RECOMMENDED place
// for a suppression, so warning about it would be telling people off for following the advice.
const MIN_LINES = 25;

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
  }
})(SRC);

const skipped = [];
for (const file of files) {
  const events = [];
  try {
    babel.transformFileSync(file, {
      filename: file,
      babelrc: false,
      configFile: false,
      // Types stripped, nothing resolved: this pass only needs to parse and compile, so it runs
      // without the submodule and without Metro's resolver.
      presets: [[require.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }]],
      plugins: [
        [
          require.resolve('babel-plugin-react-compiler'),
          { target: '19', logger: { logEvent: (_f, event) => events.push(event) } },
        ],
      ],
    });
  } catch {
    continue; // a parse failure is lint's business, not this script's
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  const seen = new Set();
  for (const event of events) {
    if (event.kind !== 'CompileError' || !event.fnLoc) continue;
    const { start, end } = event.fnLoc;
    if (seen.has(start.line)) continue; // one function, however many suppressions inside it
    seen.add(start.line);
    const size = end.line - start.line;
    if (size < MIN_LINES) continue;
    skipped.push({
      file: relative(ROOT, file).replace(/\\/g, '/'),
      line: start.line,
      size,
      name: (lines[start.line - 1] || '').trim().slice(0, 60),
      reason: String(event.detail?.reason ?? event.detail?.description ?? '').split('\n')[0],
    });
  }
}

skipped.sort((a, b) => b.size - a.size);
for (const s of skipped) {
  // `::warning::` so it surfaces on the PR's Checks tab / Files view, like the flow-coverage nudge.
  console.log(
    `::warning file=apps/mobile/${s.file},line=${s.line}::React Compiler skipped ${s.name} (${s.size} lines) — ${s.reason}`,
  );
}
console.log(
  skipped.length
    ? `\n${skipped.length} function(s) of ${MIN_LINES}+ lines are not compiled. See scripts/check-compiler-bails.mjs.`
    : `\nEvery function of ${MIN_LINES}+ lines compiles.`,
);
process.exit(0);
