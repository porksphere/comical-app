<p align="center">
  <img src="apps/mobile/assets/images/logo.svg" alt="Comical logo" width="128" height="128" />
</p>

<h1 align="center">comical</h1>

<p align="center">A cross-platform comic reader for iOS, Android, Desktop, and the web.</p>

<p align="center">
  Comical ships with no sources. You add a registry, install the bridges you want,<br />
  and read from those.
</p>

<p align="center">
  <img src="docs/media/01-browse.png" alt="Browsing featured series" width="240" />
  <img src="docs/media/02-series.png" alt="A series page" width="240" />
  <img src="docs/media/03-reader.png" alt="The reader" width="240" />
</p>

<p align="center">
  <img src="docs/media/04-desktop.png" alt="Browsing on the desktop app" width="744" />
</p>

## Features

- **Paged and long-strip readers**
- **Library, collections and groups** for organising what you follow
- **Offline downloads**, including auto-downloading new chapters
- **Activity**: new chapters from your library in one feed, with notifications
- **Tracking** to AniList and MyAnimeList
- **Sync** between your phones and computer, with no cloud account

## Install

### iOS

Install through **[SideStore](https://sidestore.io)** or **[AltStore](https://altstore.io)**.

Add the release channel as a source (**Sources → +**) to get updates:

```
https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json
```

Or install **[comical-unsigned.ipa](https://github.com/porksphere/comical-app/releases/latest)** directly.

### Android

Install
**[comical-android.apk](https://github.com/porksphere/comical-app/releases/download/android-release/comical-android.apk)**
directly.

### Windows & Linux

Install
**[comical-desktop-setup.exe](https://github.com/porksphere/comical-app/releases/download/desktop-release/comical-desktop-setup.exe)**
on Windows. On Linux, use the
**[AppImage](https://github.com/porksphere/comical-app/releases/download/desktop-release/comical-desktop-x86_64.AppImage)**
or the
**[.deb](https://github.com/porksphere/comical-app/releases/download/desktop-release/comical-desktop-amd64.deb)**.

Warning: the installers aren't code-signed, so Windows SmartScreen will warn on first run.

The desktop app is also the hub your phones [sync](#sync) with.

### Web

The frontend and backend can be run as two Docker containers. See
**[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)** for the compose file and configuration.

A mock preview is deployed to
**[porksphere.github.io/comical-app](https://porksphere.github.io/comical-app/)**.

## How it works

**Registry → bridge → series.**

- A **registry** is a list of bridges you add in Settings. Public ones are listed under the
  **[`comical-registry` topic](https://github.com/topics/comical-registry)** on GitHub.
- A **bridge** is an adapter for one source or service, downloaded and verified from a registry.
- **Series** are what a bridge sources, and what you browse and read.

Registries can also carry **trackers**, which sync your reading progress to a service like AniList.
They're installed and updated the same way as bridges.

On iOS and Android, bridges run on-device and no server is involved. On the web they run in the
backend you host.

Bridges run against [**comical**](https://github.com/porksphere/comical), the TypeScript core,
which is written to embed in any JS environment. For the full picture, see
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Sync

The desktop app keeps your phones' libraries in step. On the computer, open **Settings → Sync**,
turn on **Sync with your phone** and tap **Pair a phone**. Then scan the code from the phone's own
Sync settings. Your library, collections, reading progress, history, tracker links and installed
bridges sync over your local network. Logins never leave the device they were entered on, and
everything between the phone and the computer is end-to-end encrypted.

Sync is for phones that run bridges on-device. A browser doesn't need it, since it reads its
server's library directly.

## Development

Building from source, running locally, and the CI/release pipeline are documented in
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. TL;DR for a fresh clone:

```bash
bun run setup   # submodule + deps + native harness
bun run dev     # local web dev in a browser → http://localhost:8081
```
