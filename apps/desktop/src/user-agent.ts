/**
 * The desktop's platform User-Agent: Electron's own default, unchanged. Bridges are given it
 * (`getDefaultUserAgent`), so a bridge that adopts it sends exactly what the web check window does,
 * and the window then runs with its User-Agent untouched.
 *
 * Untouched matters: anti-bot checks compare the User-Agent with what the engine reports about
 * itself (version, platform, client hints), and overriding a session's User-Agent, even with a
 * near-identical string, makes Chromium drop the matching client hints. Cloudflare's check then
 * fails and asks again forever (found 2026-11-15: hidden, the default passed by itself in seconds;
 * any override never did). So nothing here is stripped or rewritten.
 */
export function platformUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent;
}

/** Whether a web check for `requested` must override the window's User-Agent. */
export function needsOverride(requested: string | undefined, defaultUserAgent: string): requested is string {
  return !!requested && requested !== defaultUserAgent;
}
