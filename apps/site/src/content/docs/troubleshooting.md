---
title: Troubleshooting
description: The questions that come up, and what to do about them.
---

## "There's nothing to read"

Right — Comical ships with no sources. Add a registry and install a bridge:
[Getting started](../getting-started/).

## SideStore shows no update

SideStore up to 0.6.3 has a [known bug](https://github.com/SideStore/SideStore/issues/975) that
swallows updates from sources no matter how the version changes. Remove the Comical source in
SideStore and add it again — the app is reinstalled in place and keeps its data.

## Windows says the installer is unrecognised

The installers aren't code-signed, so SmartScreen warns the first time. **More info → Run
anyway**. The download link is on the [install page](../install/) and nowhere else.

## A bridge says it needs settings

Some bridges have to be told where to go — a server address, an account. Open the bridge's settings
(the gear next to it under **Settings → Bridges**) and fill them in.

## A registry asks me to confirm its key

The registry's signing key changed since you added it, which means either its publisher rotated
keys or something is impersonating it. If you trust the publisher's explanation, confirm; if not,
don't — nothing from it installs until you do.

## Downloads are stuck on "waiting"

The source is rate-limiting and the bridge is honouring it. The download continues when the source
allows; **Settings → General → Show request activity** shows what's being held and for how long.

## The web app can't reach its backend

`COMICAL_SERVER` must be a URL **your browser** can open, not a Docker service name. See
[Self-hosting](../self-hosting/#configuration).

## The preview at `/app/` shows made-up series

That's the point of it: it's a static build with sample data and no backend, there to show the app
before you install it. Nothing in it is a real source.

## Reporting a bug

[Open an issue](https://github.com/porksphere/comical-app/issues) with the build from **Settings →
About** — the version, channel and commit identify exactly what you're running.
