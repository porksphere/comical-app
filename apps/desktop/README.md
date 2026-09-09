# Comical desktop — Electron spike

The web UI in an Electron window, with the Comical host running in-process. A spike, not a shipping
app: unsigned, no auto-update, no desktop chrome.

```bash
bun run setup       # once, from the repo root
cd apps/desktop
bun run start       # build + launch
bun run smoke       # the host under plain node — 22 assertions, no Electron
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

## Not done

- **Signing / notarization.** None, anywhere. See above.
- **Auto-update.** `publish: null` in `electron-builder.yml`; `electron-updater` needs a `github`
  provider and a fix for the version ordering noted in `scripts/stamp-version.ts`.
- **The open port.** Loopback plus a per-launch bearer token Electron injects into the renderer's
  requests keeps other local processes out, but the port exists. The fix is IPC: `ipcMain.handle` →
  `host.fetch(path, init)` and a `startup.electron.ts` calling the existing `setTransport()` — the
  shape `@comical/host-rn` already uses on device, and the only item here touching `apps/mobile`.
- **Desktop chrome.** No app menu, shortcuts, tray, window-state persistence, or deep links.
- **Desktop-shaped UI.** It's the responsive *web* layout. Usable at 1280×860, not designed for it.
- **macOS in CI.** `build-desktop.yml` matrixes Windows and Linux only.
- **The `publish` job has never run.** Gated to `main`, so every branch run skips it. The rolling
  `desktop-latest` Release — the public URL needing no GitHub login — is verified only by reading it.
