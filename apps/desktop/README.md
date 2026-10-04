# Comical desktop — Electron spike

The web UI in an Electron window, with the Comical host running in-process. A spike, not a shipping
app: unsigned.

```bash
bun run setup       # once, from the repo root
cd apps/desktop
bun run dev         # on a live Metro: UI hot-reloads, main-process edits relaunch
bun run start       # build + launch
bun run smoke       # the host under plain node, no Electron
bun run launch-check
bun run dist:win    # packaged installer (also dist:linux, dist:mac)
```

Set `COMICAL_BRIDGES_DIR=../../external/comical/bridges` to have something on the home screen
before a registry is added.

Electron's main process is a full Node, so `node:vm` evaluates bridges — no JSC or QuickJS harness,
and `apps/mobile` is untouched. `src/host/create-host.ts` explains the rest.

## Getting it installed

None of this is derivable from the code, and it's the part that decides whether anyone can actually
run the thing.

| OS | First launch | What the user does |
| --- | --- | --- |
| **Linux** | nothing | — |
| **Windows** | SmartScreen | *More info* → *Run anyway* |
| **macOS** | blocked | System Settings → Privacy & Security → **Open Anyway** |

**macOS needs no SideStore equivalent, and none exists.** SideStore is a response to iOS refusing to
execute unsigned code at all, plus a free Apple ID's 7-day provisioning expiry — the app has to be
re-signed forever. macOS has neither constraint: unsigned apps run permanently after one gesture.
Note that ad-hoc signing (`codesign -s -`) *is* mandatory on Apple Silicon or the binary is killed
outright, but it needs no account and electron-builder does it by default. A free Apple ID cannot
notarize; Developer ID and notarization are both paid-only. macOS 15 Sequoia removed the old
Control-click → Open bypass, so that advice is dead.

**A certificate does not clear the Windows warning either.** Microsoft made OV and EV build
SmartScreen reputation identically in March 2024, so a freshly-signed app still warns until download
volume accrues. What signing buys is that reputation attaching to the *publisher* and carrying
across releases — unsigned, every build starts from zero, forever. If that becomes worth paying for,
the cheap route is Azure Artifact Signing (~$10/month, open to self-employed individuals), not a
traditional EV certificate.

To spare macOS users the detour, all free: a **Homebrew tap** (`brew install --cask --no-quarantine
comical` — best fit: one line, self-updating, a tap is just a repo), `xattr -dr
com.apple.quarantine`, or a `curl | tar` line. All three work by avoiding the `com.apple.quarantine`
xattr that *browsers* attach to downloads, which is what Gatekeeper keys off.

## Linux packaging

**AppImage** (no install, no root, runs anywhere) and **.deb** (menu entry, apt-managed uninstall).
That's what Obsidian ships, minus Snap.

Snap and Flatpak are deliberately absent. Snap is Canonical-specific and its confinement fights
Electron; Flatpak wants apps built against a shared runtime, which buys nothing for a framework that
bundles its own Chromium regardless — Obsidian's own Flatpak is community-maintained, not theirs.

**AppImage needs FUSE 2**, which Ubuntu 22.04+ doesn't install by default; it fails with `AppImages
require FUSE to run`. Either `apt install libfuse2` or run it with `--appimage-extract-and-run`. The
.deb has no such problem, which is half the reason it's there.

## Desktop chrome

- **Window.** Size, position and maximized state persist (`src/window-state.ts`); a saved position
  that no longer lands on any display is dropped rather than restored off-screen.
- **Menus.** The app menu is a set of shortcuts on Windows and Linux, where the caption overlay
  means no menu bar is drawn; only macOS shows it. Reload and the developer tools are left out of a
  packaged build unless `COMICAL_DEBUG` is set. Right-click gives cut/copy/paste, spelling
  suggestions, and copy/open for links and images (`src/menus.ts`).
- **Back / Forward.** Alt+←/→ (⌘[ / ⌘] on macOS) and the mouse's side buttons. Back closes whatever
  is over the page first — the reader, a sheet, the settings panel, the series pane — by asking it
  the way Escape does, and only then goes back in history.
- **Links.** `comical://<route>` opens that route, e.g. `comical://add-registry?url=…` lands on the
  add-registry confirm. The scheme is registered only by a packaged build, so a dev run never
  claims it from an installed one (`src/links.ts`).
- **Tray and notifications.** Both opt-in. The tray (Settings → General) keeps the app running with
  the window closed; Settings → Notifications → *Check in background* then checks the library
  hourly, and *Notify about new chapters* posts a system notice for what it finds — only while the
  window isn't focused, and clicking it opens Activity.

## Syncing with a phone

The desktop app is the hub a phone syncs with — its library is the hub's library, so there is
nothing for it to sync *to*. Settings → Sync → **Sync with your phone** opens a second listener
on the local network. Off by default, and off again closes the port.

- **Each phone is paired on its own.** **Pair a phone** shows a QR code holding
  `http://<this computer>:3130/<code>`, which the phone's *Sync server* → **Scan a code** reads
  (typing the address works too). The code pairs one phone, once, and only while the sheet is
  showing it — a fresh one replaces it every ten minutes. Pairing is a key exchange sealed under
  that code, and what comes out of it is a key only that phone and this computer hold
  (`@comical/sync`'s `pairingGate`); the code itself is never a key to anything afterwards.
- **Each phone is unlinked on its own.** Paired phones are listed under the toggle with when they
  last synced. **Unlink** cuts off that phone and no other: the next time it tries to sync it is
  told so, turns its own sync off, and has to be paired again. A phone that leaves by itself
  (*Sync server* → **Unpair**, or pointing it at another server) takes itself off the list. The
  list stays up while sync is off, so a phone can be unlinked without opening the port.
- **A paired phone can sync and nothing else.** The listener answers sealed `/sync` requests from
  a phone it has paired and gives everything else a bare 404 (`src/host/sync-listener.ts`); the
  rest of the API stays on the loopback listener. That still matters: a sync push can add a
  registry and install a bridge, which is code this machine runs.
- **It is plain HTTP, sealed.** Every body is encrypted under the phone's key, so the network sees
  opaque POSTs. The pairings are kept in the shell's settings file, so a paired phone survives a
  restart.
- **Windows asks about the firewall** the first time the listener binds. Refuse and the phone
  can't connect, with nothing in the app to say why.
- **The port is a preference.** `COMICAL_SYNC_PORT` overrides 3130, and a port that can't be bound
  falls back to an ephemeral one — the address in a pairing code is read from what was actually
  bound, but a phone paired at the old address has to be paired again.

## Updates

A release build updates itself from the rolling `desktop-release` Release (`src/updater.ts`): it
checks every four hours, downloads in the background, and Settings → About offers **Restart** once
the new version is ready; quitting installs it too. That's the Windows installer and the AppImage.
A `.deb` belongs to apt, so it gets the same "update available" notice with a link to the download
page instead — as does any build where the updater can't run.

The feed is electron-builder's own `latest.yml` / `latest-linux.yml`, which it writes beside the
installers because `publish` names a `generic` provider; CI still builds with `--publish never` and
uploads them itself (`.github/scripts/publish-desktop-channel.sh`). Two things about it are
load-bearing:

- **Only `desktop-release` builds follow it.** The channel is baked into the main bundle
  (`COMICAL_BUILD_CHANNEL`, `scripts/build-main.ts`). A PR or nightly build is versioned `X.Y.Z-N`,
  which semver ranks *below* `X.Y.Z`, so left to it one would replace itself with the release. A
  nightly gets the notice-and-link instead, pointing at the rolling `desktop-nightly` Release
  (`.github/scripts/publish-desktop-nightly.sh`).
- **Differential downloads are off.** The installers keep fixed names, so the old blockmap the
  updater would diff against is always the new one.

## Not done

- **Signing / notarization.** None, anywhere. See above.
- **The open port.** Loopback plus a per-launch bearer token Electron injects into the renderer's
  requests keeps other local processes out, but the port exists. The fix is IPC: `ipcMain.handle` →
  `host.fetch(path, init)` and a `startup.electron.ts` calling the existing `setTransport()` — the
  shape `@comical/host-rn` already uses on device, and the only item here touching `apps/mobile`.
- **macOS in CI.** `build-desktop-reusable.yml` matrixes Windows and Linux only.
- **Publishing has never run.** Installers are published only by `release.yml`, to the `vX.Y.Z`
  Release and the rolling `desktop-release` one (`publish-desktop-channel.sh`); until a release is
  cut, that path — and the README's download links — is verified only by reading it. The updater
  itself has run once, locally: a packaged 0.0.0 found, downloaded and silently installed a 0.0.1
  from a feed served off disk.
