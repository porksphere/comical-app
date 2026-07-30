import ExpoModulesCore

// ComicalBridgeContext / ComicalTrackerContext are compiled into this same pod (see
// ComicalRuntime.podspec source_files), so they're referenced directly without an
// `import ComicalHostIOS`.

/**
 * Expo native module "ComicalRuntime": a thin JSON-in/JSON-out wrapper over the shared
 * `ComicalBridgeContext` / `ComicalTrackerContext` (both JavaScriptCore), keyed by id so several
 * bridges/trackers can run at once. The bundle load through @comical/core, capability gating, and
 * host capabilities (URLSession/FileManager/os.log) all live in those context classes.
 *
 * Mirrors the app's `NativeBridgeRuntime` + `NativeTrackerRuntime` contracts (@comical/host-rn):
 *   initBridge(id, code, settingsJson, networkJson?) -> "{ info, methods }" JSON
 *   callBridge(id, method, argsJson)                 -> raw result JSON
 *   disposeBridge(id)
 *   initTracker(id, code, settingsJson, networkJson?) -> "{ info, methods }" JSON
 *   callTracker(id, method, argsJson)                 -> raw result JSON
 *   disposeTracker(id)
 *   drainTrackerSettingsPatch(id)                     -> "{ key, blob }" JSON, or null
 */
public final class ComicalRuntimeModule: Module {
  // AsyncFunction closures below run on whatever executor Swift Concurrency schedules them on, and
  // the app calls initBridge/callBridge for several source ids concurrently (e.g. a multi-source
  // search). Plain Dictionary mutation isn't safe under concurrent access — it previously crashed
  // with EXC_BAD_ACCESS inside Swift's Dictionary COW check (COMICAL-APP-1S). Guard both maps with a
  // lock, mirroring the ConcurrentHashMap the Android side already uses for the same reason.
  private let stateLock = NSLock()
  private var bridges: [String: ComicalBridgeContext] = [:]
  private var trackers: [String: ComicalTrackerContext] = [:]

  private func bridge(for id: String) -> ComicalBridgeContext? {
    stateLock.lock(); defer { stateLock.unlock() }
    return bridges[id]
  }

  private func setBridge(_ ctx: ComicalBridgeContext, for id: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    bridges[id] = ctx
  }

  private func removeBridge(for id: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    bridges[id] = nil
  }

  private func tracker(for id: String) -> ComicalTrackerContext? {
    stateLock.lock(); defer { stateLock.unlock() }
    return trackers[id]
  }

  private func setTracker(_ ctx: ComicalTrackerContext, for id: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    trackers[id] = ctx
  }

  private func removeTracker(for id: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    trackers[id] = nil
  }

  public func definition() -> ModuleDefinition {
    Name("ComicalRuntime")

    AsyncFunction("initBridge") { (id: String, code: String, settingsJson: String, networkJson: String?) -> String in
      // networkJson (GatedNetwork overrides) isn't yet threaded through the iOS ComicalBridgeContext
      // init — parity TODO; Android already forwards it.
      _ = networkJson
      let settings = (try? JSONSerialization.jsonObject(with: Data(settingsJson.utf8))) as? [String: Any] ?? [:]
      // Give each bridge its own storage dir. Without an explicit dataDir, ComicalBridgeContext
      // defaults to a single shared `temporaryDirectory/comical`, so every bridge's `storage`
      // capability (cookies, per-bridge KV) would collide in one storage.json — and temporary is
      // purgeable. Namespace persistently by bridge id instead.
      let ctx = try await ComicalBridgeContext(bridgeBundle: code, settings: settings, dataDir: ComicalRuntimeModule.bridgeDataDir(for: id))
      self.setBridge(ctx, for: id)
      return ctx.describeJson()
    }

    AsyncFunction("callBridge") { (id: String, method: String, argsJson: String) -> String in
      guard let ctx = self.bridge(for: id) else {
        throw NSError(domain: "ComicalRuntime", code: 1, userInfo: [NSLocalizedDescriptionKey: "bridge not initialised: \(id)"])
      }
      return try await ctx.callJson(method, argsJSON: argsJson)
    }

    Function("disposeBridge") { (id: String) in
      self.removeBridge(for: id)
    }

    AsyncFunction("initTracker") { (id: String, code: String, settingsJson: String, networkJson: String?) -> String in
      // See initBridge's note — networkJson parity TODO on iOS.
      _ = networkJson
      let settings = (try? JSONSerialization.jsonObject(with: Data(settingsJson.utf8))) as? [String: Any] ?? [:]
      // Namespace persistently by tracker id, same rationale as bridges (own storage.json each, so
      // e.g. AniList's and MAL's OAuth tokens/cookies never collide).
      let ctx = try ComicalTrackerContext(trackerBundle: code, settings: settings, dataDir: ComicalRuntimeModule.trackerDataDir(for: id))
      self.setTracker(ctx, for: id)
      return ctx.describeJson()
    }

    AsyncFunction("callTracker") { (id: String, method: String, argsJson: String) -> String in
      guard let ctx = self.tracker(for: id) else {
        throw NSError(domain: "ComicalRuntime", code: 1, userInfo: [NSLocalizedDescriptionKey: "tracker not initialised: \(id)"])
      }
      return try await ctx.callJson(method, argsJSON: argsJson)
    }

    Function("disposeTracker") { (id: String) in
      self.removeTracker(for: id)
    }

    AsyncFunction("drainTrackerSettingsPatch") { (id: String) -> String? in
      guard let ctx = self.tracker(for: id) else {
        throw NSError(domain: "ComicalRuntime", code: 1, userInfo: [NSLocalizedDescriptionKey: "tracker not initialised: \(id)"])
      }
      return ctx.drainSettingsPatch()
    }
  }

  /// A persistent, per-bridge data directory: `<Application Support>/comical/bridges/<id>`. Falls back
  /// to the temp dir only if Application Support is somehow unavailable. The id is sanitised to a safe
  /// single path component so a hostile registry id can't traverse out of the bridges folder.
  private static func bridgeDataDir(for id: String) -> URL {
    let base = (try? FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    )) ?? FileManager.default.temporaryDirectory
    return base
      .appendingPathComponent("comical", isDirectory: true)
      .appendingPathComponent("bridges", isDirectory: true)
      .appendingPathComponent(safePathComponent(id), isDirectory: true)
  }

  /// Same shape as `bridgeDataDir`, under `.../comical/trackers/<id>` instead — kept fully separate
  /// from bridge storage since tracker ids and bridge ids are different id spaces that could collide.
  private static func trackerDataDir(for id: String) -> URL {
    let base = (try? FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    )) ?? FileManager.default.temporaryDirectory
    return base
      .appendingPathComponent("comical", isDirectory: true)
      .appendingPathComponent("trackers", isDirectory: true)
      .appendingPathComponent(safePathComponent(id), isDirectory: true)
  }

  /// Map a bridge id to a safe filesystem path component: keep ASCII alphanumerics plus `-_.`, replace
  /// anything else with `_`, and never let it be empty or resolve to `.`/`..` (directory traversal).
  private static func safePathComponent(_ id: String) -> String {
    let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.")
    let mapped = String(id.map { allowed.contains($0) ? $0 : "_" })
    if mapped.isEmpty { return "_" }
    if mapped == "." || mapped == ".." { return "_" + mapped }
    return mapped
  }
}
