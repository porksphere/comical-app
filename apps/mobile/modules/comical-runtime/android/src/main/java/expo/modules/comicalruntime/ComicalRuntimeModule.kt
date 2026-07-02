package expo.modules.comicalruntime

import dev.comical.host.ComicalBridgeContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
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
      val ctx = ComicalBridgeContext.create(context, code, settings, null, networkJson)
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
}
