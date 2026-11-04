import ExpoModulesCore
import UIKit

public class NavBarEdgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarEdge")

    View(NavBarEdgeView.self) {
      Events("onEdgeChange")
    }
  }
}

/// How far the screen's navigation bar has slid away: its content's bottom on screen, less where it
/// rests, so 0 while it is all there and down to minus its height once it is gone. iOS bar
/// minimization moves the bar's content, not the bar, and tells nobody, so the edge is read off the
/// content's presentation layer once a frame while this is on a window, and reported when it moves.
/// A bar already slid away when this arrives reads as at rest until it has come back once.
final class NavBarEdgeView: ExpoView {
  let onEdgeChange = EventDispatcher()

  private weak var controller: UIViewController?
  private var link: CADisplayLink?
  private var reported: CGFloat?
  /// The content's bottom at rest: the lowest it has been, since the bar only slides up from there.
  /// Forgotten when the bar changes height, a search field or a fold.
  private var rest: (bottom: CGFloat, barHeight: CGFloat)?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    link?.invalidate()
    link = nil
    guard window != nil else {
      return
    }
    controller = owningController(of: self)
    reported = nil
    rest = nil
    let link = CADisplayLink(target: Proxy(self), selector: #selector(Proxy.tick))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  deinit {
    link?.invalidate()
  }

  fileprivate func tick() {
    guard let bar = controller?.navigationController?.navigationBar, !bar.isHidden else {
      return
    }
    // What slides is the bar's content, not the bar. The content is the bar subview holding the
    // title, where there is one, since the background may run on its own.
    let content = bar.subviews.first { view in
      controller?.navigationItem.titleView?.isDescendant(of: view) == true
    }
    let candidates = content.map { [$0] } ?? bar.subviews.filter { !$0.isHidden && !$0.frame.isEmpty }
    // Through the presentation layers to the window's, so the slide counts however it is done: the
    // subview's frame, its transform or the bar's bounds.
    guard let bottom = candidates.compactMap({ view -> CGFloat? in
      let layer = view.layer.presentation() ?? view.layer
      return layer.convert(layer.bounds, to: nil).maxY
    }).max() else {
      return
    }
    let height = bar.bounds.height
    if rest == nil || rest?.barHeight != height || bottom > rest?.bottom ?? bottom {
      rest = (bottom, height)
    }
    let offset = min(0, max(-height, bottom - (rest?.bottom ?? bottom))).rounded()
    if offset != reported {
      reported = offset
      onEdgeChange(["offset": offset])
    }
  }
}

/// A display link holds its target strongly, and the view would never go.
private final class Proxy: NSObject {
  weak var view: NavBarEdgeView?

  init(_ view: NavBarEdgeView) {
    self.view = view
  }

  @objc func tick() {
    view?.tick()
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
