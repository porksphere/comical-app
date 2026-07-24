# comical-translator

The local Expo native module behind the live-translation pipeline (`src/translation/`). It
exposes only what JS can't do itself — image decode to raw RGBA, platform OCR (Vision / ML Kit),
and platform translation (Apple Translation / ML Kit) — while ONNX inference stays in JS via
`onnxruntime-react-native`, so adding models never touches this module. The TS contract lives in
`index.ts`; both platform implementations mirror it function-for-function.

Autolinked via `expo-module.config.json` like `comical-runtime`; no config plugin, no app.json
entry. ML Kit dependencies are module-local in `android/build.gradle` (bundled recognizers, so
OCR works offline on first run; translation packs download on demand). The iOS podspec needs
only ExpoModulesCore — Vision/Translation are system frameworks, with all Translation usage
gated `@available(iOS 18, *)` so the deployment target stays 15.1.

## Device validation still required (feature plan Phase 0)

Nothing here can be exercised in CI beyond compiling; two spikes must run on hardware before
the feature ships (see `docs/live-translator-feasibility.md` and the implementation plan):

- **S1 — onnxruntime-react-native on a physical iPhone in a RELEASE build.** A known upstream
  report (microsoft/onnxruntime#27062) has `InferenceSession.create` failing in Expo standalone
  iOS builds while working in dev clients and on Android. If it reproduces, the swap path
  (nitro-onnxruntime / ExecuTorch) is confined to `src/translation/onnx/session-manager.ts`.
- **S2 — the Apple Translation hidden host.** `AppleTranslationHost.swift` pumps requests
  through a 1×1 background UIWindow running `.translationTask` — the only way to reach
  `TranslationSession` from a native module. Validate on an iOS 18 device: pack-download
  prompts, batch translation, behavior when backgrounded mid-batch, and iPad multi-window
  (the host binds to the first foreground-active scene).

Also untested until a native build exists: the `decodeImage` RGBA temp-file handoff on both
platforms, ML Kit recognizer accuracy on detector crops (KO/ZH especially), and the
`onMemoryWarning` event path.
