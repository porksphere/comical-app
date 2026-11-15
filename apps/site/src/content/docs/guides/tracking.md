---
title: Tracking
description: Keeping AniList or MyAnimeList in step with what you read.
---

Trackers come from registries, like bridges. AniList and MyAnimeList are in the official
[tracker registry](https://github.com/porksphere/comical-trackers):
[add it](../../demo/add-registry?url=https%3A%2F%2Fraw.githubusercontent.com%2Fporksphere%2Fcomical-trackers%2Fmain%2Findex.json), or paste
`https://raw.githubusercontent.com/porksphere/comical-trackers/main/index.json` under **Settings →
Bridges → Add registry**.

A registry that carries trackers lists them under **Settings → Trackers**; sign in to one there and
it's available on every series.

## Linking a series

**Trackers** on a series page searches the tracker for the title and lets you pick the match. From
then on, finishing a chapter updates your progress there, and the panel shows the entry's status,
score and progress with the tracker's own controls.

A series can be linked to more than one tracker; each is updated independently.

## Importing a list

**Settings → Trackers → Import** pulls the tracker's reading list into your library. Comical
searches your installed sources for each title and saves the matches; what it couldn't find is
listed so you can resolve it by hand.

## Signing out

Removing a tracker in Settings forgets its login and unlinks every series. Nothing is deleted on
the tracker's side.
