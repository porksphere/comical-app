package expo.modules.screencorners

import android.os.Build
import android.view.RoundedCorner
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ScreenCornersModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScreenCorners")

    // Clockwise from the top left, in dp: the display's rounded corners as the window's insets
    // report them (Android 12 and later), none where a corner is square.
    AsyncFunction("windowCorners") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction null
      val activity = appContext.currentActivity ?: return@AsyncFunction null
      val insets = activity.window.decorView.rootWindowInsets ?: return@AsyncFunction null
      val density = activity.resources.displayMetrics.density
      listOf(
        RoundedCorner.POSITION_TOP_LEFT,
        RoundedCorner.POSITION_TOP_RIGHT,
        RoundedCorner.POSITION_BOTTOM_RIGHT,
        RoundedCorner.POSITION_BOTTOM_LEFT,
      ).map { (insets.getRoundedCorner(it)?.radius ?: 0) / density.toDouble() }
    }.runOnQueue(Queues.MAIN)
  }
}
