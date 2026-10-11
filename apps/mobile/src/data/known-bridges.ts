import type { Bridge, MissingBridge } from './types';

/** The installed bridges plus the ones the library still references, the latter marked
 *  `installed: false`. An installed entry always wins: the two lists are fetched independently, so a
 *  just-reinstalled bridge can briefly be in both. */
export function knownBridges(installed: Bridge[], missing: MissingBridge[]): Map<string, Bridge> {
  const known = new Map<string, Bridge>();
  for (const b of installed) known.set(b.id, b);
  for (const m of missing) {
    if (known.has(m.id)) continue;
    known.set(m.id, {
      id: m.id,
      name: m.name ?? m.id,
      nsfw: m.nsfw ?? false,
      capabilities: m.capabilities ?? [],
      installed: false,
      ...(m.registryUrl !== undefined && { registryUrl: m.registryUrl }),
    });
  }
  return known;
}

/** The bridge a request is to — `/bridges/<id>/…` — if it is one. */
export function bridgeIdOfRequest(path: string): string | undefined {
  const m = /^\/bridges\/([^/?#]+)/.exec(path);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1];
  }
}

/** Whether a request went to a bridge the library knows is uninstalled — a failure the page explains
 *  already, so not one to report again. */
export function isMissingBridgeRequest(
  path: string | undefined,
  installed: readonly Bridge[],
  missing: readonly MissingBridge[],
): boolean {
  const id = path === undefined ? undefined : bridgeIdOfRequest(path);
  if (id === undefined) return false;
  return missing.some((m) => m.id === id) && !installed.some((b) => b.id === id);
}
