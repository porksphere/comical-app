package expo.modules.homewidgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateUtils
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

private val MARGIN = 12.dp
private val STRIP_SLOTS = 4
private val STRIP_GAP = 8.dp
/** The two lines of text under a strip's cover. */
private val STRIP_TEXT = 34.dp
private val LIST_ROWS = 5
private val LIST_HEADING = 22.dp
private val LIST_ROW = 53.dp
private val WHITE = ColorProvider(Color.White)
/** The app's unread pill, as a library card wears it (`UnreadBadge` in components/card-badge.tsx). */
private val BADGE = ColorProvider(Color(0xFF2563EB))

/** The three layouts of docs/WIDGETS.md, chosen from the room the widget has been given. */
@Composable
internal fun FeedContent(feed: Feed, rows: List<FeedRow>) {
  val size = LocalSize.current
  val first = rows.firstOrNull()
  when {
    first == null -> Empty(feed)
    size.width < 250.dp -> Feature(first)
    size.height < 250.dp -> Strip(rows.take(STRIP_SLOTS), size.width, size.height)
    else -> FeedList(feed, rows.take(LIST_ROWS), size.height)
  }
}

@Composable
private fun Feature(row: FeedRow) {
  Box(
    modifier = GlanceModifier
      .fillMaxSize()
      .appWidgetBackground()
      .background(Color(0xFF1A1A1A))
      .clickable(open(LocalContext.current, row.item.url)),
  ) {
    if (row.full != null) {
      Image(
        provider = ImageProvider(row.full),
        contentDescription = null,
        modifier = GlanceModifier.fillMaxSize(),
        contentScale = ContentScale.Crop,
      )
    }
    Column(
      modifier = GlanceModifier
        .fillMaxSize()
        .background(ImageProvider(R.drawable.home_widget_scrim))
        .padding(MARGIN),
      verticalAlignment = Alignment.Bottom,
    ) {
      Text(
        text = row.item.title,
        style = TextStyle(color = WHITE, fontSize = 13.sp, fontWeight = FontWeight.Bold),
        maxLines = 2,
      )
      if (row.item.detail.isNotEmpty()) {
        Text(text = row.item.detail, style = TextStyle(color = WHITE, fontSize = 11.sp), maxLines = 1)
      }
      if (row.item.progress != null) {
        Spacer(GlanceModifier.height(6.dp))
        ProgressBar(row.item.progress)
      }
    }
    if (row.item.badge != null) {
      Box(modifier = GlanceModifier.fillMaxSize().padding(MARGIN), contentAlignment = Alignment.TopEnd) {
        Badge(row.item.badge)
      }
    }
  }
}

@Composable
private fun Strip(rows: List<FeedRow>, width: Dp, height: Dp) {
  val slot = (width - MARGIN * 2 - STRIP_GAP * (STRIP_SLOTS - 1)) / STRIP_SLOTS
  val coverHeight = min(slot * 1.5f, height - MARGIN * 2 - STRIP_TEXT)
  val context = LocalContext.current
  Surface {
    Row(modifier = GlanceModifier.fillMaxSize()) {
      rows.forEachIndexed { index, row ->
        if (index > 0) Spacer(GlanceModifier.width(STRIP_GAP))
        Column(modifier = GlanceModifier.width(slot).clickable(open(context, row.item.url))) {
          Cover(row, coverHeight / 1.5f, coverHeight, badge = row.item.badge)
          Spacer(GlanceModifier.height(3.dp))
          Text(
            text = row.item.title,
            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 11.sp, fontWeight = FontWeight.Medium),
            maxLines = 1,
          )
          Text(
            text = row.item.detail,
            style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
            maxLines = 1,
          )
        }
      }
    }
  }
}

@Composable
private fun FeedList(feed: Feed, rows: List<FeedRow>, height: Dp) {
  val context = LocalContext.current
  val fits = ((height - MARGIN * 2 - LIST_HEADING) / LIST_ROW).toInt().coerceAtLeast(1)
  val now = System.currentTimeMillis()
  Surface {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Text(
        text = context.getString(feed.title),
        modifier = GlanceModifier.height(LIST_HEADING),
        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp, fontWeight = FontWeight.Medium),
        maxLines = 1,
      )
      rows.take(fits).forEach { row ->
        Row(
          modifier = GlanceModifier.fillMaxWidth().height(LIST_ROW).clickable(open(context, row.item.url)),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Cover(row, 30.dp, 45.dp)
          Spacer(GlanceModifier.width(10.dp))
          Column(modifier = GlanceModifier.defaultWeight()) {
            Text(
              text = row.item.title,
              style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp, fontWeight = FontWeight.Bold),
              maxLines = 1,
            )
            Text(
              text = row.item.detail,
              style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp),
              maxLines = 1,
            )
          }
          Spacer(GlanceModifier.width(6.dp))
          Text(
            text = DateUtils.getRelativeTimeSpanString(
              row.item.at,
              now,
              DateUtils.MINUTE_IN_MILLIS,
              DateUtils.FORMAT_ABBREV_RELATIVE,
            ).toString(),
            style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
            maxLines = 1,
          )
        }
      }
    }
  }
}

@Composable
private fun Empty(feed: Feed) {
  val context = LocalContext.current
  Column(
    modifier = GlanceModifier
      .fillMaxSize()
      .appWidgetBackground()
      .background(GlanceTheme.colors.widgetBackground)
      .padding(MARGIN)
      .clickable(open(context, feed.tabUrl)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = context.getString(feed.title),
      style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp, fontWeight = FontWeight.Bold),
      maxLines = 1,
    )
    Text(
      text = context.getString(feed.emptyMessage),
      style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp, textAlign = TextAlign.Center),
    )
  }
}

@Composable
private fun Surface(content: @Composable () -> Unit) {
  Box(
    modifier = GlanceModifier
      .fillMaxSize()
      .appWidgetBackground()
      .background(GlanceTheme.colors.widgetBackground)
      .padding(MARGIN),
    content = content,
  )
}

@Composable
private fun Cover(row: FeedRow, width: Dp, height: Dp, badge: String? = null) {
  Box(
    modifier = GlanceModifier
      .size(width, height)
      .cornerRadius(6.dp)
      .background(GlanceTheme.colors.surfaceVariant),
    contentAlignment = Alignment.Center,
  ) {
    if (row.thumb != null) {
      Image(
        provider = ImageProvider(row.thumb),
        contentDescription = null,
        modifier = GlanceModifier.fillMaxSize(),
        contentScale = ContentScale.Crop,
      )
    } else {
      Text(
        text = row.item.title.take(1).uppercase(),
        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 14.sp, fontWeight = FontWeight.Bold),
      )
    }
    if (row.item.progress != null) {
      Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.BottomStart) {
        ProgressBar(row.item.progress)
      }
    }
    if (badge != null) {
      Box(modifier = GlanceModifier.fillMaxSize().padding(4.dp), contentAlignment = Alignment.TopEnd) {
        Badge(badge)
      }
    }
  }
}

@Composable
private fun Badge(text: String) {
  Text(
    text = text,
    modifier = GlanceModifier.background(BADGE).cornerRadius(9.dp).padding(horizontal = 6.dp, vertical = 1.dp),
    style = TextStyle(color = WHITE, fontSize = 11.sp, fontWeight = FontWeight.Bold),
    maxLines = 1,
  )
}

@Composable
private fun ProgressBar(progress: Float) {
  LinearProgressIndicator(
    progress = progress.coerceIn(0f, 1f),
    modifier = GlanceModifier.fillMaxWidth().height(3.dp),
    color = WHITE,
    backgroundColor = ColorProvider(Color.White.copy(alpha = 0.3f)),
  )
}

// Each link is its own data URI, which is what keeps one row's intent from standing in for another's.
private fun open(context: Context, url: String): Action =
  actionStartActivity(
    Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    actionParametersOf(),
  )
