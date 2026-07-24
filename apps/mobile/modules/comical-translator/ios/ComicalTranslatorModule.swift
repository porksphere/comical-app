import ExpoModulesCore
import Vision
import UIKit

/**
 * Expo native module "ComicalTranslator" — the iOS backend for the live-translation pipeline.
 * Mirrors the `ComicalTranslatorNative` contract in ../index.ts:
 *
 *   decodeImage(uri, maxDim)                    -> { width, height, channels: 4, path }
 *   recognizeInRegions(uri, regions, scripts)   -> [{ index, text, confidence, lines }]
 *   recognizeFullPage(uri, scripts)             -> [{ text, quad, confidence, lang }]
 *   translationAvailability(src, dst)           -> 'ready' | 'downloadable' | 'unsupported'
 *   prepareTranslation(src, dst)                -> Bool
 *   translateBatch(texts, src, dst)             -> [String]
 *   deleteTranslationPack(src, dst)             -> Bool (always false: packs are OS-managed)
 *
 * Translation runs through AppleTranslationHost (iOS 18+, see AppleTranslationHost.swift);
 * below iOS 18 the three translation functions report 'unsupported' / throw.
 */
public final class ComicalTranslatorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ComicalTranslator")

    Events("onMemoryWarning")

    OnCreate {
      NotificationCenter.default.addObserver(
        forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.sendEvent("onMemoryWarning")
      }
    }

    AsyncFunction("decodeImage") { (uri: String, maxDim: Int) -> [String: Any] in
      let url = Self.localFileURL(uri)
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        throw Self.err("cannot open image: \(uri)")
      }
      var sourceWidth = 0
      var sourceHeight = 0
      if let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
        sourceWidth = props[kCGImagePropertyPixelWidth] as? Int ?? 0
        sourceHeight = props[kCGImagePropertyPixelHeight] as? Int ?? 0
      }
      let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxDim,
      ]
      guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        throw Self.err("cannot decode image: \(uri)")
      }
      let width = cg.width
      let height = cg.height
      var rgba = Data(count: width * height * 4)
      try rgba.withUnsafeMutableBytes { (buf: UnsafeMutableRawBufferPointer) in
        guard let ctx = CGContext(
          data: buf.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { throw Self.err("cannot create bitmap context") }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
      }
      let out = FileManager.default.temporaryDirectory
        .appendingPathComponent("translator-decode-\(UUID().uuidString).rgba")
      try rgba.write(to: out)
      return [
        "width": width, "height": height, "channels": 4, "path": out.path,
        "sourceWidth": sourceWidth > 0 ? sourceWidth : width,
        "sourceHeight": sourceHeight > 0 ? sourceHeight : height,
      ]
    }

    AsyncFunction("imageSize") { (uri: String) -> [String: Int] in
      let url = Self.localFileURL(uri)
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = props[kCGImagePropertyPixelWidth] as? Int,
            let height = props[kCGImagePropertyPixelHeight] as? Int
      else { throw Self.err("cannot read image size: \(uri)") }
      return ["width": width, "height": height]
    }

    AsyncFunction("recognizeInRegions") { (uri: String, regions: [[String: Double]], scripts: [String]) -> [[String: Any]] in
      let cg = try Self.loadCGImage(uri)
      var results: [[String: Any]] = []
      for (index, r) in regions.enumerated() {
        let rect = CGRect(x: r["x"] ?? 0, y: r["y"] ?? 0, width: r["w"] ?? 0, height: r["h"] ?? 0)
          .intersection(CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        guard !rect.isEmpty, let crop = cg.cropping(to: rect) else {
          results.append(["index": index, "text": "", "confidence": 0.0, "lines": [[String: Any]]()])
          continue
        }
        let observations = try Self.runTextRequest(on: crop, scripts: scripts)
        var lines: [[String: Any]] = []
        var texts: [String] = []
        var confidence = 0.0
        for obs in observations {
          guard let candidate = obs.topCandidates(1).first else { continue }
          texts.append(candidate.string)
          confidence = max(confidence, Double(candidate.confidence))
          // Vision coords are normalized with a bottom-left origin; map into original-image px
          // (top-left origin) and offset by the crop position.
          lines.append([
            "text": candidate.string,
            "quad": Self.quad(from: obs.boundingBox, cropRect: rect, cropHeight: rect.height),
          ])
        }
        results.append([
          "index": index,
          "text": texts.joined(separator: "\n"),
          "confidence": confidence,
          "lines": lines,
        ])
      }
      return results
    }

    AsyncFunction("recognizeFullPage") { (uri: String, scripts: [String]) -> [[String: Any]] in
      let cg = try Self.loadCGImage(uri)
      let pageRect = CGRect(x: 0, y: 0, width: cg.width, height: cg.height)
      let observations = try Self.runTextRequest(on: cg, scripts: scripts)
      return observations.compactMap { obs in
        guard let candidate = obs.topCandidates(1).first else { return nil }
        return [
          "text": candidate.string,
          "quad": Self.quad(from: obs.boundingBox, cropRect: pageRect, cropHeight: pageRect.height),
          "confidence": Double(candidate.confidence),
          "lang": NSNull(),
        ]
      }
    }

    AsyncFunction("translationAvailability") { (src: String, dst: String) -> String in
      if #available(iOS 18.0, *) {
        return await AppleTranslationHost.shared.availability(src: src, dst: dst)
      }
      return "unsupported"
    }

    AsyncFunction("prepareTranslation") { (src: String, dst: String) -> Bool in
      if #available(iOS 18.0, *) {
        return try await AppleTranslationHost.shared.prepare(src: src, dst: dst)
      }
      throw Self.err("Apple Translation requires iOS 18")
    }

    AsyncFunction("translateBatch") { (texts: [String], src: String, dst: String) -> [String] in
      if #available(iOS 18.0, *) {
        return try await AppleTranslationHost.shared.translate(texts: texts, src: src, dst: dst)
      }
      throw Self.err("Apple Translation requires iOS 18")
    }

    AsyncFunction("deleteTranslationPack") { (_: String, _: String) -> Bool in
      return false // iOS packs are OS-managed (Settings > Translate); nothing to delete per-app.
    }
  }

  // MARK: - helpers

  private static func err(_ message: String) -> NSError {
    NSError(domain: "ComicalTranslator", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private static func localFileURL(_ uri: String) -> URL {
    if let url = URL(string: uri), url.isFileURL { return url }
    return URL(fileURLWithPath: uri)
  }

  private static func loadCGImage(_ uri: String) throws -> CGImage {
    let url = localFileURL(uri)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cg = CGImageSourceCreateImageAtIndex(source, 0, [
            kCGImageSourceShouldCache: false,
          ] as CFDictionary)
    else { throw err("cannot open image: \(uri)") }
    return cg
  }

  /** Vision recognition languages for our script hints. Unknown hints fall back to English. */
  private static func recognitionLanguages(for scripts: [String]) -> [String] {
    var langs: [String] = []
    for script in scripts {
      switch script {
      case "Jpan": langs.append("ja-JP")
      case "Kore": langs.append("ko-KR")
      case "Hani": langs.append(contentsOf: ["zh-Hans", "zh-Hant"])
      default: langs.append("en-US")
      }
    }
    if langs.isEmpty { langs = ["en-US"] }
    return langs
  }

  private static func runTextRequest(on image: CGImage, scripts: [String]) throws -> [VNRecognizedTextObservation] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false // comic lettering trips the language model's corrections
    request.recognitionLanguages = recognitionLanguages(for: scripts)
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    return request.results ?? []
  }

  /** Map a Vision normalized bounding box (bottom-left origin) into original-image pixel quad. */
  private static func quad(from box: CGRect, cropRect: CGRect, cropHeight: CGFloat) -> [[Double]] {
    let x = cropRect.origin.x + box.origin.x * cropRect.width
    let yTop = cropRect.origin.y + (1 - box.origin.y - box.height) * cropHeight
    let w = box.width * cropRect.width
    let h = box.height * cropHeight
    return [
      [Double(x), Double(yTop)],
      [Double(x + w), Double(yTop)],
      [Double(x + w), Double(yTop + h)],
      [Double(x), Double(yTop + h)],
    ]
  }
}
