import ExpoModulesCore

public class NavBarLargeTitleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarLargeTitle")

    View(NavBarLargeTitleView.self) {
      Prop("mode") { (view: NavBarLargeTitleView, mode: String) in
        view.mode = mode
      }

      OnViewDidUpdateProps { (view: NavBarLargeTitleView) in
        view.apply()
      }
    }
  }
}

/// react-native-screens knows two large title modes, `always` (the large title on a row of its own
/// under the bar's items, collapsing into the inline title as the list scrolls) and `never`, and
/// sets one of them on every header update. `inline` is UIKit's third: the large title on the
/// bar's own row beside the trailing items, never collapsing, the way Photos titles its tabs,
/// with the whole bar minimizing away on a scroll down and restoring over its material on the
/// way back up. This view, placed in the page where it can reach the screen, sets the mode the
/// page asks for on the screen's navigation item, and sets it again whenever the library puts its
/// own back (it observes the property), so the mode holds across every header update.
final class NavBarLargeTitleView: ExpoView {
  var mode = "inline"

  private weak var navigationItem: UINavigationItem?
  private var observation: NSKeyValueObservation?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      return
    }
    attach()
    apply()
  }

  private var wanted: UINavigationItem.LargeTitleDisplayMode {
    switch mode {
    case "always":
      return .always
    case "never":
      return .never
    default:
      if #available(iOS 17.0, *) {
        return .inline
      }
      return .always
    }
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
    observation = item.observe(\.largeTitleDisplayMode, options: [.new]) { [weak self] _, _ in
      self?.apply()
    }
  }

  func apply() {
    guard let navigationItem else {
      return
    }
    if let bar = owningController(of: self)?.navigationController?.navigationBar, !bar.prefersLargeTitles {
      bar.prefersLargeTitles = true
    }
    if navigationItem.largeTitleDisplayMode != wanted {
      navigationItem.largeTitleDisplayMode = wanted
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
