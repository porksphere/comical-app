package expo.modules.webcookies

import android.net.Uri
import android.webkit.CookieManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WebCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebCookies")

    AsyncFunction("getCookies") { url: String ->
      CookieManager.getInstance().getCookie(url) ?: ""
    }

    // CookieManager has no per-site removal, so each cookie the site would be sent is overwritten
    // as already expired — once host-only and once for each domain it could have been set on.
    AsyncFunction("clearCookies") { urls: List<String>, promise: Promise ->
      val cookies = CookieManager.getInstance()
      for (url in urls) {
        val host = Uri.parse(url).host?.lowercase() ?: continue
        val names = (cookies.getCookie(url) ?: "")
          .split(";")
          .mapNotNull { it.substringBefore("=").trim().ifEmpty { null } }
        val labels = host.split(".")
        val domains = (0 until labels.size - 1).map { labels.drop(it).joinToString(".") }
        for (name in names.distinct()) {
          cookies.setCookie(url, "$name=; Max-Age=0; Path=/")
          for (domain in domains) cookies.setCookie(url, "$name=; Max-Age=0; Path=/; Domain=$domain")
        }
      }
      cookies.flush()
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)
  }
}
