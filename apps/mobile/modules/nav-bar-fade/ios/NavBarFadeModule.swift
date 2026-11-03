import ExpoModulesCore
import UIKit

public class NavBarFadeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarFade")

    OnCreate {
      MinimizationGuard.install()
    }

    View(NavBarFadeView.self) {
      Events("onTrace")
    }
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
  /// TEMPORARY: what the bar was doing at each switch, for the Diagnostics screen.
  let onTrace = EventDispatcher()

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
          self?.fade(because: "title '\((change.oldValue ?? nil) ?? "")' -> '\((change.newValue ?? nil) ?? "")'")
        }
      },
      item.observe(\.standardAppearance, options: [.old, .new]) { [weak self] _, change in
        // Optional properties come back doubly wrapped.
        let old = (change.oldValue ?? nil)?.backgroundEffect != nil
        let new = (change.newValue ?? nil)?.backgroundEffect != nil
        if old != new {
          self?.fade(because: "material \(old) -> \(new)")
        }
      },
    ]
  }

  private func fade(because reason: String) {
    guard let navigation = controller?.navigationController,
          navigation.transitionCoordinator == nil,
          window != nil else {
      trace("\(reason): no fade (nav \(controller?.navigationController != nil), "
        + "transition \(controller?.navigationController?.transitionCoordinator != nil), window \(window != nil))")
      return
    }
    trace("\(reason): fade")
    for delay in [0.05, 0.35] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.trace("  +\(Int(delay * 1000))ms")
      }
    }
    let transition = CATransition()
    transition.type = .fade
    transition.duration = Self.duration
    transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    navigation.navigationBar.layer.add(transition, forKey: "comical.navBarFade")
  }
}

extension NavBarFadeView {
  /// Where the bar's content sits (minimization shifts the bar's subviews, not the bar), and how many
  /// animations are running on the bar and on its subviews.
  fileprivate func trace(_ event: String) {
    guard let bar = controller?.navigationController?.navigationBar else {
      onTrace(["message": "\(event) | no bar"])
      return
    }
    let shown = bar.subviews.filter { !$0.isHidden && !$0.frame.isEmpty }
    let top = shown.map { Int($0.frame.minY) }.min() ?? -1
    let bottom = shown.map { Int($0.frame.maxY) }.max() ?? -1
    let barAnimations = bar.layer.animationKeys()?.count ?? 0
    let subviewAnimations = shown.reduce(0) { $0 + ($1.layer.animationKeys()?.count ?? 0) }
    let presented = bar.subviews.compactMap { $0.layer.presentation()?.frame.maxY }.max().map { Int($0) } ?? -1
    onTrace(["message": "\(event) | guard \(MinimizationGuard.status) skipped \(MinimizationGuard.skipped) "
      + "passed \(MinimizationGuard.passed) | bar h\(Int(bar.bounds.height)) alpha \(bar.alpha) "
      + "content \(top)..\(bottom) on-screen \(presented) | anims bar \(barAnimations) sub \(subviewAnimations)"])
  }
}

/// react-native-screens hands every navigation item a NEW `UIBarMinimization` on every header update,
/// even when nothing about the slide-away changed. Suspected of snapping a bar that is sliding back in
/// into place; the first build with this guard still popped, so the trace is there to settle it. This
/// drops an assignment that matches what the item already has, app-wide, which UIKit has no reason to
/// see.
///
/// Through the runtime, by name, so it builds against any SDK and does nothing before iOS 27.
private enum MinimizationGuard {
  private static let keys = ["minimizationBehavior", "restorationBehavior", "safeAreaAdjustment"]
  private static var installed = false
  // TEMPORARY, for the trace.
  static var status = "not installed"
  static var skipped = 0
  static var passed = 0

  static func install() {
    guard !installed else { return }
    installed = true
    let getter = NSSelectorFromString("navigationBarMinimization")
    let setter = NSSelectorFromString("setNavigationBarMinimization:")
    guard UINavigationItem.instancesRespond(to: getter),
          let method = class_getInstanceMethod(UINavigationItem.self, setter) else {
      status = "unavailable"
      return
    }
    status = "on"
    typealias Setter = @convention(c) (UINavigationItem, Selector, AnyObject?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Setter.self)
    let replacement: @convention(block) (UINavigationItem, AnyObject?) -> Void = { item, next in
      if let next = next as? NSObject,
         let current = item.perform(getter)?.takeUnretainedValue() as? NSObject,
         same(current, next) {
        skipped += 1
        return
      }
      passed += 1
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
