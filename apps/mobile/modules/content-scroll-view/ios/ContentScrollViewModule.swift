import ExpoModulesCore

public class ContentScrollViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ContentScrollView")

    View(ContentScrollAnchorView.self) {
      Prop("active") { (view: ContentScrollAnchorView, active: Bool?) in
        view.active = active ?? true
      }
      Prop("tabBar") { (view: ContentScrollAnchorView, tabBar: Bool?) in
        view.tabBar = tabBar ?? false
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

  override func didMoveToWindow() {
    super.didMoveToWindow()
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
    guard active, window != nil, let scrollView = findScrollView(), let controller = owningController() else {
      return
    }
    controller.setContentScrollView(scrollView, for: tabBar ? .all : .top)
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
