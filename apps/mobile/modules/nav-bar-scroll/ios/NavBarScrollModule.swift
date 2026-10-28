import ExpoModulesCore

public class NavBarScrollModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarScroll")

    // A navigation bar shows its scroll-edge appearance while the content under it is at the top
    // and its standard appearance once scrolled, judged from the scroll view the screen's view
    // controller names for its top edge. Left unnamed, UIKit walks the controller's view down its
    // first subviews only, so a list behind a backdrop is never found and the bar never changes.
    // This names the list outright, for the controller nearest the view — the stack screen
    // holding the bar. `false` when nothing under the view scrolls or it has no controller yet.
    AsyncFunction("follow") { (viewTag: Int) -> Bool in
      guard let view = self.appContext?.findView(withTag: viewTag, ofType: UIView.self),
            let scrollView = firstScrollView(in: view),
            let controller = owningController(of: view) else {
        return false
      }
      controller.setContentScrollView(scrollView, for: .top)
      return true
    }.runOnQueue(.main)
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
