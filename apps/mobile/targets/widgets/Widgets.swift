import SwiftUI
import WidgetKit

struct FeedEntry: TimelineEntry {
  let date: Date
  let items: [FeedItem]
}

struct FeedProvider: TimelineProvider {
  let feed: Feed

  func placeholder(in context: Context) -> FeedEntry {
    FeedEntry(date: Date(), items: [])
  }

  func getSnapshot(in context: Context, completion: @escaping (FeedEntry) -> Void) {
    completion(current())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<FeedEntry>) -> Void) {
    // The app reloads the widgets when a feed changes. This refresh only moves the rows' ages on.
    completion(Timeline(entries: [current()], policy: .after(Date().addingTimeInterval(15 * 60))))
  }

  private func current() -> FeedEntry {
    FeedEntry(date: Date(), items: Snapshot.load().map { feed.items(in: $0) } ?? [])
  }
}

private func feedConfiguration(_ feed: Feed) -> some WidgetConfiguration {
  StaticConfiguration(kind: feed.kind, provider: FeedProvider(feed: feed)) { entry in
    FeedWidgetView(feed: feed, entry: entry)
  }
  .configurationDisplayName(feed.title)
  .description(feed.summary)
  .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
}

struct ContinueReadingWidget: Widget {
  var body: some WidgetConfiguration { feedConfiguration(.history) }
}

struct NewChaptersWidget: Widget {
  var body: some WidgetConfiguration { feedConfiguration(.activity) }
}

@main
struct ComicalWidgetBundle: WidgetBundle {
  var body: some Widget {
    ContinueReadingWidget()
    NewChaptersWidget()
  }
}
