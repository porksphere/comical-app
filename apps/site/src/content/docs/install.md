---
title: Install
description: Getting Comical onto an iPhone, an Android phone, a Windows or Linux computer, or a server.
---

Comical isn't on an app store. Each platform below has a direct download, and the app checks for
its own updates once installed.

## iOS

Install through [SideStore](https://sidestore.io) or [AltStore](https://altstore.io) — sideloading
tools that sign the app with your own Apple ID.

Add the release channel as a source (**Sources → +**) so updates show up there:

```
https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json
```

Or install [`comical-unsigned.ipa`](https://github.com/porksphere/comical-app/releases/latest)
directly with whatever signing tool you use.

:::tip[SideStore doesn't offer the update?]
SideStore 0.6.3 and earlier has a bug that hides updates from sources. Remove the Comical source
and add it again — the app is reinstalled in place and keeps its data. See
[Troubleshooting](../troubleshooting/#sidestore-shows-no-update).
:::

## Android

Download and open
[`comical-android.apk`](https://github.com/porksphere/comical-app/releases/download/android-release/comical-android.apk).
Android will ask you to allow installs from your browser the first time. Android 8 (API 26) or
newer.

## Windows and Linux

- **Windows**: [`comical-desktop-setup.exe`](https://github.com/porksphere/comical-app/releases/download/desktop-release/comical-desktop-setup.exe)
- **Linux**: the [AppImage](https://github.com/porksphere/comical-app/releases/download/desktop-release/comical-desktop-x86_64.AppImage)
  or the [.deb](https://github.com/porksphere/comical-app/releases/download/desktop-release/comical-desktop-amd64.deb)

The installers aren't code-signed, so **Windows SmartScreen warns on first run** — choose *More
info → Run anyway*. The desktop app runs the bridges itself and can also act as the
[sync](../guides/sync/) hub for your phones.

## Web

The web app is something you host: a static frontend plus a backend container that runs the
bridges. See [Self-hosting](../self-hosting/).

There's a [preview with sample data](../app/) if you want to see the app before installing
anything. It has no backend behind it, so nothing in it is real.

## What's next

A fresh install has no sources. [Getting started](../getting-started/) walks through adding a
registry and installing a bridge.
