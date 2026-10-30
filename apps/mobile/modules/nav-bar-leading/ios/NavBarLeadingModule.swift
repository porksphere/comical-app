import ExpoModulesCore

struct MenuRow: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var image: String?
  @Field var symbol: String?
  @Field var on: Bool = false
}

struct MenuSection: Record {
  @Field var title: String = ""
  @Field var rows: [MenuRow] = []
}

public class NavBarLeadingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarLeading")

    View(NavBarLeadingView.self) {
      Events("onSelect")

      Prop("image") { (view: NavBarLeadingView, uri: String?) in
        view.imageURI = uri
      }
      Prop("symbol") { (view: NavBarLeadingView, symbol: String) in
        view.symbol = symbol
      }
      Prop("label") { (view: NavBarLeadingView, label: String) in
        view.label = label
      }
      Prop("sections") { (view: NavBarLeadingView, sections: [MenuSection]) in
        view.sections = sections
      }

      OnViewDidUpdateProps { (view: NavBarLeadingView) in
        view.propsDidUpdate()
      }
    }
  }
}

/// react-native-screens builds a screen's bar items from its header config, and on ANY change to
/// that config it replaces every item with a new one, unanimated: picking a bridge, which changes
/// the button's picture and the rows' checkmarks, tore the bar down and redrew it. The screen now
/// gives react-native-screens a leading item that never changes, and this view keeps what does —
/// the picture, the accessibility label and the menu — setting them on that item in place when
/// they change, the moment the items are rebuilt (it observes the navigation item's leading
/// items), and whenever the screen comes back on screen.
///
/// A file picture is decoded here once and kept for the session. Through React Native's loader it
/// is read off the main thread and never cached, so the item would be blank for the first part
/// of every pop back, and a menu row's would never show: it lands after the menu was built, and a
/// bar item keeps a copy of its menu.
final class NavBarLeadingView: ExpoView {
  private static var images = [String: UIImage]()
  private static var symbols = [String: UIImage]()

  let onSelect = EventDispatcher()

  var imageURI: String?
  var symbol = ""
  var label = ""
  var sections: [MenuSection] = []

  private var image: UIImage?
  private var menu: UIMenu?
  /// The item the current menu was last handed to: a bar item keeps a copy of its menu, so a
  /// rebuilt menu, or a rebuilt item, has to be handed over again.
  private weak var menuItem: UIBarButtonItem?
  private weak var navigationItem: UINavigationItem?
  private var observation: NSKeyValueObservation?

  func propsDidUpdate() {
    image = imageURI.flatMap(Self.load) ?? Self.symbol(symbol)
    menu = buildMenu()
    menuItem = nil
    apply()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      return
    }
    attach()
    apply()
    DispatchQueue.main.async { [weak self] in
      self?.apply()
    }
  }

  /// Decoded at the screen's scale, as the loader decodes the same source for the bar, and drawn
  /// as it is, past the bar's tint: a bar item's `original` rendering mode.
  private static func load(_ uri: String) -> UIImage? {
    if let cached = images[uri] {
      return cached
    }
    guard let url = URL(string: uri),
          let data = try? Data(contentsOf: url),
          let decoded = UIImage(data: data, scale: UIScreen.main.scale) else {
      return nil
    }
    let image = decoded.withRenderingMode(.alwaysOriginal)
    images[uri] = image
    return image
  }

  /// Kept so the same name is the same image: the item's picture is only set when it changes.
  private static func symbol(_ name: String) -> UIImage? {
    if let cached = symbols[name] {
      return cached
    }
    let image = UIImage(systemName: name)
    symbols[name] = image
    return image
  }

  private func buildMenu() -> UIMenu {
    UIMenu(children: sections.map { section in
      UIMenu(title: section.title, options: .displayInline, children: section.rows.map { row in
        UIAction(
          title: row.title,
          image: row.image.flatMap(Self.load) ?? row.symbol.flatMap(Self.symbol),
          state: row.on ? .on : .off
        ) { [weak self] _ in
          self?.onSelect(["id": row.id])
        }
      })
    })
  }

  private func attach() {
    guard let controller = owningController(of: self) else {
      return
    }
    let item = controller.navigationItem
    if item === navigationItem {
      return
    }
    navigationItem = item
    observation = item.observe(\.leftBarButtonItems, options: [.new]) { [weak self] _, _ in
      self?.apply()
    }
  }

  private func apply() {
    guard let leading = navigationItem?.leftBarButtonItems?.first else {
      return
    }
    if let image, leading.image !== image {
      leading.image = image
    }
    if leading.accessibilityLabel != label {
      leading.accessibilityLabel = label
    }
    if let menu, menuItem !== leading {
      leading.menu = menu
      menuItem = leading
    }
  }
}

private func owningController(of view: UIView) -> UIViewController? {
  var responder: UIResponder? = view
  while let next = responder?.next {
    if let controller = next as? UIViewController {
      return controller
    }
    responder = next
  }
  return nil
}
