import Foundation

/// The App Group folder the app writes the widgets' feed into and the widgets read it from.
///
/// The group is not the one the project names once the app has been sideloaded: a signing tool
/// registers the group under the installing Apple ID, where the name has to be unique, so it
/// renames it (AltStore and SideStore append the team id). The name in use is in the entitlements,
/// which iOS gives an app no way to read, so it is taken from where a signer leaves it: the
/// `ALTAppGroups` key AltStore and SideStore write into each bundle's Info.plist, and the
/// provisioning profile any development-signed bundle carries.
///
/// The app's module compiles a copy of this file (`plugins/with-widget-shared-sources.js`), so
/// both sides resolve the same folder.
enum SharedContainer {
  static let projectGroup = "group.com.porksphere.comical"

  static let directory: URL? = {
    for group in candidateGroups() {
      if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) {
        return container.appendingPathComponent("Widgets", isDirectory: true)
      }
    }
    return nil
  }()

  static var snapshotFile: URL? { directory?.appendingPathComponent("snapshot.json") }
  static var coversDirectory: URL? { directory?.appendingPathComponent("covers", isDirectory: true) }

  /// The signed-in groups, the project's own renamed one first, then the project's name itself,
  /// which is the group as built (a simulator, a build signed by the project's own team).
  static func candidateGroups() -> [String] {
    let signed = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []) + provisionedGroups()
    let ranked = signed.sorted { a, b in
      let aOurs = a.contains(projectGroup), bOurs = b.contains(projectGroup)
      if aOurs != bOurs { return aOurs }
      return a.count != b.count ? a.count < b.count : a < b
    }
    var seen = Set<String>()
    return (ranked + [projectGroup]).filter { seen.insert($0).inserted }
  }

  /// The profile is a signed envelope around a property list, which sits in it as plain text.
  private static func provisionedGroups() -> [String] {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
          let data = try? Data(contentsOf: url),
          let start = data.range(of: Data("<?xml".utf8)),
          let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
          let plist = try? PropertyListSerialization.propertyList(
            from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil
          ) as? [String: Any],
          let entitlements = plist["Entitlements"] as? [String: Any]
    else { return [] }
    return entitlements["com.apple.security.application-groups"] as? [String] ?? []
  }
}
