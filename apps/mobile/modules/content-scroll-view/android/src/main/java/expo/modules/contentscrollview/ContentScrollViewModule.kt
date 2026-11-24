package expo.modules.contentscrollview

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.ScrollView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference

class ContentScrollViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ContentScrollView")

    View(ContentScrollAnchorView::class) {
      Events("onScrolledPast")
      Prop("scrolledPast") { view, threshold: Double? ->
        view.threshold = threshold
      }
    }
  }
}

/**
 * Reports when the list under it crosses `scrolledPast` dp from its top, for a bar that takes its
 * container colour once content is under it. Only the crossings are sent.
 */
class ContentScrollAnchorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onScrolledPast by EventDispatcher()

  var threshold: Double? = null
    set(value) {
      field = value
      past = null
      check()
    }

  private var past: Boolean? = null
  private var list = WeakReference<ScrollView>(null)

  // The observer hears every scroll in the window, this list's or not.
  private val scrolled = ViewTreeObserver.OnScrollChangedListener { check() }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnScrollChangedListener(scrolled)
    post { check() }
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnScrollChangedListener(scrolled)
    super.onDetachedFromWindow()
  }

  private fun check() {
    val threshold = threshold ?: return
    val list = scroller() ?: return
    val density = resources.displayMetrics.density
    val now = list.scrollY > threshold * density
    if (now == past) return
    past = now
    onScrolledPast(mapOf("past" to now, "offset" to list.scrollY / density.toDouble()))
  }

  private fun scroller(): ScrollView? {
    list.get()?.let { if (it.isAttachedToWindow) return it }
    return find(this, SEARCH_DEPTH)?.also { list = WeakReference(it) }
  }

  // A refresh layout holds its spinner ahead of the list, so not the first child alone.
  private fun find(group: ViewGroup, depth: Int): ScrollView? {
    for (i in 0 until group.childCount) {
      val child: View = group.getChildAt(i)
      if (child is ScrollView) return child
      if (depth > 0 && child is ViewGroup) find(child, depth - 1)?.let { return it }
    }
    return null
  }

  private companion object {
    const val SEARCH_DEPTH = 6
  }
}
