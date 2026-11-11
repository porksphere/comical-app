import SwiftUI
import UIKit
import WidgetKit

struct FeedWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let feed: Feed
  let entry: FeedEntry

  var body: some View {
    if let first = entry.items.first {
      switch family {
      case .systemSmall:
        FeatureView(item: first)
      case .systemMedium:
        CoverStripView(items: Array(entry.items.prefix(CoverStripView.slots)))
      default:
        FeedListView(feed: feed, items: Array(entry.items.prefix(5)), now: entry.date)
      }
    } else {
      EmptyFeedView(feed: feed)
    }
  }
}

/// The newest row alone, its cover filling the widget.
private struct FeatureView: View {
  let item: FeedItem

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Spacer(minLength: 0)
      Text(item.title)
        .font(.footnote.weight(.semibold))
        .lineLimit(2)
      if !item.detail.isEmpty {
        Text(item.detail)
          .font(.caption2)
          .opacity(0.8)
          .lineLimit(1)
      }
      if let progress = item.progress {
        ProgressBar(value: progress)
          .clipShape(Capsule())
          .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    .foregroundStyle(Color.white)
    .overlay(alignment: .topTrailing) {
      if let badge = item.badge {
        CoverBadge(text: badge)
      }
    }
    .containerBackground(for: .widget) {
      ZStack {
        Color(white: 0.1)
        if let image = CoverFile.image(item.cover) {
          // As an overlay, so a cover wider than the widget is cropped and not laid out at its own size.
          Color.clear
            .overlay { Image(uiImage: image).resizable().scaledToFill() }
            .clipped()
        }
        LinearGradient(colors: [Color.clear, Color.black.opacity(0.8)], startPoint: .center, endPoint: .bottom)
      }
    }
    .widgetURL(item.destination)
  }
}

/// The newest rows as covers side by side.
private struct CoverStripView: View {
  static let slots = 4
  let items: [FeedItem]

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      ForEach(items) { item in
        Link(destination: item.destination) {
          VStack(alignment: .leading, spacing: 3) {
            CoverArt(item: item, badge: item.badge)
            Text(item.title)
              .font(.caption2.weight(.medium))
              .foregroundStyle(Color.primary)
              .lineLimit(1)
            Text(item.detail)
              .font(.caption2)
              .foregroundStyle(Color.secondary)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      // Empty slots keep a short feed's covers the size of a full one's.
      ForEach(0..<max(0, Self.slots - items.count), id: \.self) { _ in
        Color.clear.frame(maxWidth: .infinity)
      }
    }
    .containerBackground(.background, for: .widget)
  }
}

private struct FeedListView: View {
  let feed: Feed
  let items: [FeedItem]
  let now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(feed.title)
        .font(.caption.weight(.semibold))
        .foregroundStyle(Color.secondary)
        .padding(.bottom, 4)
      ForEach(items) { item in
        Link(destination: item.destination) {
          HStack(spacing: 10) {
            CoverArt(item: item)
              .frame(width: 30, height: 45)
            VStack(alignment: .leading, spacing: 2) {
              Text(item.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.primary)
                .lineLimit(1)
              Text(item.detail)
                .font(.caption)
                .foregroundStyle(Color.secondary)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(Self.ages.localizedString(for: item.date, relativeTo: now))
              .font(.caption2)
              .foregroundStyle(Color.secondary)
              .lineLimit(1)
              .fixedSize()
          }
          .frame(maxWidth: .infinity, maxHeight: 54, alignment: .leading)
        }
      }
      Spacer(minLength: 0)
    }
    .containerBackground(.background, for: .widget)
  }

  private static let ages: RelativeDateTimeFormatter = {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter
  }()
}

private struct EmptyFeedView: View {
  let feed: Feed

  var body: some View {
    VStack(spacing: 4) {
      Text(feed.title)
        .font(.footnote.weight(.semibold))
        .foregroundStyle(Color.primary)
      Text(feed.emptyMessage)
        .font(.caption)
        .foregroundStyle(Color.secondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .containerBackground(.background, for: .widget)
    .widgetURL(feed.tabURL)
  }
}

/// A cover at a book's shape, as large as the space it is given allows.
private struct CoverArt: View {
  let item: FeedItem
  var badge: String? = nil

  var body: some View {
    Color.gray.opacity(0.25)
      .aspectRatio(2.0 / 3.0, contentMode: .fit)
      .overlay {
        if let image = CoverFile.image(item.cover) {
          Image(uiImage: image).resizable().scaledToFill()
        } else {
          Text(item.title.prefix(1).uppercased())
            .font(.headline)
            .foregroundStyle(Color.secondary)
        }
      }
      .overlay(alignment: .bottom) {
        if let progress = item.progress {
          ProgressBar(value: progress)
        }
      }
      .overlay(alignment: .topTrailing) {
        if let badge {
          CoverBadge(text: badge).padding(4)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
  }
}

/// The app's accent, outlined in white so it stands off any cover.
private struct CoverBadge: View {
  let text: String

  var body: some View {
    if text.isEmpty {
      Circle()
        .fill(Self.accent)
        .frame(width: 10, height: 10)
        .overlay(Circle().stroke(Color.white, lineWidth: 1.5))
    } else {
      Text(text)
        .font(.caption2.weight(.bold))
        .foregroundStyle(Color.white)
        .padding(.horizontal, 5)
        .frame(minWidth: 17, minHeight: 17)
        .background(Capsule().fill(Self.accent))
        .overlay(Capsule().stroke(Color.white, lineWidth: 1.5))
    }
  }

  private static let accent = Color(red: 0x34 / 255.0, green: 0x78 / 255.0, blue: 0xF6 / 255.0)
}

private struct ProgressBar: View {
  let value: Double

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Color.white.opacity(0.3)
        Color.white.frame(width: proxy.size.width * min(max(value, 0), 1))
      }
    }
    .frame(height: 3)
  }
}

private enum CoverFile {
  static func image(_ name: String?) -> UIImage? {
    guard let name, let directory = SharedContainer.coversDirectory else { return nil }
    return UIImage(contentsOfFile: directory.appendingPathComponent(name).path)
  }
}
