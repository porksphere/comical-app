---
title: Privacy
description: What leaves your device, and to whom.
---

Comical has no account, no analytics and no server of its own. What it sends, it sends to three
kinds of places — the sources you've chosen, GitHub, and a crash reporter — and this page lists
them all.

## Sources

Every request for a series, a chapter or a page goes from your device to the source that bridge
talks to, and to nothing else. On iOS, Android and the desktop app the bridges run **on your
device**, so no intermediary sees your reading. On the web app they run in the backend **you**
host, which is the same thing one hop removed.

What a source learns about you is between you and that source. Comical adds nothing to those
requests beyond what the bridge needs — a login you entered into it, say — and
**Settings → General → Show request errors** / **Show request activity** show every request a bridge
makes, so you can see for yourself.

## Registries

Adding a registry fetches its `index.json`; installing or updating a bridge fetches a bundle from
it. The registry's host sees the ordinary request logs any static host sees.

## Trackers

A tracker you sign into — AniList, MyAnimeList — receives your reading progress for the series you
link, under your own account there. Nothing is sent to a tracker for an unlinked series. Removing
the tracker in Settings forgets the login.

## GitHub

On launch (and when it comes back to the foreground) the app fetches a small version manifest from
this project's GitHub releases to check for updates. GitHub sees that request like any download.

## Crash reports

Native builds (iOS, Android, desktop) send **crash and error reports** to Sentry when something
breaks: the stack trace, the app version and build channel, the OS and device model. Reports
include no reading history, no library contents and no source logins; performance tracing is off.
The web build sends nothing.

There is no toggle for this yet — if you want one, [say so](https://github.com/porksphere/comical-app/issues).

## Sync

[Sync](../guides/sync/) between a phone and the desktop app runs over your local network and is
end-to-end encrypted between the two devices. No relay is involved.

## Stored on the device

Your library, progress, settings, downloads, and the bridges you installed. **Settings → General →
Library backup** exports it; deleting the app deletes it.
