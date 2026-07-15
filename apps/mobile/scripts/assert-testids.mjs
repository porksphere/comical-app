#!/usr/bin/env node
// The mandatory-testID CI gate.
//
// Reads ESLint JSON (from the FULL project lint) on stdin and exits non-zero iff the
// `comical/require-test-id` rule produced any error — i.e. an interactive element is missing a
// testID. Every OTHER rule is ignored here on purpose: the repo carries unrelated pre-existing lint
// debt (react-hooks/*, and import/no-unresolved for the not-checked-out @comical submodule), so a
// gate that failed on those would be red for reasons that have nothing to do with testIDs. Running
// the full config (rather than an isolated one) means all plugins are loaded, so inline
// `eslint-disable` directives referencing other rules resolve instead of erroring as "rule not found".
//
// Usage: eslint --format json "src/**/*.{ts,tsx}" | node scripts/assert-testids.mjs
import { readFileSync } from 'node:fs';

const RULE = 'comical/require-test-id';

let results;
try {
  results = JSON.parse(readFileSync(0, 'utf8'));
} catch (err) {
  console.error(`Could not parse ESLint JSON from stdin: ${err.message}`);
  process.exit(2);
}

const hits = [];
for (const file of results) {
  for (const msg of file.messages) {
    if (msg.ruleId === RULE) hits.push(`  ${file.filePath}:${msg.line}:${msg.column}  ${msg.message}`);
  }
}

if (hits.length > 0) {
  console.error(`✖ ${hits.length} interactive element(s) missing a testID (${RULE}):\n${hits.join('\n')}`);
  console.error('\nEvery interactive element must carry a testID so UI automation can select it across');
  console.error('iOS/Android/web. See src/lib/test-id.ts for the naming convention.');
  process.exit(1);
}

console.log(`✔ ${RULE}: every interactive element has a testID.`);
