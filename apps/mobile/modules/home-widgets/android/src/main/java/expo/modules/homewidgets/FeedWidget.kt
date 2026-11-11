package expo.modules.homewidgets

import android.content.Context
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.glance.GlanceId
import androidx.glance.GlanceTheme
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal abstract class FeedWidget(private val feed: Feed) : GlanceAppWidget() {
  // The widget's real size, since nothing in a widget can keep a cover's shape for it: each
  // layout works its covers' sizes out from the room there is.
  override val sizeMode: SizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val first = withContext(Dispatchers.IO) { WidgetStore.rows(context, feed) }
    provideContent {
      val version by WidgetStore.version.collectAsState()
      val rows by produceState(first, version) {
        value = withContext(Dispatchers.IO) { WidgetStore.rows(context, feed) }
      }
      GlanceTheme { FeedContent(feed, rows) }
    }
  }
}

// One class per widget: Glance finds a widget's instances by its class, so two receivers sharing
// one would each be updated with the other's feed.
internal class HistoryWidget : FeedWidget(Feed.History)
internal class ActivityWidget : FeedWidget(Feed.Activity)

class HistoryWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = HistoryWidget()
}

class ActivityWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = ActivityWidget()
}
