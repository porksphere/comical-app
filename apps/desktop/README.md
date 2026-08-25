# Comical desktop — Electron spike

The web UI in an Electron window, with the Comical host running in-process. A spike, not a
shipping app: unsigned, no auto-update, no desktop chrome.

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
