import ExpoModulesCore

public class NavBarFadeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarFade")

    View(NavBarFadeView.self) {}
  }
}

/// react-native-screens applies a header update in one go, unanimated, so a title or material
/// switch lands in a single frame. This watches the screen's navigation item and, when either
/// actually changes, adds a fade to the navigation bar's layer from inside the setter: the same
/// Core Animation transaction as the update, so the transition runs from the old bar to the new.
/// Never during a push or pop, which animates the bar itself.
final class NavBarFadeView: ExpoView {
  private static let duration: CFTimeInterval = 0.3

  private weak var controller: UIViewController?
  private var observations: [NSKeyValueObservation] = []

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      observations = []
      return
    }
    attach()
  }

  private func attach() {
    guard let owner = owningController(of: self), owner !== controller else {
      return
    }
    controller = owner
    let item = owner.navigationItem
    observations = [
      item.observe(\.title, options: [.old, .new]) { [weak self] _, change in
        if change.oldValue != change.newValue {
          self?.fade()
        }
      },
      item.observe(\.standardAppearance, options: [.old, .new]) { [weak self] _, change in
        // Optional properties come back doubly wrapped.
        let old = (change.oldValue ?? nil)?.backgroundEffect != nil
        let new = (change.newValue ?? nil)?.backgroundEffect != nil
        if old != new {
          self?.fade()
        }
      },
    ]
  }

  private func fade() {
    guard let navigation = controller?.navigationController,
          navigation.transitionCoordinator == nil,
          window != nil else {
      return
    }
    let transition = CATransition()
    transition.type = .fade
    transition.duration = Self.duration
    transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    navigation.navigationBar.layer.add(transition, forKey: "comical.navBarFade")
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
