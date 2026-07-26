// Sentry → GitHub relay.
//
// Sentry's Integration Platform webhooks cannot attach an Authorization header, so they can't call
// GitHub's repository_dispatch API directly. This Worker sits in between: it receives the (HMAC-
// signed) "issue created" webhook from a Sentry internal integration, verifies the signature,
// filters out noise, and forwards a compact payload to GitHub as a `sentry-issue` dispatch event,
// which .github/workflows/sentry-autofix.yml consumes.
//
// Secrets (set with `wrangler secret put <NAME>`):
//   SENTRY_CLIENT_SECRET   Client secret of the Sentry internal integration (signs webhooks).
//   GITHUB_DISPATCH_TOKEN  Fine-grained PAT scoped to the repo, Contents: read+write.
//
// Optional vars (wrangler.toml [vars]):
//   GITHUB_REPO   owner/repo to dispatch to (default porksphere/comical-app).
//   MIN_LEVEL     Minimum issue level to forward: debug|info|warning|error|fatal (default error).

const LEVELS = ['debug', 'info', 'warning', 'error', 'fatal'];

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }

    const body = await request.text();

    if (!(await verifySignature(body, request.headers.get('sentry-hook-signature'), env.SENTRY_CLIENT_SECRET))) {
      return new Response('invalid signature', { status: 401 });
    }

    // Sentry sends installation lifecycle events and others to the same URL; only brand-new issues
    // should trigger an autofix run.
    if (request.headers.get('sentry-hook-resource') !== 'issue') {
      return new Response('ignored: not an issue event', { status: 200 });
    }

    const payload = JSON.parse(body);
    if (payload.action !== 'created') {
      return new Response('ignored: not issue creation', { status: 200 });
    }

    const issue = payload.data?.issue;
    if (!issue) {
      return new Response('ignored: no issue in payload', { status: 200 });
    }

    const minLevel = LEVELS.indexOf(env.MIN_LEVEL || 'error');
    if (LEVELS.indexOf(issue.level) < minLevel) {
      return new Response(`ignored: level ${issue.level} below threshold`, { status: 200 });
    }

    // Answer Sentry immediately and talk to GitHub in the background: Sentry's webhook timeout
    // is short, and a cold start plus a synchronous GitHub API round-trip can exceed it (delivery
    // then shows "timeout" in the integration's Request Log even though the call succeeded).
    // Failures land in the Worker logs (`wrangler tail` / dashboard), not the Sentry log.
    ctx.waitUntil(createGitHubIssue(env, issue));
    return new Response('accepted', { status: 202 });
  },
};

// Opens a GitHub issue for the crash; .github/workflows/sentry-autofix.yml triggers on it. The
// HTML-comment marker on the FIRST body line is the machine-readable contract the workflow parses
// (strict regex, first match wins — which is why crash-controlled text is sanitized of <> and the
// marker leads the body: a crash title can't smuggle in a fake marker ahead of the real one).
async function createGitHubIssue(env, issue) {
  const repo = env.GITHUB_REPO || 'porksphere/comical-app';
  const shortId = issue.shortId;
  const webUrl = issue.permalink || `https://sentry.io/organizations/comical/issues/${issue.id}/`;
  const clean = (s, n) => (s || '').replace(/[<>]/g, '').slice(0, n);
  const title = clean(issue.title, 150) || 'untitled crash';
  const culprit = clean(issue.culprit, 200);
  const body = [
    `<!-- sentry-autofix v1 short_id=${shortId} issue_id=${issue.id} -->`,
    `Sentry reported a new **${issue.level}** issue: **[${shortId}](${webUrl})** — ${title}`,
    culprit ? `\nCulprit: \`${culprit}\`` : '',
    '',
    'The autofix workflow will investigate and either open a draft fix PR (closing this issue on',
    'merge) or post a diagnosis below. Duplicate, dev-only, and e2e-only crashes are closed as',
    'not planned; the Sentry issue itself stays open either way.',
  ].join('\n');

  const create = (labels) =>
    fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'comical-sentry-relay',
      },
      body: JSON.stringify({ title: `[${shortId}] ${title}`, body, ...(labels && { labels }) }),
    });

  let resp = await create(['sentry']);
  if (resp.status === 422) resp = await create(null); // label may not exist yet — retry without
  if (!resp.ok) {
    console.error(`github issue creation failed for ${shortId}: ${resp.status} ${await resp.text()}`);
  } else {
    console.log(`opened crash issue for ${shortId}`);
  }
}

// Sentry signs the raw body with HMAC-SHA256 (hex) using the integration's client secret.
async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time comparison.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
