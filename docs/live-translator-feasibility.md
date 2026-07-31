# Live translator — feasibility investigation

*Investigated 2026-07. Scope: on-device, off-the-shelf models only (no training). Goal: when a
reader page loads, detect foreign-language text on the page image and show an English
translation (other target languages nice-to-have). Product decisions so far: optimize for
manga quality; licensing (incl. GPL) is not a constraint.*

## Verdict

**Feasible, manga-first, fully on-device.** The best-for-manga pipeline is a pair of
comic-specialized models — **comic-text-detector** for finding bubbles/text regions and
**manga-ocr** for reading them — run via ONNX Runtime (or ExecuTorch), feeding the OS
translators (Apple Translation framework / ML Kit) for the language step. Combined on-demand
download ≈ **220 MB** (never in the base binary; ~390 MB if iOS takes the fp16-for-CoreML
route in review finding 2). Platform OCR (Vision / ML Kit) stays in the
stack as the recognizer for non-Japanese scripts (KO/ZH are mostly horizontal and fare well)
and as a zero-weight fallback tier. Web should defer to the self-hosted backend.

**And no, iOS does not require a paid developer account for any of this** — see
[the iOS account question](#does-ios-need-a-paid-dev-account) below.

## Review findings (2026-07-31) — read before implementing

*A pass over this doc against the real artifacts and runtime constraints, benchmarked against
an iPhone 12 (A14, 4 GB, 16-core ANE) as the floor device. The architecture holds up; two
specific decisions below do not, and the per-page timing claim is unsupported. Nothing in
`src/translation/` has ever executed — `onnxruntime-react-native` isn't installed, every
manifest `sha256` is still `''` — so every number originally in this doc was an estimate.*

**The device is not the problem.** iPhone 12 runs iOS 18/26 (Translation framework available),
has the ANE, and clears the memory budget: peak looks like 600 MB–1 GB against a ~2 GB jetsam
limit — tight alongside the reader's decoded bitmaps, but survivable, and `onMemoryWarning` is
already wired. Real artifact sizes: comic-text-detector 94.7 MB, manga-ocr 343 MB encoder +
117 MB decoder fp32 → ~125 MB int8. Combined download is ~220 MB, not 200 MB.

**1. The missing KV cache is the wall, not a later optimization.** `manga-ocr-decode.ts` argues
the O(n²) re-run "holds up" because bubbles are short. That accounts only for the prefix. The
dominant cost is that **cross-attention K/V over the 577-token encoder output is recomputed on
every generated token** — ~1.4 GFLOPs per decoder layer per token, ~4 GFLOPs/token across
manga-ocr's ~3-layer decoder, versus ~17.5 GFLOPs for one entire ViT-B/16 encoder pass. A
20-token bubble therefore spends ~5× more compute in the decoder than the encoder, all of it
pure recompute; an 8-bubble page is ~0.8 TFLOPs. An A14 CPU sustains maybe 10–25 GFLOPS on
these GEMMs → **tens of seconds to minutes per page**, not the 0.5–2 s claimed below. Also 20
`session.run()` round-trips per bubble, each re-passing the 1.77 MB encoder hidden state.

Fix before writing more pipeline code: re-export with `past_key_values` (`optimum` ORT export,
`image-to-text-with-past`) and precompute cross-attention K/V once per region. Per-token cost
collapses to ~0.05 GFLOPs, the encoder becomes the cost again (~0.3–0.8 s/region on CPU), and
the change is confined to the adapter exactly as its header comment predicts.

**2. int8 buys download size by forfeiting the ANE.** `manifest.ts` pairs an int8 manga-ocr
with `eps: ['coreml', …]`. Those fight: `DynamicQuantizeLinear` / `MatMulInteger` are not
supported by the CoreML EP ([onnxruntime#22346](https://github.com/microsoft/onnxruntime/issues/22346)),
so those subgraphs fall back to CPU — and on ARM, int8 via MLAS often isn't faster than fp32
anyway. On an iPhone 12 that trades the 11-TOPS accelerator for ~340 MB of download savings.
Prefer fp16 + CoreML on iOS (encoder ~172 MB), int8 + XNNPACK on Android. The detector is
already planned fp32 and is a pure conv net — ideal ANE workload, leave it.

**3. Spike S1 gates everything else.** [onnxruntime#27062](https://github.com/microsoft/onnxruntime/discussions/26536)
— `InferenceSession.create` failing in Expo **standalone** iOS release builds while working in
dev clients — describes exactly this app's distribution mode. Run it before the other two.

**4. Detector post-processing is thinner than the quality claim.** `detector-postprocess.ts`
decodes only the YOLO `blk` head and NMSes it, ignoring the `lines` and `mask` heads.
manga-image-translator's quality comes substantially from line grouping / merging / reading
order; coarse blocks give manga-ocr worse crops. "Manga-grade" isn't earned yet.

**5. The hidden-window Translation host is load-bearing and unvalidated.** Hosting
`.translationTask` in a 1×1 `UIWindow` at `windowLevel = .normal - 1` may not lay out or run
the task at all, and the pack-download prompt wants a real presentation context. It is the only
route to `TranslationSession`; whether *this* route works is a device test (S2).

**Nearest published anchors** for the timing claim below (comparable on-device comic OCR):
~1.5–2 s on a Pixel 8 Pro, 3–4 s on a Galaxy A55. An iPhone 12 sits nearer the A55 for
sustained ML.

## Reframing the problem

Comic pages are **images** (`reader-page.tsx` renders bare URIs via `expo-image`). "Look for
language text" therefore means a 4-stage pipeline, not a text-translation call:

```
page image ─▶ 1. text detection (find bubbles / text regions)
           ─▶ 2. OCR (region → string)
           ─▶ 3. language detect + translate (string → English)
           ─▶ 4. render (overlay translated text on the page in the reader)
```

Every stage has viable off-the-shelf, on-device options. The stage that decides product
quality is 1–2 *for manga specifically*: general-purpose OCR engines were built for
photos/documents and historically score ~40 % on vertical Japanese manga text vs ~85 %+ with
manga-aware handling — which is exactly why the comic-specific models exist.

## The manga-first pipeline (recommended)

| Stage | Model | Size (on-demand) | Notes |
| --- | --- | --- | --- |
| 1. Detection | **comic-text-detector** (dmMaze, ONNX) | 94.7 MB | Purpose-built on ~13 k manga/comic pages; returns bboxes, text *lines*, and pixel masks (masks are the runway to future text-removal/typesetting). Script-agnostic. GPL-3.0 — accepted per product decision. |
| 2. OCR (JA) | **manga-ocr** (kha-white, ViT encoder-decoder, ONNX) | ~460 MB fp32 → **~110–130 MB int8** | The community-standard manga reader: vertical + horizontal, furigana, stylized fonts, whole multi-line bubbles in one pass. Japanese only. Apache-2.0. |
| 2. OCR (non-JA) | Platform OCR (Vision / ML Kit v2) | 0 / ~4 MB per script | KO (manhwa), ZH (manhua), Latin — mostly horizontal, platform engines handle these well. Run on the *detector's* regions. |
| 3. Translation | **Apple Translation framework** (iOS 18+) / **ML Kit Translation** (Android) | 0 shipped; OS/SDK downloads packs (~30 MB per ML Kit language) | On-device, free, ~20 langs (Apple) / 59 (ML Kit, English-pivot). Good-enough dialogue gisting; see upgrades below. |
| 4. Render | Overlay in reader | — | Boxes mapped through the existing zoom transform (`use-zoomable.ts` / `zoomable-page.tsx`); toolbar toggle; tap-bubble or translate-all. |

Runtime: `onnxruntime-react-native` (or `react-native-executorch`) hosts both ONNX models on
iOS + Android from one JS API. Both models are small enough to run per-page in ~0.5–2 s on
recent phones — **estimate, and wrong as the pipeline is currently specified: see review
finding 1 above, which puts it at tens of seconds without a KV-cached decoder export** —
(detector once per page at ~1024 px; manga-ocr per detected region), which
translate-ahead hides entirely: OCR page *n+1* while the user reads page *n*, cache results
keyed by page URI so every page is processed at most once.

Reference implementation: **manga-image-translator** (zyddnys) — the desktop/server project
that chains these exact models (plus inpainting/typesetting). Worth mining for pre/post-
processing details (region merging, reading order, mask thresholds) even though we don't run
it on-device.

### Translation-quality upgrades (JA→EN, later)

Stage 3 is the next quality bottleneck once OCR is manga-grade. Options, in effort order:

- **Sugoi offline model** (JParaCrawl-based Marian, the VN/manga community favorite for
  JA→EN): a few hundred MB, runnable via CTranslate2/ONNX. Meaningfully better than ML Kit on
  dialogue.
- **Small on-device LLM** (Gemma/Qwen class via llama.rn / ExecuTorch): best nuance
  (honorifics, slang, SFX), 1–2 GB and slow on mid-range devices — opt-in only.

Ship with platform translators first; both upgrades slot in behind the same stage-3 interface.

## Does iOS need a paid dev account?

**No.** This matters because the app distributes via SideStore/AltStore free-Apple-ID
re-signing, so anything entitlement-gated is off-limits. The good news:

- **Vision, VisionKit (Live Text), Translation framework, Core ML, Neural Engine access** are
  all plain public frameworks. None appear in the provisioning-profile capabilities list and
  none require an entitlement — free-ID signed apps can use them exactly like App Store apps.
- Free-account restrictions gate *entitlement-backed capabilities* (push notifications,
  iCloud, App Groups, extended memory, NFC, JIT…). The translation pipeline needs none of
  those. ONNX Runtime / ExecuTorch are ordinary linked libraries — also fine.
- **Language-pack downloads** (Apple Translation models, ML Kit packs) are OS/SDK-level asset
  downloads tied to the device, not to a developer account.

Real iOS constraints, none account-related: Translation framework needs **iOS 18+** for the
programmatic batch API (framework floor 17.4); Live Text needs an A12+ (Neural Engine) device;
none of it runs in the simulator — device-only testing.

## Platform assessment

- **iOS**: full manga pipeline + Apple Translation. Feature-gate auto-translate to iOS 18+;
  iOS 16–17 can fall back to VisionKit Live Text (system tap-to-select-translate on the page
  image — also a good early spike to validate overlay coordinate mapping).
- **Android**: same ONNX models + ML Kit Translation. `minSdkVersion 26` clears every floor.
  Decision: bundle ML Kit script models vs Play-Services download (our APK sideloads onto
  Play-equipped devices, so download is fine).
- **Web**: Chrome's built-in Translator/LanguageDetector APIs are desktop-only, and in-browser
  manga OCR is weak. The web build already requires self-hosted `@comical/host-server` — the
  right web answer is a server-side endpoint there, where **manga-image-translator can run
  as-is** (GPL now acceptable). Defer; don't let web shape the native design.

## Recommended phasing

**Phase 0 — spike (days):** VisionKit Live Text on `reader-page` behind a dev flag (iOS only).
Validates coordinate mapping through the zoom stack and gives a baseline feel for OS OCR
quality on real sources.

**Phase 1 — the feature (manga-first MVP):**
- New local Expo module (sibling of `comical-runtime`) exposing
  `translatePage(uri) → [{quad, srcText, dstText, srcLang}]`.
- comic-text-detector + manga-ocr via `onnxruntime-react-native`, downloaded on first enable
  (~200 MB, resumable, never in the base binary); platform OCR for non-JA regions; platform
  translators for stage 3.
- Reader: overlay rendering, toolbar toggle, reader-settings entry (Legend State, like
  `use-reader-settings.ts`), per-page result cache, translate-ahead of the adjacent page.
- Fallback tier: if the model pack isn't downloaded (or a low-end device struggles), run
  platform OCR end-to-end — worse on vertical JP, still useful for KO/ZH/Latin.

**Phase 2 — quality & breadth:** Sugoi or LLM JA→EN behind the stage-3 interface; web via a
host-server endpoint wrapping manga-image-translator; optional text-removal/typesetting using
the detector's masks (inpainting — server-side first).

**Non-goals for now:** training anything, on-device inpainting, web parity in the client.

## Risks / open questions

- **manga-ocr hallucination:** it can "read" plausible text from empty regions — only run it
  on detector-confirmed regions, and threshold on detector confidence.
- **Device floor:** two ONNX models per page on a mid-range Android phone needs profiling
  early (Phase 1 spike). Mitigations: int8 quantization, NNAPI/CoreML execution providers,
  detector input at 1024 px, translate-ahead + cache.
- **Translation register:** platform translators read stiff on slang/SFX/honorifics — label
  output as machine-translated; Sugoi/LLM is the upgrade path.
- **Memory:** the reader already holds several decoded bitmaps; feed the pipeline downscaled
  copies and never retain them.
- **iOS 18 gate** for the automatic path — decide min-OS vs Live-Text fallback for 16/17.
- **KO/ZH quality check:** assumption that platform OCR suffices for manhwa/manhua needs a
  real-content validation pass in Phase 1.
