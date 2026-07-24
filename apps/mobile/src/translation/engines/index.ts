/**
 * Registers the built-in engines. Called once from `src/translation/index.ts`; future engines
 * (Sugoi JA→EN, an LLM translator, a Korean OCR specialist) register here — one line each —
 * and routing/settings pick them up with no other changes.
 */
import { engineRegistry } from '../registry';
import { ComicTextDetectorEngine } from './comic-text-detector';
import { MangaOcrEngine } from './manga-ocr';
import { PlatformOcrEngine } from './platform-ocr';
import { PlatformTranslatorEngine } from './platform-translator';

let registered = false;

export function registerBuiltInEngines(): void {
  if (registered) return;
  registered = true;
  engineRegistry.register(new ComicTextDetectorEngine());
  engineRegistry.register(new MangaOcrEngine());
  engineRegistry.register(new PlatformOcrEngine());
  engineRegistry.register(new PlatformTranslatorEngine());
}
