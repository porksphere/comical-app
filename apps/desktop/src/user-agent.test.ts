import { expect, test } from "bun:test";
import { needsOverride, platformUserAgent } from "./user-agent.ts";

const ELECTRON = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) comical/0.4.0 Chrome/152.0.7977.167 Electron/44.9.3 Safari/537.36";

test("the platform User-Agent is Electron's own, unchanged", () => {
  expect(platformUserAgent(ELECTRON)).toBe(ELECTRON);
});

test("a web check overrides the window's User-Agent only for a different one", () => {
  expect(needsOverride(ELECTRON, ELECTRON)).toBe(false);
  expect(needsOverride(undefined, ELECTRON)).toBe(false);
  expect(needsOverride("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", ELECTRON)).toBe(true);
});
