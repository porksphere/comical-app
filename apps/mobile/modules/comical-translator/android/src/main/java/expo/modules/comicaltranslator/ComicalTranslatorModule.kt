package expo.modules.comicaltranslator

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.tasks.await
import java.io.File
import java.util.UUID

/**
 * Expo native module "ComicalTranslator" — the Android backend for the live-translation
 * pipeline. Mirrors the `ComicalTranslatorNative` contract in ../index.ts; see the iOS
 * ComicalTranslatorModule.swift for the shared function-by-function contract notes.
 *
 * OCR: ML Kit Text Recognition v2 with the bundled per-script recognizers.
 * Translation: ML Kit on-device Translation (packs download on demand, ~30 MB per language).
 */
class ComicalTranslatorModule : Module() {
  // ML Kit clients are expensive to spin up; cache per script / language pair for the app's
  // lifetime (they hold native resources but are designed to be long-lived singletons).
  private val recognizers = mutableMapOf<String, TextRecognizer>()
  private val translators = mutableMapOf<String, Translator>()

  private val memoryCallbacks = object : ComponentCallbacks2 {
    override fun onConfigurationChanged(newConfig: Configuration) {}
    @Deprecated("ComponentCallbacks2 requires the override")
    override fun onLowMemory() {
      sendEvent("onMemoryWarning")
    }
    override fun onTrimMemory(level: Int) {
      if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) sendEvent("onMemoryWarning")
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ComicalTranslator")

    Events("onMemoryWarning")

    OnCreate {
      appContext.reactContext?.registerComponentCallbacks(memoryCallbacks)
    }

    OnDestroy {
      appContext.reactContext?.unregisterComponentCallbacks(memoryCallbacks)
      translators.values.forEach { it.close() }
      translators.clear()
    }

    AsyncFunction("decodeImage") Coroutine { uri: String, maxDim: Int ->
      val path = localPath(uri)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw Exception("cannot decode image: $uri")

      // Power-of-two subsample close to maxDim, then an exact scale if still oversized.
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDim) sample *= 2
      val opts = BitmapFactory.Options().apply { inSampleSize = sample }
      var bitmap = BitmapFactory.decodeFile(path, opts) ?: throw Exception("cannot decode image: $uri")
      val largest = maxOf(bitmap.width, bitmap.height)
      if (largest > maxDim) {
        val scale = maxDim.toFloat() / largest
        val scaled = Bitmap.createScaledBitmap(
          bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1),
          (bitmap.height * scale).toInt().coerceAtLeast(1), true)
        if (scaled !== bitmap) bitmap.recycle()
        bitmap = scaled
      }

      val width = bitmap.width
      val height = bitmap.height
      val pixels = IntArray(width * height)
      bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
      bitmap.recycle()
      val rgba = ByteArray(width * height * 4)
      for (i in pixels.indices) {
        val p = pixels[i] // ARGB
        val o = i * 4
        rgba[o] = ((p shr 16) and 0xff).toByte()
        rgba[o + 1] = ((p shr 8) and 0xff).toByte()
        rgba[o + 2] = (p and 0xff).toByte()
        rgba[o + 3] = ((p ushr 24) and 0xff).toByte()
      }
      val out = File(appContext.cacheDirectory, "translator-decode-${UUID.randomUUID()}.rgba")
      out.writeBytes(rgba)
      mapOf(
        "width" to width, "height" to height, "channels" to 4, "path" to out.absolutePath,
        "sourceWidth" to bounds.outWidth, "sourceHeight" to bounds.outHeight,
      )
    }

    AsyncFunction("imageSize") Coroutine { uri: String ->
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(localPath(uri), bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw Exception("cannot read image size: $uri")
      mapOf("width" to bounds.outWidth, "height" to bounds.outHeight)
    }

    AsyncFunction("recognizeInRegions") Coroutine { uri: String, regions: List<Map<String, Double>>, scripts: List<String> ->
      val bitmap = BitmapFactory.decodeFile(localPath(uri)) ?: throw Exception("cannot decode image: $uri")
      try {
        val recognizer = recognizerFor(scripts)
        regions.mapIndexed { index, r ->
          val rect = Rect(
            (r["x"] ?: 0.0).toInt().coerceIn(0, bitmap.width),
            (r["y"] ?: 0.0).toInt().coerceIn(0, bitmap.height),
            ((r["x"] ?: 0.0) + (r["w"] ?: 0.0)).toInt().coerceIn(0, bitmap.width),
            ((r["y"] ?: 0.0) + (r["h"] ?: 0.0)).toInt().coerceIn(0, bitmap.height),
          )
          if (rect.width() <= 0 || rect.height() <= 0) {
            return@mapIndexed mapOf(
              "index" to index, "text" to "", "confidence" to 0.0, "lines" to emptyList<Any>())
          }
          val crop = Bitmap.createBitmap(bitmap, rect.left, rect.top, rect.width(), rect.height())
          try {
            val text = recognizer.process(InputImage.fromBitmap(crop, 0)).await()
            val lines = text.textBlocks.flatMap { it.lines }.map { line ->
              mapOf(
                "text" to line.text,
                // ML Kit corner points are crop-relative; shift back into original-image px.
                "quad" to (line.cornerPoints ?: emptyArray()).map {
                  listOf((it.x + rect.left).toDouble(), (it.y + rect.top).toDouble())
                },
              )
            }
            val confidence = text.textBlocks.flatMap { it.lines }
              .mapNotNull { it.confidence }.maxOrNull() ?: 0f
            mapOf(
              "index" to index,
              "text" to text.text,
              "confidence" to confidence.toDouble(),
              "lines" to lines,
            )
          } finally {
            if (crop !== bitmap) crop.recycle()
          }
        }
      } finally {
        bitmap.recycle()
      }
    }

    AsyncFunction("recognizeFullPage") Coroutine { uri: String, scripts: List<String> ->
      val bitmap = BitmapFactory.decodeFile(localPath(uri)) ?: throw Exception("cannot decode image: $uri")
      try {
        val recognizer = recognizerFor(scripts)
        val text = recognizer.process(InputImage.fromBitmap(bitmap, 0)).await()
        text.textBlocks.map { block ->
          mapOf(
            "text" to block.text,
            "quad" to (block.cornerPoints ?: emptyArray()).map {
              listOf(it.x.toDouble(), it.y.toDouble())
            },
            "confidence" to (block.lines.mapNotNull { it.confidence }.maxOrNull() ?: 0f).toDouble(),
            "lang" to block.recognizedLanguage.ifEmpty { null },
          )
        }
      } finally {
        bitmap.recycle()
      }
    }

    AsyncFunction("translationAvailability") Coroutine { src: String, dst: String ->
      val srcLang = TranslateLanguage.fromLanguageTag(src)
      val dstLang = TranslateLanguage.fromLanguageTag(dst)
      if (srcLang == null || dstLang == null) return@Coroutine "unsupported"
      val manager = RemoteModelManager.getInstance()
      val srcReady = manager.isModelDownloaded(TranslateRemoteModel.Builder(srcLang).build()).await()
      val dstReady = manager.isModelDownloaded(TranslateRemoteModel.Builder(dstLang).build()).await()
      // ML Kit pivots through English: 'en' itself needs no pack, everything else needs its own.
      val ready = (srcLang == TranslateLanguage.ENGLISH || srcReady) &&
        (dstLang == TranslateLanguage.ENGLISH || dstReady)
      if (ready) "ready" else "downloadable"
    }

    AsyncFunction("prepareTranslation") Coroutine { src: String, dst: String ->
      translatorFor(src, dst).downloadModelIfNeeded(DownloadConditions.Builder().build()).await()
      true
    }

    AsyncFunction("translateBatch") Coroutine { texts: List<String>, src: String, dst: String ->
      val translator = translatorFor(src, dst)
      texts.map { translator.translate(it).await() }
    }

    AsyncFunction("deleteTranslationPack") Coroutine { src: String, dst: String ->
      val manager = RemoteModelManager.getInstance()
      var deleted = false
      for (tag in listOf(src, dst)) {
        val lang = TranslateLanguage.fromLanguageTag(tag) ?: continue
        if (lang == TranslateLanguage.ENGLISH) continue
        manager.deleteDownloadedModel(TranslateRemoteModel.Builder(lang).build()).await()
        deleted = true
      }
      // Drop cached translator clients that reference the deleted packs.
      translators.values.forEach { it.close() }
      translators.clear()
      deleted
    }
  }

  private fun localPath(uri: String): String =
    if (uri.startsWith("file://")) uri.removePrefix("file://") else uri

  private fun recognizerFor(scripts: List<String>): TextRecognizer {
    // One recognizer per request set; the first non-Latin script wins (ML Kit's CJK recognizers
    // all read Latin too, so mixed pages still resolve).
    val script = scripts.firstOrNull { it != "Latn" } ?: "Latn"
    return recognizers.getOrPut(script) {
      when (script) {
        "Jpan" -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        "Kore" -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        "Hani" -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        else -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      }
    }
  }

  private fun translatorFor(src: String, dst: String): Translator {
    val srcLang = TranslateLanguage.fromLanguageTag(src) ?: throw Exception("unsupported language: $src")
    val dstLang = TranslateLanguage.fromLanguageTag(dst) ?: throw Exception("unsupported language: $dst")
    return translators.getOrPut("$src->$dst") {
      Translation.getClient(
        TranslatorOptions.Builder().setSourceLanguage(srcLang).setTargetLanguage(dstLang).build())
    }
  }
}
