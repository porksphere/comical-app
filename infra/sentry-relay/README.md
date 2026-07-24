# Sentry → Claude auto-fix pipeline

When a new error-level issue appears in Sentry, Claude automatically investigates it and opens a
draft fix PR on this repo. Fully event-driven (Sentry webhooks, no polling) and authenticated with a
Claude **subscription** OAuth token (no metered API key).

```
Sentry issue created (error+)
  → internal-integration webhook (HMAC-signed)
  → this Cloudflare Worker (verifies signature, filters, holds the GitHub PAT)
  → repository_dispatch: sentry-issue
  → .github/workflows/sentry-autofix.yml
  → claude-code-action (subscription auth) fixes on claude/sentry-<SHORT-ID>
  → draft PR linking back to the Sentry issue
```

The Worker exists only because Sentry webhooks can't attach the `Authorization` header GitHub's
`repository_dispatch` API requires.

## One-time setup

### 1. Deploy the Worker

```sh
cd infra/sentry-relay
npx wrangler deploy          # note the printed URL, e.g. https://comical-sentry-relay.<acct>.workers.dev
```

### 2. GitHub PAT for the Worker

Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Fine-grained tokens):
repository access = `porksphere/comical-app` only, permissions = **Contents: read and write**
(required for the dispatches endpoint), **Pull requests: read and write**, Metadata: read. Then:

```sh
npx wrangler secret put GITHUB_DISPATCH_TOKEN
```

Also save the same token as the `AUTOFIX_PAT` repo secret on GitHub. The workflow pushes the fix
branch and opens the draft PR with it instead of the default `GITHUB_TOKEN` — pushes/PRs made with
`GITHUB_TOKEN` don't trigger other workflows, so without this the draft PRs would get no CI.

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
| Worker | `GITHUB_DISPATCH_TOKEN` | Call the repository_dispatch API |
| GitHub repo | `CLAUDE_CODE_OAUTH_TOKEN` | Claude subscription auth for claude-code-action |
| GitHub repo | `SENTRY_AUTH_TOKEN` | Fetch issue/event details from the Sentry API |
| GitHub repo | `AUTOFIX_PAT` | Push fix branches / open draft PRs so CI triggers (can be the same token as `GITHUB_DISPATCH_TOKEN`) |

## Tuning

- **Which issues fire**: `MIN_LEVEL` in `wrangler.toml` (default `error`), plus whatever filtering
  you configure on the Sentry side. No workflow changes needed.
- **Dedupe**: one branch/PR per Sentry short ID; re-alerts and regressions short-circuit.
- **Manual run / retry**: Actions → "Sentry autofix" → Run workflow, with a Sentry short ID
  (e.g. `COMICAL-APP-1B`).

## Testing the pipeline

1. `npx wrangler dev`, then POST a captured webhook payload with a valid/invalid
   `Sentry-Hook-Signature` → expect 200 / 401.
2. Dry-run the workflow via workflow_dispatch with a real short ID → expect a
   `claude/sentry-<SHORT-ID>` branch and a draft PR.
3. End-to-end: throw a deliberate test error in a dev build, watch it flow through
   (Sentry issue → Worker log → Actions run → draft PR), then clean up the test issue/PR.
