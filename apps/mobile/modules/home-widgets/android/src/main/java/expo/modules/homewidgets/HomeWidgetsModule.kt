package expo.modules.homewidgets

import android.net.Uri
import androidx.glance.appwidget.updateAll
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class HomeWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HomeWidgets")

    Function("isAvailable") { true }

    AsyncFunction("covers") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      WidgetStore.coversDirectory(context).list()?.toList() ?: emptyList<String>()
    }

    AsyncFunction("storeCover") { name: String, uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val source = File(Uri.parse(uri).path ?: throw IllegalArgumentException("Not a file: $uri"))
      WidgetStore.storeCover(context, name, source)
    }

    AsyncFunction("publish") Coroutine { snapshot: String, covers: List<String> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val changed = WidgetStore.publish(context, snapshot, covers.toSet())
      if (changed) {
        HistoryWidget().updateAll(context)
        ActivityWidget().updateAll(context)
      }
      changed
    }
  }
}
