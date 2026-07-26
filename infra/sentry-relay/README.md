# Sentry → Claude auto-fix pipeline

When a new **production** error-level issue appears in Sentry, Claude automatically investigates
it and opens a draft fix PR on this repo. Crashes from local testing and Expo dev clients
(`environment=development`, set via `__DEV__` in the app's `Sentry.init`) still log to Sentry as
usual but never trigger a fix run. Fully event-driven (Sentry webhooks, no polling) and authenticated with a
Claude **subscription** OAuth token (no metered API key).

```
Sentry issue created (error+)
  → internal-integration webhook (HMAC-signed)
  → this Cloudflare Worker (verifies signature, filters, holds the GitHub PAT)
  → opens GitHub issue "[<SHORT-ID>] <title>" (label: sentry)
  → .github/workflows/sentry-autofix.yml triggers on that issue
  → claude-code-action (subscription auth) fixes on claude/sentry-<SHORT-ID>
  → draft PR that closes the crash issue on merge
    (no confident fix → diagnosis posted as a comment on the crash issue;
     duplicate / dev-only / e2e-only → crash issue closed as "not planned")
```

The Worker exists only because Sentry can't create GitHub issues automatically (its ticket rules
support Jira/Azure DevOps only) and its webhooks can't attach the `Authorization` header GitHub's
API requires. The crash issue doubles as the durable record and conversation thread for each
crash.

## One-time setup

### 1. Deploy the Worker

```sh
cd infra/sentry-relay
npx wrangler deploy          # note the printed URL, e.g. https://comical-sentry-relay.<acct>.workers.dev
```

### 2. GitHub PAT for the Worker

Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Fine-grained tokens):
repository access = `porksphere/comical-app` only, permissions = **Contents: read and write**,
**Pull requests: read and write**, **Issues: read and write** (the Worker opens crash issues),
Metadata: read. Then:

```sh
npx wrangler secret put GITHUB_DISPATCH_TOKEN
```

Also save the same token as the `AUTOFIX_PAT` repo secret on GitHub. The workflow pushes the fix
branch and opens the draft PR with it instead of the default `GITHUB_TOKEN` — pushes/PRs made with
`GITHUB_TOKEN` don't trigger other workflows, so without this the draft PRs would get no CI.

Note: the workflow's issue gate only trusts crash issues authored by this PAT's owner
(`porksphere`, hardcoded in sentry-autofix.yml) — if the PAT is ever recreated under a different
account, update that check.

### 3. Sentry internal integration

Sentry → Settings → Developer Settings → **New internal integration**:

- **Webhook URL**: the Worker URL from step 1.
- **Alerts/Webhooks**: enable the **issue** webhook, action **created**.
- **Permissions**: Issue & Event: **Read** (lets the workflow fetch stack traces). Add
  Release: **Admin** if you also want CI sourcemap uploads to start working (the build workflows
  already accept `SENTRY_AUTH_TOKEN`).
- Copy the **client secret** (signs webhooks):

```sh
npx wrangler secret put SENTRY_CLIENT_SECRET
```

- Create a **token** on the integration and save it as the `SENTRY_AUTH_TOKEN` repo secret on
  GitHub (used by sentry-autofix.yml to fetch issue details, and by the build workflows for
  sourcemaps).

### 4. Claude subscription token

On a machine where Claude Code is logged in to your Claude subscription (Pro/Max):

```sh
claude setup-token
```

Save the printed token as the `CLAUDE_CODE_OAUTH_TOKEN` repo secret on GitHub. It's long-lived
(~1 year); regenerate and replace when it expires. Runs consume your subscription's usage limits —
the workflow caps each run with `--max-turns` and dedupes per issue.

### Secrets recap

| Where | Name | Purpose |
|---|---|---|
| Worker | `SENTRY_CLIENT_SECRET` | Verify webhook HMAC signatures |
| Worker | `GITHUB_DISPATCH_TOKEN` | Open crash issues on GitHub |
| GitHub repo | `CLAUDE_CODE_OAUTH_TOKEN` | Claude subscription auth for claude-code-action |
| GitHub repo | `SENTRY_AUTH_TOKEN` | Fetch issue/event details from the Sentry API |
| GitHub repo | `AUTOFIX_PAT` | Push fix branches / open draft PRs so CI triggers (can be the same token as `GITHUB_DISPATCH_TOKEN`) |

## Tuning

- **Which issues fire**: `MIN_LEVEL` in `wrangler.toml` (default `error`), plus whatever filtering
  you configure on the Sentry side. No workflow changes needed.
- **Dev/local crashes never autofix**: the workflow's environment guard checks the issue's
  environments via the Sentry API and proceeds only if `production` is among them (fails closed).
- **e2e CI crashes never autofix either**: e2e runs are Release builds (so `production` env); the
  guard additionally skips issues whose events all carry an `*-e2e` `buildChannel` tag.
  Caveat: an issue *first* seen in dev won't re-fire the webhook when it later hits production —
  use the manual workflow run for those; the guard passes once production events exist.
- **Dedupe**: one branch/PR per Sentry short ID; re-alerts and regressions short-circuit.
- **Manual run / retry**: Actions → "Sentry autofix" → Run workflow, with a Sentry short ID
  (e.g. `COMICAL-APP-1B`).

## Testing the pipeline

1. `npx wrangler dev`, then POST a captured webhook payload with a valid/invalid
   `Sentry-Hook-Signature` → expect 202 / 401.
2. Dry-run the workflow via workflow_dispatch with a real short ID → expect a
   `claude/sentry-<SHORT-ID>` branch and a draft PR (or a diagnosis issue).
3. End-to-end: resolve/unresolve an old Sentry issue and check the integration's Request Log for
   a 202 (URL + secret sanity), then throw a deliberate test error in a production-tagged build
   and watch: Sentry issue → GitHub crash issue → Actions run → draft PR closing the crash issue.
