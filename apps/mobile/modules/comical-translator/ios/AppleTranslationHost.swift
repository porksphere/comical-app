import SwiftUI
import Translation
import UIKit

/**
 * Apple's Translation framework only vends a `TranslationSession` through the SwiftUI
 * `.translationTask` view modifier — there is no direct "give me a session" API. This host
 * works around that: a 1x1, hit-test-disabled UIWindow hosts a SwiftUI view per language pair;
 * the view's `translationTask` hands us the session, and requests are pumped to it through
 * checked continuations. Sessions are cached per (src, dst) and torn down when the window is
 * dropped. All of this is an implementation detail of ComicalTranslatorModule — nothing else
 * should import this file's types.
 */
@available(iOS 18.0, *)
actor AppleTranslationHost {
  static let shared = AppleTranslationHost()

  private var pumps: [String: TranslationPump] = [:]

  func availability(src: String, dst: String) async -> String {
    let availability = LanguageAvailability()
    let status = await availability.status(
      from: Locale.Language(identifier: src), to: Locale.Language(identifier: dst))
    switch status {
    case .installed: return "ready"
    case .supported: return "downloadable"
    case .unsupported: return "unsupported"
    @unknown default: return "unsupported"
    }
  }

  func prepare(src: String, dst: String) async throws -> Bool {
    let pump = await pump(src: src, dst: dst)
    try await pump.run { session in
      // Presents the system download prompt if the pack is missing; resolves once usable.
      try await session.prepareTranslation()
    }
    return true
  }

  func translate(texts: [String], src: String, dst: String) async throws -> [String] {
    guard !texts.isEmpty else { return [] }
    let pump = await pump(src: src, dst: dst)
    return try await pump.run { session in
      let requests = texts.enumerated().map {
        TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
      }
      var out = [String](repeating: "", count: texts.count)
      for try await response in session.translate(batch: requests) {
        if let id = response.clientIdentifier, let index = Int(id), out.indices.contains(index) {
          out[index] = response.targetText
        }
      }
      return out
    }
  }

  private func pump(src: String, dst: String) async -> TranslationPump {
    let key = "\(src)->\(dst)"
    if let existing = pumps[key] { return existing }
    let created = await TranslationPump(src: src, dst: dst)
    pumps[key] = created
    return created
  }
}

/**
 * One hidden SwiftUI host per language pair. `run` enqueues a closure that receives the live
 * `TranslationSession`; the SwiftUI side executes queued work inside `translationTask`, which
 * is the only context where the session is valid.
 */
@available(iOS 18.0, *)
@MainActor
final class TranslationPump {
  typealias Work = @Sendable (TranslationSession) async -> Void

  private var window: UIWindow?
  private let queue = AsyncStream<Work>.makeStream()

  init(src: String, dst: String) {
    let configuration = TranslationSession.Configuration(
      source: Locale.Language(identifier: src), target: Locale.Language(identifier: dst))
    let view = PumpView(configuration: configuration, work: queue.stream)
    guard let scene = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared
      .connectedScenes.compactMap({ $0 as? UIWindowScene }).first
    else { return }
    let window = UIWindow(windowScene: scene)
    window.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    window.isUserInteractionEnabled = false
    window.windowLevel = .normal - 1 // behind the app's real window; never visible or tappable
    window.rootViewController = UIHostingController(rootView: view)
    window.isHidden = false
    self.window = window
  }

  func run<T: Sendable>(_ body: @escaping @Sendable (TranslationSession) async throws -> T) async throws -> T {
    guard window != nil else {
      throw NSError(domain: "ComicalTranslator", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "no active window scene for translation host"])
    }
    return try await withCheckedThrowingContinuation { continuation in
      queue.continuation.yield { session in
        do { continuation.resume(returning: try await body(session)) }
        catch { continuation.resume(throwing: error) }
      }
    }
  }
}

@available(iOS 18.0, *)
private struct PumpView: View {
  let configuration: TranslationSession.Configuration
  let work: AsyncStream<TranslationPump.Work>

  var body: some View {
    Color.clear
      .translationTask(configuration) { session in
        for await job in work {
          await job(session)
        }
      }
  }
}
