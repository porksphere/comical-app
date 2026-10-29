import ExpoModulesCore

public class NavBarImageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarImage")

    View(NavBarLeadingImageView.self) {
      Prop("uri") { (view: NavBarLeadingImageView, uri: String?) in
        view.setImage(uri: uri)
      }
      Prop("menuImages") { (view: NavBarLeadingImageView, images: [String: String]?) in
        view.setMenuImages(images ?? [:])
      }
    }
  }
}

/// react-native-screens rebuilds every bar item of a screen each time the screen is about to
/// show — every pop back to it included — and an item whose picture is a file is built without
/// one: the file is read and decoded off the main thread, through React Native's image loader,
/// which never caches a file. The item stays blank until that lands, well into the pop.
///
/// This view decodes the file once, keeps the image for the session, and sets it on the screen's
/// leading item the moment the items are rebuilt (it observes the navigation item's leading
/// items) and whenever the screen comes back on screen. The loader's own copy, landing later, is
/// the same picture.
///
/// The rows of the item's menu get the same treatment (`menuImages`, keyed by row title): the
/// loader's picture for a row lands on the action after the menu was built, and a menu assigned
/// to a bar item is a copy, so that late picture never shows. Here the rows are filled from the
/// cache and the menu reassigned, so the copy carries them.
final class NavBarLeadingImageView: ExpoView {
  private static var images = [String: UIImage]()

  private var image: UIImage?
  private var menuImages = [String: UIImage]()
  private weak var navigationItem: UINavigationItem?
  private var observation: NSKeyValueObservation?

  func setImage(uri: String?) {
    image = uri.flatMap(Self.load)
    apply()
  }

  func setMenuImages(_ uris: [String: String]) {
    menuImages = uris.compactMapValues(Self.load)
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
    if !menuImages.isEmpty, let menu = leading.menu {
      var filled = false
      let rebuilt = fill(menu, filled: &filled)
      if filled {
        leading.menu = rebuilt
      }
    }
  }

  /// The menu with every titled, pictureless action given its picture, inline sections included.
  private func fill(_ menu: UIMenu, filled: inout Bool) -> UIMenu {
    let children = menu.children.map { child -> UIMenuElement in
      if let submenu = child as? UIMenu {
        return fill(submenu, filled: &filled)
      }
      if let action = child as? UIAction, action.image == nil, let image = menuImages[action.title] {
        action.image = image
        filled = true
      }
      return child
    }
    return filled ? menu.replacingChildren(children) : menu
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
