package expo.modules.contentscrollview

import android.content.Context
import android.view.MotionEvent
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
      Events("onScrolledPast", "onPullTouch")
      Prop("scrolledPast") { view, threshold: Double? ->
        view.threshold = threshold
      }
      Prop("tracksPull") { view, tracks: Boolean? ->
        view.tracksPull = tracks ?: false
      }
    }
  }
}

/**
 * Reports when the list under it crosses `scrolledPast` dp from its top, for a bar that takes its
 * container colour once content is under it. Only the crossings are sent.
 *
 * With `tracksPull` it also reports a finger dragging down on a list at its top, for pull to
 * refresh. React Native cancels a touch for JavaScript the moment a native scroll view takes the
 * drag, so the pull can't be read there: every touch passes through here on its way to the list,
 * whoever ends up handling it.
 */
class ContentScrollAnchorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onScrolledPast by EventDispatcher()

  var threshold: Double? = null
    set(value) {
      field = value
      past = null
      check()
    }

  val onPullTouch by EventDispatcher()
  var tracksPull = false

  private var past: Boolean? = null
  private var list = WeakReference<ScrollView>(null)
  private var touching = false

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (tracksPull) {
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          touching = true
          pull("start", ev)
        }
        // Only a drag that could be a pull: a scroll's moves would be an event a frame for nothing.
        MotionEvent.ACTION_MOVE -> if (touching && (scroller()?.scrollY ?: 0) <= 0) pull("move", ev)
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (touching) {
          touching = false
          pull("end", ev)
        }
      }
    }
    return super.dispatchTouchEvent(ev)
  }

  private fun pull(phase: String, ev: MotionEvent) {
    onPullTouch(mapOf("phase" to phase, "y" to ev.rawY / resources.displayMetrics.density.toDouble()))
  }

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
