<p align="center">
  <img src="apps/mobile/assets/images/logo.svg" alt="Comical logo" width="128" height="128" />
</p>

<h1 align="center">comical</h1>

<p align="center">A cross-platform comic reader for iOS, Android, and the web.</p>

Comical ships with no sources. You add a registry, install the bridges you want, and read from
those.

## Install

### iOS

Install through **[SideStore](https://sidestore.io)** or **[AltStore](https://altstore.io)**.

Add the release channel as a source — **Sources → +** — to get updates:

```
https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json
```

Or install `comical-unsigned.ipa` from the
[latest release](https://github.com/porksphere/comical-app/releases/latest) directly.

### Android

**[⬇ comical-android.apk](https://github.com/porksphere/comical-app/releases/download/android-release/comical-android.apk)**

### Web

The app and the backend run as two services:

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

- **`COMICAL_SERVER`** is the URL the *browser* hits, not the compose service name — past a local
  trial, set it to the backend's public address. It can also be overridden in **Settings**.
- **`/data`** persists your library, settings, and installed bridges.

A mock preview is deployed to
**[porksphere.github.io/comical-app](https://porksphere.github.io/comical-app/)**.

## How it works

Sources are **bridges** — per-source adapters that Comical downloads and verifies from the
registries you add. Public ones are listed under the
**[`comical-registry` topic](https://github.com/topics/comical-registry)** on GitHub.

On iOS and Android, bridges run on-device and no server is involved. On the web they run in the
backend you host.

For the full picture, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Development

Building from source, running locally, and the CI/release pipeline are documented in
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. TL;DR for a fresh clone:

```bash
bun run setup   # submodule + deps + native harness
bun run dev     # local web dev in a browser → http://localhost:8081
```
