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
  https://github.com/porksphere/comical-app/releases/download/ios-latest/apps.json
  ```
- **Or install the IPA directly:** open
  [comical-unsigned.ipa](https://github.com/porksphere/comical-app/releases/download/ios-latest/comical-unsigned.ipa)

### 🤖 Android

Download and install the APK directly:

**[⬇ comical-android.apk](https://github.com/porksphere/comical-app/releases/download/android-latest/comical-android.apk)**

On-device, enable **"Install unknown apps"** for your browser, open the link, and install.
Both links above are rolling — they always point at the latest build. Versioned, archival
releases (with both binaries) live under the repo's [Releases](https://github.com/porksphere/comical-app/releases).

### 🌐 Web

Unlike native, the web build has no on-device runtime — you host it yourself: the **app**
(the static web bundle) and a **backend** (`@comical/host-server`, which runs the bridges).

Both are published as container images. This `docker-compose.yml` brings up the whole stack:

```yaml
services:
  host:
    image: ghcr.io/porksphere/comical-host:latest
    ports: ["3100:3100"]
    environment:
      COMICAL_ORIGIN: "*"
      # COMICAL_TOKEN: "change-me"   # optional bearer auth
    volumes: ["comical-data:/data"]
    restart: unless-stopped
  web:
    image: ghcr.io/porksphere/comical-app-web:latest
    ports: ["8080:80"]
    environment:
      # The URL the BROWSER uses to reach `host` — set to the backend's public URL for a real deploy.
      COMICAL_SERVER: "http://localhost:3100"
    depends_on: ["host"]
    restart: unless-stopped
volumes:
  comical-data:
```

```sh
docker compose up -d
# open http://localhost:8080
```

- **`COMICAL_SERVER`** is injected into the web app at container start (`window.__COMICAL_SERVER__`),
  so one image re-points at any backend without rebuilding. It's the URL the **browser** uses — not
  the compose service name — so beyond a local trial set it to the backend's public URL and front
  both services with a reverse proxy + TLS. Users can also override it in the app's **Settings**.
- **`host`** ships only first-party sample bridges; add real sources (a registry, then bridges) at
  runtime via Settings. Its `/data` volume persists your library, settings, and installed bridges.
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
  ships without an app update.
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
