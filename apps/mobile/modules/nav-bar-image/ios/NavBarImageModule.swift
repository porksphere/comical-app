import ExpoModulesCore

public class NavBarImageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarImage")

    View(NavBarLeadingImageView.self) {
      Prop("uri") { (view: NavBarLeadingImageView, uri: String?) in
        view.setImage(uri: uri)
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
final class NavBarLeadingImageView: ExpoView {
  private static var images = [String: UIImage]()

  private var image: UIImage?
  private weak var navigationItem: UINavigationItem?
  private var observation: NSKeyValueObservation?

  func setImage(uri: String?) {
    image = uri.flatMap(Self.load)
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
    guard let image, let leading = navigationItem?.leftBarButtonItems?.first, leading.image !== image else {
      return
    }
    leading.image = image
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
