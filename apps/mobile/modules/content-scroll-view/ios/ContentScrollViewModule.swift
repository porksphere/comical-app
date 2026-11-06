import ExpoModulesCore

public class ContentScrollViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ContentScrollView")

    View(ContentScrollAnchorView.self) {
      Events("onScrolledPast", "onBarFrame")
      Prop("active") { (view: ContentScrollAnchorView, active: Bool?) in
        view.active = active ?? true
      }
      Prop("tabBar") { (view: ContentScrollAnchorView, tabBar: Bool?) in
        view.tabBar = tabBar ?? false
      }
      Prop("scrolledPast") { (view: ContentScrollAnchorView, threshold: Double?) in
        view.threshold = threshold.map { CGFloat($0) }
      }
      Prop("scrolledUpOnly") { (view: ContentScrollAnchorView, upOnly: Bool?) in
        view.upOnly = upOnly ?? true
      }
      Prop("topEdge") { (view: ContentScrollAnchorView, edge: String?) in
        view.topEdge = edge
      }
      AsyncFunction("scrollToTop") { (view: ContentScrollAnchorView) in
        view.scrollToTop()
      }
    }
  }
}

/// Left unnamed, UIKit looks for a screen's content scroll view itself, and a list under wrappers
/// can go unfound: the bar never slides away from it. react-native-screens' older stack, the one
/// expo-router uses, doesn't name it; its newer stack does, with this same call.
final class ContentScrollAnchorView: ExpoView {
  private var scheduled = false
  private var retries = 0
  private var offsetObservation: NSKeyValueObservation?
  private var past: Bool?
  private var lastOffset: CGFloat?
  let onScrolledPast = EventDispatcher()
  /// The navigation bar's content extent in the window, for what lays itself out on the bar's row
  /// (a tab's title): the bar's frame with its subviews', since on the folded Duo the frame starts
  /// under a strip at the top of the panel while the content view reaches the top, and the items
  /// centre on that. Nothing in JavaScript knows it.
  let onBarFrame = EventDispatcher()
  private var barObservation: NSKeyValueObservation?

  /// Layers on one screen share its controller: only the top one's list is named, and it is named
  /// again when the layer over it goes.
  var active = true {
    didSet {
      if active && !oldValue {
        schedule()
      }
    }
  }

  /// Name the list for the bottom bar too: a tab root whose list react-native-screens' marker can't
  /// hold (a SwiftUI list, deep in its host), so the tab bar's edge follows it.
  var tabBar = false {
    didSet {
      if tabBar != oldValue {
        schedule()
      }
    }
  }

  /// The list's top scroll edge effect (iOS 26): `hidden`, `soft`, `hard` or `automatic`. For a
  /// list react-native-screens can't reach with the screen's own option — a SwiftUI list, deep in
  /// its host — and set where the list is found. Nil: left as it is.
  var topEdge: String? {
    didSet {
      if topEdge != oldValue {
        schedule()
      }
    }
  }

  /// Report whether the list has scrolled past this many points from its rest at the top
  /// (`onScrolledPast`), for a bar that takes its material only once content is under it — and
  /// only as the list comes back up, when the bar is returning: scrolling down the bar is sliding
  /// away, and a backing switched under the slide flickers (the series page's rule). Back only once
  /// within a quarter of the threshold: a crossing is a switch, and a list resting on the line
  /// would switch on every point. Nil: no reports.
  /// Whether a crossing counts only as the list comes back up (a bar's material, switched as the
  /// bar returns, never under its slide), or either way (a title that goes as the list goes).
  var upOnly = true

  var threshold: CGFloat? {
    didSet {
      past = nil
      lastOffset = nil
      schedule()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      offsetObservation = nil
      barObservation = nil
    }
    retries = 0
    schedule()
  }

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    schedule()
  }

  /// A mount inserts the whole subtree before this runs, so the list is there by then.
  private func schedule() {
    if scheduled {
      return
    }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      self?.scheduled = false
      self?.nameContentScrollView()
    }
  }

  private func nameContentScrollView() {
    guard active, window != nil, let controller = owningController() else {
      return
    }
    // A SwiftUI list is laid out after its host is on the window, and the search wants a list the
    // size of the page: look again, a few times, until it is there.
    guard let scrollView = findScrollView() else {
      guard retries < 20 else {
        return
      }
      retries += 1
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
        self?.nameContentScrollView()
      }
      return
    }
    retries = 0
    controller.setContentScrollView(scrollView, for: tabBar ? .all : .top)
    watchBar(controller)
    applyTopEdge(scrollView)
    watch(scrollView)
  }

  /// A switch of the edge is a cut: `isHidden` and `style` don't animate, in an animation block or
  /// not, and nothing public fades an edge. It passes where it is made, at a list's top, where
  /// UIKit ramps the edge from nothing anyway; a bar whose line is deep in its list (the series
  /// page's) backs itself instead.
  private func applyTopEdge(_ scrollView: UIScrollView) {
    guard #available(iOS 26.0, *), let topEdge else {
      return
    }
    let effect = scrollView.topEdgeEffect
    switch topEdge {
    case "hidden":
      effect.isHidden = true
      effect.style = .automatic
    case "soft":
      effect.isHidden = false
      effect.style = .soft
    case "hard":
      effect.isHidden = false
      effect.style = .hard
    default:
      effect.isHidden = false
      effect.style = .automatic
    }
  }

  private func watchBar(_ controller: UIViewController) {
    guard let bar = controller.navigationController?.navigationBar else {
      return
    }
    reportBarFrame(bar)
    // The bar's height changes as its items come and go (a folded display takes them into its
    // vertical bar), not as it slides away: minimization moves its content.
    barObservation = bar.observe(\.bounds, options: [.new]) { [weak self] bar, _ in
      self?.reportBarFrame(bar)
    }
  }

  private func reportBarFrame(_ bar: UINavigationBar) {
    guard let window else {
      return
    }
    let extent = bar.subviews
      .filter { !$0.isHidden && !$0.frame.isEmpty }
      .reduce(bar.bounds) { $0.union($1.frame) }
    let frame = bar.convert(extent, to: window)
    onBarFrame(["top": frame.minY, "height": frame.height])
  }

  private func watch(_ scrollView: UIScrollView) {
    offsetObservation = nil
    guard let threshold else {
      return
    }
    offsetObservation = scrollView.observe(\.contentOffset, options: [.initial, .new]) { [weak self] scrollView, _ in
      guard let self else {
        return
      }
      let offset = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
      let up = self.lastOffset.map { offset < $0 } ?? true
      self.lastOffset = offset
      let next = self.past == true ? offset > threshold / 4 : offset > threshold && (up || !self.upOnly)
      if next == self.past {
        return
      }
      self.past = next
      self.onScrolledPast(["past": next, "offset": offset])
    }
  }

  /// The tab's reselect, for a list react-native-screens can't scroll itself (see `tabBar`).
  func scrollToTop() {
    guard let scrollView = findScrollView() else {
      return
    }
    let top = CGPoint(x: scrollView.contentOffset.x, y: -scrollView.adjustedContentInset.top)
    scrollView.setContentOffset(top, animated: true)
  }

  /// The list first in line, each first subview down: a page's one list under its wrappers. Failing
  /// that, the nearest list the size of the page anywhere under here: a SwiftUI list is a few views
  /// in and not first among its host's.
  private func findScrollView() -> UIScrollView? {
    var view: UIView? = self
    while let current = view {
      if let scrollView = current as? UIScrollView {
        return scrollView
      }
      view = current.subviews.first
    }
    let minHeight = (window?.bounds.height ?? 0) / 2
    var queue: [UIView] = subviews
    while !queue.isEmpty {
      let current = queue.removeFirst()
      if let scrollView = current as? UIScrollView, scrollView.bounds.height >= minHeight {
        return scrollView
      }
      queue.append(contentsOf: current.subviews)
    }
    return nil
  }

  private func owningController() -> UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let controller = current as? UIViewController {
        return controller
      }
      responder = current.next
    }
    return nil
  }
}
