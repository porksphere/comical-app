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
      let ctx = try ComicalBridgeContext(bridgeBundle: code, settings: settings)
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
}
