import ExpoModulesCore

// ComicalBridgeContext is compiled into this same pod (see ComicalRuntime.podspec source_files),
// so it's referenced directly without an `import ComicalHostIOS`.

/**
 * Expo native module "ComicalRuntime": a thin JSON-in/JSON-out wrapper over the shared
 * `ComicalBridgeContext` (JavaScriptCore), keyed by bridge id so several bridges can run at once.
 * The bundle load through @comical/core, capability gating, and host capabilities
 * (URLSession/FileManager/os.log) all live in ComicalBridgeContext.
 *
 * Mirrors the app's `NativeBridgeRuntime` contract (src/data/embedded/types.ts):
 *   initBridge(id, code, settingsJson, networkJson?) -> "{ info, methods }" JSON
 *   callBridge(id, method, argsJson)                 -> raw result JSON
 *   disposeBridge(id)
 */
public final class ComicalRuntimeModule: Module {
  private var bridges: [String: ComicalBridgeContext] = [:]

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
      let ctx = try ComicalBridgeContext(bridgeBundle: code, settings: settings, dataDir: ComicalRuntimeModule.bridgeDataDir(for: id))
      self.bridges[id] = ctx
      return ctx.describeJson()
    }

    AsyncFunction("callBridge") { (id: String, method: String, argsJson: String) -> String in
      guard let ctx = self.bridges[id] else {
        throw NSError(domain: "ComicalRuntime", code: 1, userInfo: [NSLocalizedDescriptionKey: "bridge not initialised: \(id)"])
      }
      return try await ctx.callJson(method, argsJSON: argsJson)
    }

    Function("disposeBridge") { (id: String) in
      self.bridges[id] = nil
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
