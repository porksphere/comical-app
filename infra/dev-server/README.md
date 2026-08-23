# Remote Expo dev server

Iterate on the app **on your phone, in real time, with no PC running Metro.** A small always-on box
follows whichever open PR was pushed to most recently, serves it to the dev-client build over
Tailscale, and lets Claude read what your device is doing.

```
Claude (any session)  --git push-->  GitHub PR
                                       |
                    git ls-remote poll (15s, no webhook, no inbound)
                                       v
                          the box: watch-prs.sh
                                       |
                         checkout + (restart Metro if needed)
                                       v
                         Metro :8081 --Tailscale--> your phone (dev-client build)
                                       ^
                                       +----------- Claude reads Metro + device logs
```

Same codebase and same dev-client shell as the LAN loop in
[docs/PROFILING.md](../../docs/PROFILING.md) → "Iterative dev & profiling from Windows". The only
change is that Metro lives on a box on your tailnet instead of your desk, so nothing depends on
your PC being awake.

## Why an open PR and not a branch

The unit of work-in-flight in this repo is an open PR — that is what `ios-pr-<N>` / `android-pr-<N>`
key on, and what `refresh-ios-pr-source.sh` aggregates. The dev server reuses that rule exactly, so
the SideStore source, the APK channels and the dev server all agree on what is live, and closing a
PR retires it everywhere at once.

Consequence: **a branch with no PR is never served.** Drafts count, and `sentry-autofix.yml` already
opens drafts, so this asks nothing new of Claude beyond opening one.

Selection, fallback and the deliberately-cautious handling of an indeterminate PR state are
documented at the top of [`watch-prs.sh`](watch-prs.sh).

## Why not GitHub Pages

`deploy-web.yml` already gives every branch a Pages preview, and that is the right tool for sharing
a build — but it can never be this. Metro compiles per request (`?platform=ios&dev=true`), pushes
Fast Refresh over a websocket, and symbolicates stack traces the phone POSTs back. Pages serves
static files with no compute, no POST and no websockets. It can host the *output* of a build, never
the builder. A Pages preview also has no backend, so it is stuck in `DEMO_MODE`; this box runs
`host-server` alongside Metro and gets real data.

## One-time setup

### 1. The box

**4GB minimum**, and that is measured, not padding. Metro peaks at **2.3GB RSS** while building a
cold graph (~4000 modules, web) and settles to ~1GB once it is serving. A 2GB box gets Metro
OOM-killed partway through every cold start, so the cheap tier is not an option at any provider.
Two cores is enough — bundling is mostly single-threaded and the box never builds a binary.

Ubuntu 24.04. Any comparable VPS works; the provider barely matters here because Tailscale removes
inbound firewall rules, TLS and DNS from the decision. Prefer a **US region** if you are in the US
— the first bundle is several MB over the tunnel — but a EU box is a real option if the US 4GB tier
is priced badly: Fast Refresh deltas are small enough that the added RTT is invisible, and it only
costs a few seconds on a cold start.

> If you already run `host-server` somewhere persistent, **use that machine instead** — colocating
> Metro and the backend is what gets the dev build real data.

### 2. GitHub

Nothing to configure on the repo. No webhook, no repo secret, no workflow — the box pulls. The only
GitHub-side artifact is a token:

**Fine-grained PAT** (Settings → Developer settings → Fine-grained tokens):

- Repository access: **`porksphere/comical-app` and `porksphere/comical`** — the submodule is a
  separate repo and fetches independently; a token scoped to only the app repo fails at
  `git submodule update` with a confusing 404.
- Permissions: **Contents: read**, **Pull requests: read**, Metadata: read.

Read-only throughout. The box never pushes.

### 3. Bootstrap

```sh
curl -fsSL https://raw.githubusercontent.com/porksphere/comical-app/main/infra/dev-server/bootstrap.sh | sudo bash
# writes /etc/comical-dev/env and stops — fill in GH_TOKEN and the MagicDNS name, then:
sudo bash bootstrap.sh
tailscale up --hostname=comical-dev --advertise-tags=tag:devserver
comical-dev status
```

Use a **reusable, tagged** auth key for the box (Tailscale admin → Settings → Keys). Tagged keys
don't expire at 90 days; an untagged one silently drops the box off the tailnet after three months.

### 4. Your phone

Join it to the tailnet, then install the dev-client shell if you don't have it: run
**Build iOS dev-client** (`build-ios-devclient.yml`, manual dispatch) and add the `ios-devclient`
source in SideStore. Open the app and point its launcher at the URL `comical-dev status` prints:

```
exp://comical-dev.tailXXXX.ts.net:8081
```

Only **native** changes need a new shell from that workflow — a new native module, a config plugin,
an SDK bump. Everything else arrives over Metro.

### 5. Claude Code remote environments

So Claude can read Metro's output and your device's console/redbox logs instead of pushing blind.

In the environment config at [claude.ai/code](https://claude.ai/code) → Environments, set:

| Variable | Value |
| --- | --- |
| `TS_AUTHKEY` | Tailscale auth key — **ephemeral** + reusable + tagged `tag:ci` |
| `COMICAL_DEV_HOST` | `comical-dev.tailXXXX.ts.net` |

**Ephemeral is not optional.** These containers are reclaimed on idle, and a non-ephemeral key
leaves a dead node behind for every session that ever ran.

Then wire [`claude-session-join.sh`](claude-session-join.sh) as a SessionStart hook in
`.claude/settings.json`. It no-ops when `TS_AUTHKEY` is unset, so local sessions and CI are
unaffected. Give `tag:ci` read-only access to the box in your tailnet ACLs — those sessions need to
reach Metro, not administer it.

## Day to day

```sh
comical-dev status          # what is being served
comical-dev pin 124         # hold PR #124 through other pushes (mid-review)
comical-dev unpin
comical-dev logs metro      # Metro + your device's console.log and redboxes
comical-dev logs watch      # what the follower is deciding and why
```

Push to an open PR and the phone updates. Same branch, JS only: a few seconds, hot-reloaded in
place. Branch switch: ~20s, Metro restarts (8s warm) and the device reconnects. Compare ~4.5 min
for a Pages preview.

Metro restarts on a branch switch rather than trusting its watcher, because a checkout that
rewrites hundreds of files is exactly where watchers drop events. `watchman` is installed for the
same reason — without it Metro falls back to a plain crawl.

## Security

**Metro is completely unauthenticated.** It will serve the entire source tree, and accept
`/symbolicate` POSTs, from anyone who can reach the port. The tailnet is the only thing protecting
it, which is precisely why this uses Tailscale instead of a public tunnel with a guessable URL.

`bootstrap.sh` sets `ufw` to allow inbound only on `tailscale0` (plus SSH). Set Hetzner's cloud
firewall to deny the same ports — two layers, because the box is one `ufw disable` from being an
open source-code mirror.

## Not yet verified

Written and syntax-checked, but never run end to end — there was no box at the time. Expect to
debug the first run.

Measured in a Claude container: Metro serves and bundles (~50s cold, 8s warm restart), the
Tailscale registration handshake completes (control-plane key exchange, nodekey, `RegisterReq`
accepted), UDP egress and direct TCP/443 are open, `/dev/net/tun` is present and `CAP_NET_ADMIN` is
held.

Inferred, not measured: a completed tailnet join and a data-plane connection (needs a real auth
key), the systemd units, the sudoers rule, and the whole watcher loop against live PRs.

One known unknown worth watching: in the Claude container a **running** Metro did not pick up edits
— only a restart did, verified three ways including a syntax error it never reported. `watchman` is
absent there and installed here, which is the main suspect. If it recurs on the box, make
`watch-prs.sh` restart on every sync (drop the `need_restart` heuristic); it costs 8s and buys
certainty.
