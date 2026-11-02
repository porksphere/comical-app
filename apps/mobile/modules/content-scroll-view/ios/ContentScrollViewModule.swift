import ExpoModulesCore

public class ContentScrollViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ContentScrollView")

    View(ContentScrollAnchorView.self) {
      Prop("active") { (view: ContentScrollAnchorView, active: Bool?) in
        view.active = active ?? true
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
    guard active, window != nil, let scrollView = firstScrollView(), let controller = owningController() else {
      return
    }
    controller.setContentScrollView(scrollView, for: .top)
  }

  private func firstScrollView() -> UIScrollView? {
    var view: UIView? = self
    while let current = view {
      if let scrollView = current as? UIScrollView {
        return scrollView
      }
      view = current.subviews.first
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
