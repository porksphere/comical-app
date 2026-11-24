@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package expo.modules.materialnavigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.material3.WideNavigationRail
import androidx.compose.material3.WideNavigationRailItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.views.ComposeProps

class NavigationItem : Record {
  @Field val key: String = ""
  @Field val label: String = ""

  /** A Material Symbol's path, in its 960 by 960 viewport. */
  @Field val icon: String = ""
  @Field val selectedIcon: String? = null

  /** A count to show on the icon; none when null or empty. */
  @Field val badge: String? = null
  @Field val testTag: String? = null
}

data class MaterialNavigationProps(
  val items: List<NavigationItem> = emptyList(),
  val selected: String = "",
  val rail: Boolean = false
) : ComposeProps

class SelectEvent(@Field val key: String = "") : Record

/**
 * Material 3 Expressive's two navigation components, which @expo/ui does not ship: the short
 * navigation bar, and the wide navigation rail (collapsed) for a window wide enough for one.
 * Composed inside an @expo/ui Host, whose theme it takes.
 */
class MaterialNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MaterialNavigation")

    View<MaterialNavigationProps>("MaterialNavigationView") {
      val onSelect by Event<SelectEvent>()

      Content { props ->
        // The host measures its content at exactly its own size, and the bar hands its minimum
        // width on to each item: unloosened, every item is a screen wide and all but the first
        // lie off the edge.
        Box(Modifier.fillMaxSize(), contentAlignment = if (props.rail) Alignment.TopStart else Alignment.BottomCenter) {
          // The window's insets are the page's to handle: it stands the bar on the bottom inset
          // and the rail under the status bar itself.
          if (props.rail) {
            WideNavigationRail(windowInsets = WindowInsets(0, 0, 0, 0)) {
              props.items.forEach { item ->
                key(item.key) {
                  val selected = item.key == props.selected
                  WideNavigationRailItem(
                    selected = selected,
                    onClick = { onSelect(SelectEvent(item.key)) },
                    icon = { ItemIcon(item, selected) },
                    label = { Text(item.label) },
                    railExpanded = false,
                    modifier = item.tagged()
                  )
                }
              }
            }
          } else {
            ShortNavigationBar(windowInsets = WindowInsets(0, 0, 0, 0)) {
              props.items.forEach { item ->
                key(item.key) {
                  val selected = item.key == props.selected
                  ShortNavigationBarItem(
                    selected = selected,
                    onClick = { onSelect(SelectEvent(item.key)) },
                    icon = { ItemIcon(item, selected) },
                    label = { Text(item.label) },
                    modifier = item.tagged()
                  )
                }
              }
            }
          }
        }
      }
    }
  }
}

private fun NavigationItem.tagged(): Modifier =
  testTag?.let { Modifier.semantics { testTagsAsResourceId = true }.testTag(it) } ?: Modifier

@Composable
private fun ItemIcon(item: NavigationItem, selected: Boolean) {
  val path = if (selected) item.selectedIcon ?: item.icon else item.icon
  val vector = remember(path) { symbol(path) }
  val badge = item.badge
  if (badge.isNullOrEmpty()) {
    Icon(vector, contentDescription = null)
  } else {
    BadgedBox(badge = { Badge { Text(badge) } }) {
      Icon(vector, contentDescription = null)
    }
  }
}

private fun symbol(path: String): ImageVector =
  ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 960f, viewportHeight = 960f)
    .addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black))
    .build()
