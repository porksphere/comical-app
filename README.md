<p align="center">
  <img src="apps/mobile/assets/images/logo.svg" alt="Comical logo" width="128" height="128" />
</p>

<h1 align="center">comical</h1>

<p align="center">A cross-platform comic reader for iOS, Android, and the web.</p>

Comical reads from sources you add yourself. On iOS and Android it runs entirely on-device
with no server required; on the web it talks to a backend you host.

## Install

### 📱 iOS

There's no App Store listing (this is a free-Apple-ID setup with no paid developer account),
so you install through **[SideStore](https://sidestore.io)** or **[AltStore](https://altstore.io)**,
which re-sign the app on-device with your own Apple ID (auto-refreshed every 7 days).

- **Add as a source** (recommended — you get update notifications): in SideStore/AltStore →
  **Sources → +**, add:
  ```
  https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json
  ```
  This is the public release channel — every tagged version, newest first, all permanently
  installable.
- **Or install the IPA directly:** grab `comical-unsigned.ipa` from the
  [latest release](https://github.com/porksphere/comical-app/releases/latest).

### 🤖 Android

Download and install the APK directly:

**[⬇ comical-android.apk](https://github.com/porksphere/comical-app/releases/download/android-release/comical-android.apk)**

On-device, enable **"Install unknown apps"** for your browser, open the link, and install.
Both links above are rolling — they always point at the newest **released** build, and the app
tells you in Settings when there's a newer one. Versioned, archival releases (with both binaries)
live under the repo's [Releases](https://github.com/porksphere/comical-app/releases).

(There's also a rolling `android-latest` APK tracking the tip of `main`, the Android counterpart of
the `ios-main` source — for testing unreleased work, not for normal use. See
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).)

### 🌐 Web

Unlike native, the web build has no on-device runtime — you host it yourself: the **app**
(the static web bundle) and a **backend** (`@comical/host-server`, which runs the bridges).

Both are published as container images. This `docker-compose.yml` brings up the whole stack:

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

- **`COMICAL_SERVER`** is injected into the web app at container start (`window.__COMICAL_SERVER__`),
  so one image re-points at any backend without rebuilding. It's the URL the **browser** uses — not
  the compose service name — so beyond a local trial set it to the backend's public URL and front
  both services with a reverse proxy + TLS. Users can also override it in the app's **Settings**.
- **`comical-host`** bundles no bridges; add sources (a registry, then bridges) at runtime via
  Settings. Its mounted `/data` dir persists your library, settings, and installed bridges.
- Image tags: `latest` + `sha-<commit>` follow the default branch; `X.Y.Z` / `X.Y` are cut from
  `v*` git tags.

To build the web bundle or run the server from source instead, see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

A public preview is also deployed to GitHub Pages — **[porksphere.github.io/comical-app](https://porksphere.github.io/comical-app/)**
— but it's backed by demo data (static hosting has no backend to reach), so it's a look at the
UI, not a usable reader.

## How it works

Comical is built around a small **TypeScript runtime core** (`@comical/*`):

- **Core runtime** — the shared logic that fetches and normalizes comics.
- **Bridges** — per-source adapters that know how to talk to a given site/service. These are
  downloaded and verified from user-managed registries at runtime, so support for new sources
  ships without an app update. Public registries are discoverable on GitHub via the
  **[`comical-registry` topic](https://github.com/topics/comical-registry)** (sorted by stars).
- **React Native + Expo shell** — one UI codebase for iOS, Android, and web. Because the core
  is plain TypeScript, it runs directly in the app's JS runtime with no native rewrite.

On iOS/Android the bridges run **on-device** (in a native JS engine — JavaScriptCore on iOS,
QuickJS on Android), so no external server is involved. On the web they run against a hosted
`@comical/host-server`.

For the full picture, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Contributing / development

Building from source, running the app locally, and the CI/release pipeline are all documented
in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. TL;DR for a fresh clone:

```bash
bun run setup   # submodule + deps + native harness
bun run dev     # local web dev in a browser → http://localhost:8081
```
