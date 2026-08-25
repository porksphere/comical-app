<p align="center">
  <img src="apps/mobile/assets/images/logo.svg" alt="Comical logo" width="128" height="128" />
</p>

<h1 align="center">comical</h1>

<p align="center">A cross-platform comic reader for iOS, Android, and the web.</p>

Comical ships with no sources of its own. You point it at a registry, install the bridges you
want, and it reads from those. On iOS and Android everything runs on-device, with no server; on
the web you host a backend yourself.

## Install

### iOS

There's no App Store listing, so you install through **[SideStore](https://sidestore.io)** or
**[AltStore](https://altstore.io)**, which re-sign the app on-device with your own Apple ID
(auto-refreshed every 7 days).

Add it as a source — **Sources → +** — to get update notifications:

```
https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json
```

Or install `comical-unsigned.ipa` from the
[latest release](https://github.com/porksphere/comical-app/releases/latest) directly.

### Android

**[⬇ comical-android.apk](https://github.com/porksphere/comical-app/releases/download/android-release/comical-android.apk)**

Enable **"Install unknown apps"** for your browser, open the link, install.

Both links above are rolling — they always point at the newest released build, and the app tells
you in Settings when a newer one exists. Older versions live under
[Releases](https://github.com/porksphere/comical-app/releases).

### Web

The web build has no on-device runtime, so you host two containers yourself: the static app, and
`@comical/host-server`, which runs the bridges.

```yaml
services:
  comical-host:
    image: ghcr.io/porksphere/comical-host:latest
    container_name: comical-host
    environment:
      - COMICAL_ORIGIN=*
      # - COMICAL_TOKEN=change-me   # optional bearer auth
    volumes:
      - ./comical-host:/data
    ports:
      - 3100:3100
    restart: unless-stopped

  comical-app-web:
    image: ghcr.io/porksphere/comical-app-web:latest
    container_name: comical-app-web
    environment:
      - COMICAL_SERVER=http://localhost:3100
    ports:
      - 3300:80
    depends_on:
      - comical-host
    restart: unless-stopped
```

- **`COMICAL_SERVER`** is the URL the *browser* hits, not the compose service name. Past a local
  trial, set it to the backend's public address and front both services with a reverse proxy and
  TLS. It's injected at container start, so one image re-points at any backend without a rebuild,
  and users can override it in the app's **Settings**.
- **`/data`** on the host container persists your library, settings, and installed bridges.

A public preview is deployed to
**[porksphere.github.io/comical-app](https://porksphere.github.io/comical-app/)**, but it's backed
by demo data — a look at the UI, not a usable reader.

## How it works

The reading logic is a plain TypeScript core (`@comical/*`). **Bridges** are per-source adapters,
downloaded and verified from user-managed registries at runtime, so support for a new source
doesn't need an app update — public registries are discoverable via the
**[`comical-registry` topic](https://github.com/topics/comical-registry)** on GitHub. On iOS and
Android those bridges run on-device in a native JS engine (JavaScriptCore / QuickJS); on the web
they run in the host server. The UI is one React Native + Expo codebase for all three platforms.

For the full picture, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Development

Building from source, running locally, and the CI/release pipeline are documented in
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. TL;DR for a fresh clone:

```bash
bun run setup   # submodule + deps + native harness
bun run dev     # local web dev in a browser → http://localhost:8081
```
