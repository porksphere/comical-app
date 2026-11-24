#!/usr/bin/env node
// The README's desktop screenshot: the demo web build photographed at the desktop app's window size.
//
//   node scripts/capture-desktop.mjs <base-url> <out-dir>
//
// Used by `.github/workflows/capture-demo.yml` alongside the iOS stills. It shoots the WEB build
// rather than the Electron app because the desktop app is a shell over that same build — the
// window's content is the page, and the shell adds only the OS's caption buttons, which would be
// a different set on every runner OS anyway. 1280x860 is the shell's default window size
// (apps/desktop/src/main.ts), so this is what a fresh install opens at.
//
// Browse, not a series page: the phone shots already have one, and Browse is where the wide layout
// differs most — the sidebar of sources and library shelves a phone keeps behind tabs.
import { chromium } from 'playwright';

const [base, out] = process.argv.slice(2);
if (!base || !out) {
  console.error('usage: capture-desktop.mjs <base-url> <out-dir>');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(base);
// The sidebar, not just a card. The exported page is prerendered in the PHONE layout and takes the
// wide one only once it has hydrated, which under a runner's software GL is seconds after the
// first cards are up: a shot gated on the cards alone caught the bottom tab bar at 1280 wide.
await page.getByTestId('sidebar.group.browse').waitFor({ timeout: 60000 });
await page.getByTestId(/^series-card\./).first().waitFor({ timeout: 30000 });
// Not 'networkidle' (the app polls, so the network is never idle), and not "every <img> complete"
// on its own: a cover's <img> isn't created until its URL resolves, so a grid can pass that check
// with half its covers still placeholders. Wait for the count of loaded covers to stop rising.
let loaded = -1;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(750);
  const now = await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth > 0).length);
  if (now === loaded) break;
  loaded = now;
}
// The bookshelf is a canvas, so none of the above sees it: its covers are decoded a few at a time
// after the page's own, and a book stands in plain cloth until its cover is in.
if (await page.getByTestId('home-bookshelf').count()) await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/04-desktop.png` });

await browser.close();
