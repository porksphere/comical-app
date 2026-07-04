package expo.modules.comicalruntime

import android.content.Context
import dev.comical.host.ComicalBridgeContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Expo native module "ComicalRuntime": a thin JSON-in/JSON-out wrapper over the shared
 * `dev.comical.host.ComicalBridgeContext` (QuickJS), keyed by bridge id so the app can run several
 * bridges at once. The heavy lifting — loading the bundle through @comical/core, capability gating,
 * the host capabilities (OkHttp/storage/log) — all lives in ComicalBridgeContext, compiled in from
 * the comical submodule (see build.gradle).
 *
 * Mirrors the app's `NativeBridgeRuntime` contract (src/data/embedded/types.ts):
 *   initBridge(id, code, settingsJson, networkJson?) -> "{ info, methods }" JSON
 *   callBridge(id, method, argsJson)                 -> raw result JSON
 *   disposeBridge(id)
 */
class ComicalRuntimeModule : Module() {
  private val bridges = ConcurrentHashMap<String, ComicalBridgeContext>()

  override fun definition() = ModuleDefinition {
    Name("ComicalRuntime")

    AsyncFunction("initBridge") Coroutine { id: String, code: String, settingsJson: String, networkJson: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val settings = jsonToMap(settingsJson)
      // Give each bridge its own storage dir. With a null dataDir, ComicalBridgeContext defaults to a
      // single shared `filesDir/comical`, so every bridge's `storage` capability (cookies, per-bridge
      // KV) would collide in one storage.json. Namespace by bridge id instead.
      val ctx = ComicalBridgeContext.create(context, code, settings, bridgeDataDir(context, id), networkJson)
      // Replace any prior context for this id (e.g. after a settings change).
      bridges.put(id, ctx)?.close()
      ctx.describeJson()
    }

    AsyncFunction("callBridge") Coroutine { id: String, method: String, argsJson: String ->
      val ctx = bridges[id] ?: throw IllegalStateException("bridge not initialised: $id")
      ctx.callJson(method, argsJson)
    }

    Function("disposeBridge") { id: String ->
      bridges.remove(id)?.close()
    }

    OnDestroy {
      bridges.values.forEach { it.close() }
      bridges.clear()
    }
  }

  /** Parse a JSON object string into the `Map<String, Any>` ComicalBridgeContext.create expects. */
  private fun jsonToMap(json: String): Map<String, Any> {
    val obj = JSONObject(json)
    val map = HashMap<String, Any>()
    for (key in obj.keys()) map[key] = obj.get(key)
    return map
  }

  /** A persistent, per-bridge data directory: `filesDir/comical/bridges/<id>`, with the id sanitised
   *  to a safe single path component so a hostile registry id can't traverse out of the folder. */
  private fun bridgeDataDir(context: Context, id: String): File =
    File(File(context.filesDir, "comical/bridges"), safePathComponent(id))

  /** Keep ASCII alphanumerics plus `-_.`, replace anything else with `_`, and never allow an empty
   *  component or `.`/`..` (directory traversal). */
  private fun safePathComponent(id: String): String {
    val mapped = buildString {
      for (c in id) append(if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '-' || c == '_' || c == '.') c else '_')
    }
    return when {
      mapped.isEmpty() -> "_"
      mapped == "." || mapped == ".." -> "_$mapped"
      else -> mapped
    }
  }
}
