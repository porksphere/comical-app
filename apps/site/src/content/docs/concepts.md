---
title: How it works
description: Registries, bridges, series and trackers — the four words the rest of the docs use.
---

**Registry → bridge → series.** That's the whole model.

## Registry

A registry is a catalog of bridges: a static `index.json` and the bridge bundles it points at,
hosted anywhere static files can live. You add registries in **Settings → Bridges**; Comical
operates none of its own.

A registry can be **signed**. Comical records the signing key when you add it, and every bridge
served under that key is checked before it runs. If a registry's key ever changes you're asked
to confirm before anything from it installs again.

Public registries on GitHub carry the
[`comical-registry`](https://github.com/topics/comical-registry) topic. For publishing your own,
see [Publishing a registry](../developers/registries/).

## Bridge

A bridge is an adapter for one source: a server you run (a Komga or Kavita library, an OPDS feed),
a service you have an account with, or a site. It translates that backend into the neutral model
the app understands — lists of series, chapters, pages — and nothing else. A bridge never carries
content; it carries the knowledge of how to fetch it.

Bridges are sandboxed. They can't reach the network or storage directly; they ask the host, which
is how the app can enforce rate limits, show request activity, and keep a misbehaving bridge from
touching anything but its own data. Bridges declare **capabilities** (search, lists, settings,
favorites…), and the app shows only the features a bridge actually supports.

Where a bridge runs:

| Platform | Bridges run… |
|---|---|
| iOS, Android | on the device, in a native JS engine — no server involved |
| Windows, Linux (desktop app) | inside the desktop app |
| Web | in the backend container you host |

For writing one, see [Writing a bridge](../developers/bridges/).

## Series

What a bridge sources. Series have chapters, chapters have pages, and that's what you browse,
save to your library, download and read. A series belongs to the bridge it came from; the same
title on two sources is two series.

## Tracker

A registry can also carry **trackers** — adapters for services like AniList and MyAnimeList that
keep a reading list. Link a tracker once and Comical updates your progress as you read, and can
import the list you already have there. See [Tracking](../guides/tracking/).

## The core

All of this runs on [comical](https://github.com/porksphere/comical), a TypeScript runtime
written to embed in any JavaScript environment. The app is one host for it; the server you'd
self-host is another; the command-line tool bridge authors test with is a third.
