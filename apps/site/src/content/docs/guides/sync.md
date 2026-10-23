---
title: Sync
description: Pairing phones with the desktop app so library, progress and bridges stay in step.
---

Phones sync with the **desktop app** over your local network. There is no account and no cloud:
the desktop app is the hub, and each phone pairs with it once.

## Pairing

1. On the computer: **Settings → Sync → Sync with your phone**, then **Pair a phone**. A QR code
   appears, along with the address it encodes.
2. On the phone: **Settings → Sync → Sync server**, and scan the code (or type the address).
3. Turn on **Sync library** on the phone.

The phone appears in the computer's device list, and syncs whenever both are on the same network
and the app is open. **Sync now** forces one.

## What's synced

Your library and collections, reading progress and history, installed bridges and their settings,
and tracker links. Logins to sources and trackers **stay on the device** that made them. Downloaded
chapters aren't synced — each device downloads its own.

Everything sent is **end-to-end encrypted** between the phone and the computer; the desktop app
never sees anything in transit it didn't already hold.

## Prerequisites

The phone must be running bridges on the device (**Settings → General → Run bridges on this
device**) — only a library kept on the phone has anything to sync. A phone pointed at a remote
server reads that server's library directly, and so does any browser, so the web app has no sync
setting.

## Unpairing

Remove a phone from the computer's list, or turn off **Sync library** on the phone. A phone the
computer unlinked says so under Sync and offers to pair again.
