# Live translator — feasibility investigation

*Investigated 2026-07. Scope: on-device, off-the-shelf models only (no training). Goal: when a
reader page loads, detect foreign-language text on the page image and show an English
translation (other target languages nice-to-have).*

## Verdict

**Feasible on iOS and Android with zero shipped model weight**, using OS-provided ML stacks
(Apple Vision + Translation framework; Google ML Kit) wired through the same local-Expo-module
pattern `modules/comical-runtime` already proves out. Quality on *manga-style* Japanese
(vertical text, stylized fonts, furigana) is the weak point of the OS stacks; a
comic-specialized OCR model (manga-ocr, Apache-2.0, ~110 MB quantized) is the proven upgrade
path and runs on-device via ONNX Runtime / ExecuTorch. Web is the odd one out: Chrome's
built-in Translator API covers translation (desktop only), but there is no good in-browser
manga OCR — the web build should lean on its existing self-hosted backend instead.

## Reframing the problem

Comic pages are **images** (`reader-page.tsx` renders bare URIs via `expo-image`). "Look for
language text" therefore means a 4-stage pipeline, not a text-translation call:

```
page image ─▶ 1. text detection (find bubbles / text regions)
           ─▶ 2. OCR (region → string)
           ─▶ 3. language detect + translate (string → English)
           ─▶ 4. render (overlay translated text on the page in the reader)
```

Every stage has viable off-the-shelf, on-device options. The hard part is stage 1–2 *for manga
specifically*: general-purpose OCR engines were built for photos/documents and historically
score ~40 % on vertical Japanese manga text vs ~85 %+ with manga-aware handling — which is
exactly why comic-specific models (manga-ocr, comic-text-detector) exist.

## Candidate inventory

### Stage 1–2: detection + OCR

| Option | Platforms | Languages | Size cost | Manga quality | License |
| --- | --- | --- | --- | --- | --- |
| **Apple Vision** (`VNRecognizeTextRequest`) | iOS 16+ | Latin + JA/KO/ZH + more | 0 (in OS) | OK horizontal; weak vertical/stylized | OS API |
| **Google ML Kit Text Recognition v2** | Android (+iOS pod) | Latin, JA, KO, ZH, Devanagari | ~4 MB/script bundled, or via Play Services | Same caveat; vertical JP improved recently but still the weak spot | free, closed |
| **manga-ocr** (kha-white, ViT encoder-decoder) | any, via ONNX Runtime RN / ExecuTorch | **JA only** | ~460 MB fp32 ONNX → ~110–130 MB int8-quantized | **Excellent**: vertical, furigana, multi-line bubbles in one pass | **Apache-2.0** ✅ |
| **comic-text-detector** (dmMaze) | any, ONNX | script-agnostic bubble/text-mask detection | ~80 MB | purpose-built (bboxes, lines, masks) | **GPL-3.0** ⚠️ |
| **react-native-executorch** (Software Mansion) | RN, iOS+Android | OCR + *experimental vertical OCR* built in | model-dependent | untested on manga; worth a spike | MIT (lib) |

Notes:
- ML Kit has maintained RN wrappers (`@react-native-ml-kit/text-recognition`); config-plugin
  friendly, works in Expo prebuild.
- manga-ocr recognizes a *cropped region*; it still needs stage 1 (region detection) from
  something else — Vision/ML Kit block detection is usable for that even when their
  *recognition* is weak, since detection is script-shape, not reading.
- comic-text-detector's GPL-3.0 is a real problem: this repo ships unlicensed (proprietary)
  binaries, and linking/shipping GPL model+code would obligate GPL for the app. **Avoid unless
  we're willing to relicense**; manga-ocr (Apache) + platform detection avoids it entirely.

### Stage 3: translation

| Option | Platforms | Languages | Size cost | Quality | Notes |
| --- | --- | --- | --- | --- | --- |
| **Apple Translation framework** (`TranslationSession`) | iOS 17.4+ (batch API effectively iOS 18+) | ~20 incl. JA/KO/ZH→EN | 0 shipped; OS downloads packs on demand | good | fully on-device, free, Swift API — callable from our Expo module |
| **ML Kit Translation** | Android (+iOS) | 59 | ~30 MB per language pack, downloaded on demand | "casual" tier; non-EN pairs pivot through English | same models as Google Translate offline mode |
| **Chrome Translator + LanguageDetector APIs** | Web, Chrome desktop only (stable since ~141) | many | 0 (browser downloads) | good | `window.Translator.create()`; **not available on mobile browsers** |
| **Bergamot/Firefox-style Marian, OPUS-MT via ONNX** | any | many pairs | ~20–40 MB/pair shipped by us | decent | fallback if we want one engine everywhere; more integration work |
| **Small on-device LLM** (Gemma/Qwen via llama.rn / ExecuTorch) | iOS/Android high-end | many | 1–2 GB | best JA→EN nuance | too heavy for default path; possible opt-in later |

Stage 3 language detection is nearly free everywhere (ML Kit Language ID, `NLLanguageRecognizer`,
`window.LanguageDetector`) and also serves as the "is this page even foreign-language?" gate.

### Stage 4: rendering

All OCR options return bounding boxes/quads in image coordinates. Two UX tiers:

1. **Overlay tier (recommended v1):** absolutely-positioned translated-text chips over the page,
   mapped through the existing zoom transform (`use-zoomable.ts` / `zoomable-page.tsx`), with a
   reader-toolbar toggle. Tap a bubble → show translation; or "translate all" renders every box.
2. **Typeset tier (not v1):** erase original text (inpainting, e.g. LaMa) and re-typeset — this
   is what desktop projects like manga-image-translator do. Heavy models, heavy GPU cost, and
   destructive to art. Skip on-device; only sensible as a server feature later.

**iOS shortcut worth knowing:** VisionKit's `ImageAnalysisInteraction` (Live Text, iOS 16+)
gives system-native select-text + translate on any image view for ~50 lines of native code —
no models, no pipeline. It's tap-driven rather than automatic, so it's not the requested
feature, but it's a nearly-free "translate this bubble" affordance and a good spike vehicle.

## Platform assessment

### iOS — best story
- Vision (detection + OCR) and Translation framework are both on-device, free, and add **zero
  binary size**; language packs download on first use with a user prompt.
- Min-OS note: `TranslationSession` batch translation wants iOS 18 (framework floor 17.4).
  Feature-gate: iOS 18+ gets auto-translate; iOS 16–17 can still get Live Text.
- No special entitlements → no conflict with the free-Apple-ID / SideStore signing story.

### Android — good story
- ML Kit Text Recognition v2 (JA/KO/ZH models) + ML Kit Translation, both on-device.
  `minSdkVersion 26` clears ML Kit's floor comfortably.
- Decision: bundle recognition models (bigger APK, works offline day one) vs Play Services
  download (small APK; but our APK sideloads on devices that all have Play anyway).
- Translation quality is a notch below Apple's for JA→EN and pivots through English for
  non-EN targets — acceptable for dialogue gisting, which is the use case.

### Web — punt or proxy
- Chrome's Translator/LanguageDetector APIs are stable but **desktop-only**, and in-browser OCR
  options (tesseract.js, PaddleOCR via onnxruntime-web) are poor-to-mediocre on manga.
- The web build already requires a self-hosted `@comical/host-server`; the honest web answer is
  a server-side pipeline endpoint there (self-hosted, so GPL tools like manga-image-translator
  are *usable* server-side without shipping GPL in the app — still worth a licensing sanity
  check before adopting). Defer web; don't let it shape the native design.

## Recommended phasing

**Phase 0 — spike (days):** VisionKit Live Text on `reader-page` behind a dev flag (iOS only).
Validates coordinate mapping through the zoom stack and gives a feel for OS-level OCR quality
on real sources, before any pipeline work.

**Phase 1 — MVP (the actual feature):** per-platform native pipeline in a new local Expo module
(sibling of `comical-runtime`):
- iOS: Vision OCR → Translation framework (iOS 18+).
- Android: ML Kit Text Recognition v2 → ML Kit Translation.
- JS side: a `translatePage(uri) → [{quad, srcText, dstText, srcLang}]` API; overlay rendering
  in the reader; a reader-settings toggle (Legend State, like `use-reader-settings.ts`);
  results cached keyed by page URI so each page is OCR'd once (translation of *n* bubbles is
  fast; OCR dominates). Auto-translate the *next* page while the current one is read — the
  reader already knows adjacency, and this hides the ~0.5–2 s per-page pipeline latency.
- Ship weight: ~0. Language coverage: JA/KO/ZH/most European → EN, plus EN → ~20–59 targets.

**Phase 2 — manga-quality upgrade (optional, JA-focused):** add manga-ocr as an on-demand
downloadable model (~110–130 MB quantized ONNX; download-on-enable like ML Kit packs, never in
the base binary) running via `onnxruntime-react-native` or ExecuTorch. Use platform OCR's
*detection* output (or executorch's vertical-OCR detector) for regions, manga-ocr for
recognition, platform translators for stage 3. This is the difference between "usable" and
"good" on vertical Japanese manga — but ship Phase 1 first and let real quality complaints
justify it.

**Non-goals for now:** bubble inpainting/typesetting, on-device LLM translation, training
anything, web parity.

## Risks / open questions

- **OS OCR quality on manga is the main product risk.** Phase 1 might read stylized vertical JP
  bubbles badly enough to frustrate; Phase 2 is the mitigation, but it's JA-only. KO (manhwa)
  and ZH (manhua) are mostly horizontal and should fare much better in Phase 1.
- **manga-ocr hallucination:** it can "read" plausible text from empty regions — gate it on a
  detector's text-confidence, don't run it on arbitrary crops.
- **Translation register:** ML Kit especially is "casual gist" quality; comic dialogue
  (slang, SFX, honorifics) will read stiff. Set expectations in the UI ("machine translated").
- **Memory:** the reader already holds several decoded page bitmaps; the pipeline should feed
  downscaled copies to OCR (Vision/ML Kit are fine at ~1500 px long edge) and never retain them.
- **Licensing:** manga-ocr Apache-2.0 ✅; ML Kit/Vision are OS/vendor APIs ✅;
  comic-text-detector and manga-image-translator GPL-3.0 ⚠️ — client-side use is effectively
  off the table while the app is unlicensed/proprietary.
- **iOS 18 gate for auto-translate** — need a decision on min-OS or a graceful tap-to-Live-Text
  fallback for 16/17.
