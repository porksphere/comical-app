import ExpoModulesCore

public class NavBarLargeTitleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarLargeTitle")

    View(NavBarLargeTitleView.self) {
      Events("onReport")

      Prop("mode") { (view: NavBarLargeTitleView, mode: String) in
        view.mode = mode
      }

      Prop("report") { (view: NavBarLargeTitleView, report: Bool) in
        view.report = report
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
///
/// With `report` on it describes what UIKit does with the bar through `onReport`: the item's
/// mode and search setup when it attaches and a moment later, each time the mode is changed
/// under it, and each time the bar's height moves by more than a few points. The search tab's
/// large title collapses on scroll where no other tab's does, and these are what tell it apart.
final class NavBarLargeTitleView: ExpoView {
  var mode = "inline"
  var report = false
  let onReport = EventDispatcher()

  private weak var navigationItem: UINavigationItem?
  private var observation: NSKeyValueObservation?
  private var barObservation: NSKeyValueObservation?
  private var lastBarHeight: CGFloat = -1
  private var reports = 0

  /// Enough for an open, a few scrolls and a return, and no more: each lands in a persisted log.
  private static let maxReports = 40

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
      send("attach: no owning view controller")
      return
    }
    let item = controller.navigationItem
    if item === navigationItem {
      return
    }
    navigationItem = item
    observation = item.observe(\.largeTitleDisplayMode, options: [.old, .new]) { [weak self] _, change in
      guard let self else {
        return
      }
      if let old = change.oldValue, let new = change.newValue, old != new {
        self.send("mode changed \(name(of: old)) -> \(name(of: new))")
      }
      self.apply()
    }
    if let bar = controller.navigationController?.navigationBar {
      barObservation = bar.observe(\.bounds, options: [.new]) { [weak self] bar, _ in
        self?.barMoved(bar)
      }
    }
    send("attach " + describe(controller))
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
      guard let self, let controller = owningController(of: self) else {
        return
      }
      self.send("settled " + self.describe(controller))
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

  private func barMoved(_ bar: UINavigationBar) {
    let height = bar.bounds.height
    guard abs(height - lastBarHeight) >= 6 else {
      return
    }
    lastBarHeight = height
    send("bar height \(Int(height.rounded())) " + largeTitleViews(in: bar))
  }

  private func send(_ message: String) {
    guard report, reports < Self.maxReports else {
      return
    }
    reports += 1
    let title = navigationItem?.title ?? "?"
    onReport(["message": "[\(title)] \(message)"])
  }

  private func describe(_ controller: UIViewController) -> String {
    let item = controller.navigationItem
    var parts = [
      "vc=\(type(of: controller))",
      "nav=\(controller.navigationController.map { "\(type(of: $0))" } ?? "none")",
      "mode=\(name(of: item.largeTitleDisplayMode)) wanted=\(name(of: wanted))",
      "prefersLarge=\(controller.navigationController?.navigationBar.prefersLargeTitles ?? false)",
    ]
    if let search = item.searchController {
      var s = "search active=\(search.isActive) hidesOnScroll=\(item.hidesSearchBarWhenScrolling)"
      if #available(iOS 16.0, *) {
        s += " preferred=\(item.preferredSearchBarPlacement.rawValue) actual=\(item.searchBarPlacement.rawValue)"
      }
      if #available(iOS 26.0, *) {
        s += " toolbarIntegration=\(item.searchBarPlacementAllowsToolbarIntegration)"
      }
      parts.append(s)
    } else {
      parts.append("search=none")
    }
    if #available(iOS 18.0, *), let tab = controller.tabBarController?.selectedTab {
      parts.append("tab=\(type(of: tab))")
    }
    if #available(iOS 15.0, *) {
      parts.append("contentScroll=\(controller.contentScrollView(for: .top) != nil)")
    }
    if let bar = controller.navigationController?.navigationBar {
      parts.append("bar=\(Int(bar.bounds.height.rounded())) " + largeTitleViews(in: bar))
    }
    return parts.joined(separator: " ")
  }

  /// The bar's large title views, by their private class names, with their height and alpha: which
  /// of them UIKit is showing says whether the title is inline, on its own row, or collapsed.
  private func largeTitleViews(in bar: UINavigationBar) -> String {
    var found: [String] = []
    func walk(_ view: UIView, depth: Int) {
      let name = String(describing: type(of: view))
      if name.contains("LargeTitle") || name.contains("TitleControl") {
        found.append("\(name)(h=\(Int(view.bounds.height.rounded())) a=\(String(format: "%.2f", view.alpha))\(view.isHidden ? " hidden" : ""))")
      }
      if depth < 6 {
        for sub in view.subviews {
          walk(sub, depth: depth + 1)
        }
      }
    }
    walk(bar, depth: 0)
    return found.isEmpty ? "titleViews=none" : "titleViews=" + found.joined(separator: ",")
  }
}

private func name(of mode: UINavigationItem.LargeTitleDisplayMode) -> String {
  switch mode {
  case .automatic:
    return "automatic"
  case .always:
    return "always"
  case .never:
    return "never"
  default:
    if #available(iOS 17.0, *), mode == .inline {
      return "inline"
    }
    return "raw\(mode.rawValue)"
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
