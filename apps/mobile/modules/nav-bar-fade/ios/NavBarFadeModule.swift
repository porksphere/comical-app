import ExpoModulesCore
import UIKit

public class NavBarFadeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarFade")

    View(NavBarFadeView.self) {
      Events("onTrace")

      Prop("edgeBacked") { (view: NavBarFadeView, backed: Bool) in
        view.edgeBacked = backed
      }
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

  /// Whether the scroll view's top edge effect shows behind the custom title view. UIKit draws a
  /// scroll edge only behind what a bar registers, and it registers a text title but not a custom
  /// view, so the title is registered by hand while this is on.
  var edgeBacked = false {
    didSet {
      if edgeBacked != oldValue {
        applyEdgeBacking()
      }
    }
  }
  private var edgeInteraction: UIInteraction?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else {
      observations = []
      removeEdgeInteraction()
      return
    }
    attach()
    applyEdgeBacking()
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

  private func applyEdgeBacking() {
    guard #available(iOS 26.0, *) else {
      return
    }
    guard edgeBacked, window != nil else {
      removeEdgeInteraction()
      return
    }
    // react-native-screens sets the title view in its own header update: give it the turn.
    DispatchQueue.main.async { [weak self] in
      self?.addEdgeInteraction()
    }
  }

  @available(iOS 26.0, *)
  private func addEdgeInteraction() {
    guard edgeBacked, window != nil else {
      return
    }
    guard let titleView = controller?.navigationItem.titleView else {
      trace("edge: no title view")
      return
    }
    if let current = edgeInteraction, current.view === titleView {
      return
    }
    guard let scrollView = nearestPageScrollView() else {
      trace("edge: no scroll view")
      return
    }
    removeEdgeInteraction()
    let interaction = UIScrollEdgeElementContainerInteraction()
    interaction.scrollView = scrollView
    interaction.edge = .top
    titleView.addInteraction(interaction)
    edgeInteraction = interaction
    trace("edge: on")
  }

  private func removeEdgeInteraction() {
    guard let interaction = edgeInteraction else {
      return
    }
    interaction.view?.removeInteraction(interaction)
    edgeInteraction = nil
    trace("edge: off")
  }

  /// The page's list: the scroll view nearest to this view that fills most of the screen (a rail is
  /// a scroll view too), searched from its parent outwards, so a series layered over another finds
  /// its own list first.
  private func nearestPageScrollView() -> UIScrollView? {
    let minHeight = (window?.bounds.height ?? 0) / 2
    var container = superview
    while let current = container {
      var queue: [UIView] = [current]
      while !queue.isEmpty {
        let candidate = queue.removeFirst()
        if let scrollView = candidate as? UIScrollView, scrollView.bounds.height >= minHeight {
          return scrollView
        }
        queue.append(contentsOf: candidate.subviews)
      }
      if current === controller?.view {
        return nil
      }
      container = current.superview
    }
    return nil
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
    onTrace(["message": "\(event) | bar h\(Int(bar.bounds.height)) alpha \(bar.alpha) "
      + "content \(top)..\(bottom) on-screen \(presented) | anims bar \(barAnimations) sub \(subviewAnimations)"])
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
