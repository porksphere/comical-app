import ExpoModulesCore

struct MenuOption: Record {
  @Field var value: String = ""
  @Field var label: String = ""
  /// A `file://` picture for the row, already the size and shape the menu shows it at.
  @Field var image: String?
  @Field var on: Bool = false
}

public class MenuAnchorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MenuAnchor")

    View(MenuAnchorView.self) {
      Events("onSelect")

      Prop("title") { (view: MenuAnchorView, title: String?) in
        view.title = title
      }
      Prop("options") { (view: MenuAnchorView, options: [MenuOption]) in
        view.options = options
      }
      Prop("label") { (view: MenuAnchorView, label: String?) in
        view.label = label
      }
    }
  }
}

/// An invisible button over whatever it is laid out on, opening a UIKit menu of checkmarked
/// options on tap — the system's own popup-row menu, as a SwiftUI `Menu` would present it, but
/// over a row drawn by React Native. The menu's pictures are decoded here at the screen's scale and
/// kept for the session: a UIMenu draws a row's image as the bitmap it is given, and anything that
/// reaches it through React Native's loader or `@expo/ui` arrives decoded at 1× and blurry.
final class MenuAnchorView: ExpoView {
  private static var images = [String: UIImage]()

  let onSelect = EventDispatcher()
  private let button = UIButton(type: .custom)

  var title: String? {
    didSet { rebuild() }
  }
  var options: [MenuOption] = [] {
    didSet { rebuild() }
  }
  var label: String? {
    didSet { button.accessibilityLabel = label }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.showsMenuAsPrimaryAction = true
    if #available(iOS 16.0, *) {
      button.preferredMenuElementOrder = .fixed
    }
    button.backgroundColor = .clear
    addSubview(button)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    button.frame = bounds
    bringSubviewToFront(button)
  }

  private func rebuild() {
    let actions = options.map { option in
      UIAction(
        title: option.label,
        image: option.image.flatMap(Self.load),
        state: option.on ? .on : .off
      ) { [weak self] _ in
        self?.onSelect(["value": option.value])
      }
    }
    button.menu = UIMenu(title: title ?? "", options: [.singleSelection], children: actions)
  }

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
}
