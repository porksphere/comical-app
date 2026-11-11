package expo.modules.homewidgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject
import java.io.File

/** One row of a feed as the app wrote it (docs/WIDGETS.md). */
internal class FeedItem(
  val id: String,
  val title: String,
  val detail: String,
  val at: Long,
  val cover: String?,
  val progress: Float?,
  val url: String,
)

/** A row with its cover decoded. `full` is only the first row's: the one layout that fills the
 *  widget with a cover shows the first row alone. */
internal class FeedRow(val item: FeedItem, val thumb: Bitmap?, val full: Bitmap?)

internal enum class Feed(
  val key: String,
  val title: Int,
  val emptyMessage: Int,
  val tabUrl: String,
) {
  History("history", R.string.home_widget_history_title, R.string.home_widget_history_empty, "comical://history"),
  Activity("activity", R.string.home_widget_activity_title, R.string.home_widget_activity_empty, "comical://activity"),
}

/** The feed on disk: `Widgets/` under the app's files, which a widget's receiver shares. */
internal object WidgetStore {
  /** Moves on every publish. A widget still composed from an earlier one reads the feed again on
   *  it: asking Glance to update a widget it is already running does not load it afresh. */
  val version = MutableStateFlow(0L)

  /** A cover in a list or a strip is drawn well under this many pixels wide. */
  private const val THUMB_WIDTH = 200

  private fun directory(context: Context) = File(context.filesDir, "Widgets")
  private fun snapshotFile(context: Context) = File(directory(context), "snapshot.json")
  fun coversDirectory(context: Context) = File(directory(context), "covers")

  fun storeCover(context: Context, name: String, source: File) {
    val covers = coversDirectory(context).apply { mkdirs() }
    source.copyTo(File(covers, File(name).name), overwrite = true)
  }

  /** Whether the feed changed, which is when the widgets are worth redrawing. */
  @Synchronized
  fun publish(context: Context, snapshot: String, covers: Set<String>): Boolean {
    directory(context).mkdirs()
    coversDirectory(context).listFiles()?.forEach { if (it.name !in covers) it.delete() }

    val file = snapshotFile(context)
    if (file.exists() && file.readText() == snapshot) return false
    val pending = File(file.path + ".tmp")
    pending.writeText(snapshot)
    if (!pending.renameTo(file)) {
      file.writeText(snapshot)
      pending.delete()
    }
    version.value += 1
    return true
  }

  /** A feed that isn't there, or can't be read, is one not published yet: no rows. */
  fun rows(context: Context, feed: Feed): List<FeedRow> {
    val items = try {
      val list = JSONObject(snapshotFile(context).readText()).getJSONArray(feed.key)
      List(list.length()) { index ->
        val row = list.getJSONObject(index)
        FeedItem(
          id = row.getString("id"),
          title = row.getString("title"),
          detail = row.optString("detail"),
          at = row.getLong("at"),
          cover = if (row.has("cover")) row.getString("cover") else null,
          progress = if (row.has("progress")) row.getDouble("progress").toFloat() else null,
          url = row.getString("url"),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
    return items.mapIndexed { index, item ->
      FeedRow(
        item,
        thumb = cover(context, item.cover, THUMB_WIDTH),
        full = if (index == 0) cover(context, item.cover, Int.MAX_VALUE) else null,
      )
    }
  }

  /** The cover, decoded no wider than it has to be: a widget's bitmaps are handed to the launcher
   *  by value, and it refuses an update whose bitmaps add up to too much. */
  private fun cover(context: Context, name: String?, width: Int): Bitmap? {
    val file = File(coversDirectory(context), name ?: return null)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= width) sample *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
  }
}
