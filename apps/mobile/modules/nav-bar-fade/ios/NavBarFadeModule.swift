import ExpoModulesCore
import UIKit

public class NavBarFadeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarFade")

    OnCreate {
      MinimizationGuard.install()
    }

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
    MinimizationGuard.install()
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

/// react-native-screens hands every navigation item a NEW `UIBarMinimization` on every header update,
/// even when nothing about the slide-away changed. A bar mid-slide when that lands stops sliding and
/// snaps into place, so a title switched as the bar came back in popped it in instead. This drops an
/// assignment that matches what the item already has, app-wide, which UIKit has no reason to see.
///
/// Through the runtime, by name, so it builds against any SDK and does nothing before iOS 27.
private enum MinimizationGuard {
  private static let keys = ["minimizationBehavior", "restorationBehavior", "safeAreaAdjustment"]
  private static var installed = false

  static func install() {
    guard !installed else { return }
    installed = true
    let getter = NSSelectorFromString("navigationBarMinimization")
    let setter = NSSelectorFromString("setNavigationBarMinimization:")
    guard UINavigationItem.instancesRespond(to: getter),
          let method = class_getInstanceMethod(UINavigationItem.self, setter) else {
      return
    }
    typealias Setter = @convention(c) (UINavigationItem, Selector, AnyObject?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Setter.self)
    let replacement: @convention(block) (UINavigationItem, AnyObject?) -> Void = { item, next in
      if let next = next as? NSObject,
         let current = item.perform(getter)?.takeUnretainedValue() as? NSObject,
         same(current, next) {
        return
      }
      original(item, setter, next)
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))
  }

  private static func same(_ a: NSObject, _ b: NSObject) -> Bool {
    keys.allSatisfy { key in
      let selector = NSSelectorFromString(key)
      guard a.responds(to: selector), b.responds(to: selector) else { return false }
      return (a.value(forKey: key) as? NSNumber) == (b.value(forKey: key) as? NSNumber)
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
