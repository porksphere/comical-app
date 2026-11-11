import Foundation

/// One row of a feed as the app wrote it: the text is the app's, and `url` is the link a tap opens.
struct FeedItem: Decodable, Identifiable {
  let id: String
  let title: String
  let detail: String
  /// When the row last moved, in milliseconds since 1970.
  let at: Double
  /// A file in `SharedContainer.coversDirectory`.
  let cover: String?
  /// Pages seen of the chapter being read, 0 to 1.
  let progress: Double?
  /// A mark that the row holds something new: how many, or empty for a bare dot.
  let badge: String?
  let url: String

  var destination: URL { URL(string: url) ?? Feed.appURL }
  var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct Snapshot: Decodable {
  let history: [FeedItem]
  let activity: [FeedItem]

  static func load() -> Snapshot? {
    guard let file = SharedContainer.snapshotFile, let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }
}

enum Feed {
  case history, activity

  static let appURL = URL(string: "comical://")!

  var kind: String {
    switch self {
    case .history: return "ComicalHistory"
    case .activity: return "ComicalActivity"
    }
  }

  var title: String {
    switch self {
    case .history: return "Continue Reading"
    case .activity: return "New Chapters"
    }
  }

  var summary: String {
    switch self {
    case .history: return "Pick up the series you read last."
    case .activity: return "New chapters of the series in your library."
    }
  }

  var emptyMessage: String {
    switch self {
    case .history: return "Series you read show up here."
    case .activity: return "No new chapters."
    }
  }

  /// The feed's own tab, where a tap on an empty widget lands.
  var tabURL: URL {
    switch self {
    case .history: return URL(string: "comical://history")!
    case .activity: return URL(string: "comical://activity")!
    }
  }

  func items(in snapshot: Snapshot) -> [FeedItem] {
    switch self {
    case .history: return snapshot.history
    case .activity: return snapshot.activity
    }
  }
}
