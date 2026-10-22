import ExpoModulesCore
import WebKit

public class WebCookiesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WebCookies")

    // react-native-webview signs in through the default data store unless told to go incognito.
    AsyncFunction("getCookies") { (url: URL, promise: Promise) in
      WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
        let header = cookies
          .filter { Self.sends($0, to: url) }
          .map { "\($0.name)=\($0.value)" }
          .joined(separator: "; ")
        promise.resolve(header)
      }
    }.runOnQueue(.main)

    AsyncFunction("clearCookies") { (urls: [URL], promise: Promise) in
      let store = WKWebsiteDataStore.default()
      let hosts = urls.compactMap { $0.host?.lowercased() }
      store.fetchDataRecords(ofTypes: [WKWebsiteDataTypeCookies]) { records in
        // A record is one site, named by its registrable domain ("example.com").
        let doomed = records.filter { record in
          hosts.contains { $0 == record.displayName || $0.hasSuffix("." + record.displayName) }
        }
        store.removeData(ofTypes: [WKWebsiteDataTypeCookies], for: doomed) {
          promise.resolve()
        }
      }
    }.runOnQueue(.main)
  }

  private static func sends(_ cookie: HTTPCookie, to url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return false }
    if cookie.isSecure && url.scheme != "https" { return false }
    if let expires = cookie.expiresDate, expires < Date() { return false }
    let domain = cookie.domain.lowercased()
    let bare = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
    guard host == bare || host.hasSuffix("." + bare) else { return false }
    let path = url.path.isEmpty ? "/" : url.path
    return path.hasPrefix(cookie.path)
  }
}
