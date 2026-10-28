import ExpoModulesCore

public class NavBarScrollModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarScroll")

    View(NavBarScrollAnchorView.self) {
      Events("onFollow")
    }
  }
}

/// A navigation bar shows its scroll-edge appearance while the content under it is at the top
/// and its standard appearance once scrolled, judged from the scroll view the screen's view
/// controller names for its top edge. Left unnamed, UIKit walks the controller's view down its
/// first subviews only, so a list behind a backdrop is never found and the bar never changes.
///
/// This view names the first scroll view under it outright, for the controller nearest it — the
/// stack screen holding the bar — and does so again every time it enters a window, which is
/// every return to the screen: the hand-off is made natively, after the mount that put the list
/// under it and before the first frame of a pop back is drawn. `onFollow` reports each hand-off
/// (and each failure) once, as it changes, so a build can be read on the device.
final class NavBarScrollAnchorView: ExpoView {
  let onFollow = EventDispatcher()

  private var scheduled = false
  private weak var handed: UIScrollView?
  private var lastReport = ""

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      schedule()
    }
  }

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    schedule()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if handed == nil {
      schedule()
    }
  }

  /// One hand-off per run-loop pass: a mount inserts the whole subtree before anything here runs,
  /// so the list is there by the time the block does.
  private func schedule() {
    if scheduled {
      return
    }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      self?.scheduled = false
      self?.follow()
    }
  }

  private func follow() {
    guard window != nil else {
      return
    }
    guard let scrollView = firstScrollView(in: self) else {
      report(["ok": false, "reason": "no scroll view under the anchor"])
      return
    }
    guard let controller = owningController(of: self) else {
      report(["ok": false, "reason": "no view controller owns the anchor"])
      return
    }
    controller.setContentScrollView(scrollView, for: .top)
    handed = scrollView

    let navItem = controller.navigationItem
    var payload: [String: Any] = [
      "ok": true,
      "scrollView": String(describing: type(of: scrollView)),
      "controller": String(describing: type(of: controller)),
      "observed": controller.contentScrollView(for: .top) === scrollView,
      "standardBlur": navItem.standardAppearance?.backgroundEffect != nil,
      "edgeBlur": navItem.scrollEdgeAppearance?.backgroundEffect != nil,
      "edgeColor": navItem.scrollEdgeAppearance?.backgroundColor.map { String(describing: $0) } ?? "nil",
      "offset": scrollView.contentOffset.y,
      "insetTop": scrollView.adjustedContentInset.top,
      "insetBehavior": scrollView.contentInsetAdjustmentBehavior.rawValue,
      "listTop": scrollView.convert(CGPoint.zero, to: controller.view).y,
    ]
    if let nav = controller.navigationController {
      payload["top"] = nav.topViewController === controller
      payload["barBottom"] = nav.navigationBar.frame.maxY
      payload["barBlur"] = nav.navigationBar.standardAppearance.backgroundEffect != nil
    } else {
      payload["top"] = "no navigation controller"
    }
    report(payload)
  }

  private func report(_ payload: [String: Any]) {
    let key = String(describing: payload)
    if key == lastReport {
      return
    }
    lastReport = key
    onFollow(payload)
  }
}

private func firstScrollView(in view: UIView) -> UIScrollView? {
  if let scrollView = view as? UIScrollView {
    return scrollView
  }
  for subview in view.subviews {
    if let found = firstScrollView(in: subview) {
      return found
    }
  }
  return nil
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
