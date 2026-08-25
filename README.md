<p align="center">
  <img src="apps/mobile/assets/images/logo.svg" alt="Comical logo" width="128" height="128" />
</p>

<h1 align="center">comical</h1>

<p align="center">A cross-platform comic reader for iOS, Android, and the web.</p>

<p align="center">
  Comical ships with no sources. You add a registry, install the bridges you want,<br />
  and read from those.
</p>

<!-- Demo GIF slot. Capture it with `gh workflow run capture-demo.yml` (or
     `bash apps/mobile/e2e/scripts/record-demo.sh ios` locally), drop the result at
     docs/media/demo.gif, and uncomment:
<p align="center">
  <img src="docs/media/demo.gif" alt="Browsing a series and opening the reader" width="300" />
</p>
-->

## Install

### iOS

Install through **[SideStore](https://sidestore.io)** or **[AltStore](https://altstore.io)**.

Add the release channel as a source (**Sources → +**) to get updates:

```
https://github.com/porksphere/comical-app/releases/download/ios-release/apps.json
```

Or install `comical-unsigned.ipa` from the
[latest release](https://github.com/porksphere/comical-app/releases/latest) directly.

### Android

Install
**[comical-android.apk](https://github.com/porksphere/comical-app/releases/download/android-release/comical-android.apk)**
directly.

### Web

The frontend and backend can be run as two Docker containers. See
**[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)** for the compose file and configuration.

A mock preview is deployed to
**[porksphere.github.io/comical-app](https://porksphere.github.io/comical-app/)**.

### Windows & macOS

In development.

## How it works

**Registry → bridge → series.**

- A **registry** is a list of bridges you add in Settings. Public ones are listed under the
  **[`comical-registry` topic](https://github.com/topics/comical-registry)** on GitHub.
- A **bridge** is an adapter for one source or service, downloaded and verified from a registry.
- **Series** are what a bridge sources, and what you browse and read.

On iOS and Android, bridges run on-device and no server is involved. On the web they run in the
backend you host.

Bridges run against [**comical**](https://github.com/porksphere/comical), the TypeScript core,
which is written to embed in any JS environment. For the full picture, see
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Development

Building from source, running locally, and the CI/release pipeline are documented in
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**. TL;DR for a fresh clone:

```bash
bun run setup   # submodule + deps + native harness
bun run dev     # local web dev in a browser → http://localhost:8081
```
