import ExpoModulesCore
import WidgetKit

public class HomeWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HomeWidgets")

    Function("isAvailable") { () -> Bool in
      SharedContainer.directory != nil
    }

    AsyncFunction("covers") { () -> [String] in
      guard let covers = SharedContainer.coversDirectory else { return [] }
      return (try? FileManager.default.contentsOfDirectory(atPath: covers.path)) ?? []
    }

    AsyncFunction("storeCover") { (name: String, source: URL) throws in
      guard let covers = SharedContainer.coversDirectory else { throw ContainerUnavailableException() }
      try FileManager.default.createDirectory(at: covers, withIntermediateDirectories: true)
      try Data(contentsOf: source).write(to: covers.appendingPathComponent(fileName(name)), options: .atomic)
    }

    AsyncFunction("publish") { (snapshot: String, covers: [String]) throws -> Bool in
      guard let directory = SharedContainer.directory,
            let file = SharedContainer.snapshotFile,
            let coversDirectory = SharedContainer.coversDirectory
      else { throw ContainerUnavailableException() }
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

      let kept = Set(covers.map(fileName))
      for stored in (try? FileManager.default.contentsOfDirectory(atPath: coversDirectory.path)) ?? []
      where !kept.contains(stored) {
        try? FileManager.default.removeItem(at: coversDirectory.appendingPathComponent(stored))
      }

      // A reload from the background is drawn from a daily budget, so an unchanged feed asks for none.
      let data = Data(snapshot.utf8)
      if (try? Data(contentsOf: file)) == data { return false }
      try data.write(to: file, options: .atomic)
      WidgetCenter.shared.reloadAllTimelines()
      return true
    }
  }
}

private func fileName(_ name: String) -> String {
  (name as NSString).lastPathComponent
}

final class ContainerUnavailableException: Exception {
  override var reason: String { "The App Group folder shared with the widgets is not available" }
}
