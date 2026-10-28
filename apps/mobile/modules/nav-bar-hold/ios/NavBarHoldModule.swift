import ExpoModulesCore

public class NavBarHoldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarHold")

    View(NavBarHoldView.self) {
      Events("onHold")
    }
  }
}

/// The height of the bar's inline row: a touch below it, while the bar stands taller, is on the
/// large title.
private let inlineRowHeight: CGFloat = 44
/// A touch that wanders further than this is a drag, not a hold.
private let holdSlop: CGFloat = 10

/// A system large title is UIKit's own text with nothing of the app's in it, so a hold on it is
/// read from the bar's touches instead: this view, placed in the page, attaches a recognizer to
/// the navigation controller's view (the touch lands on the bar, which the controller's view
/// holds, and a recognizer sees every touch under its view) that reports a press beginning in the
/// large title's band and ending — the lift, a drag past the slop, or the system cancelling it —
/// as `onHold` phases, for the screen's ramped hold. It takes only touches on the band, below the
/// inline row while the bar is expanded, of the screen that owns it while that screen is the
/// top one, and never cancels or delays the bar's own handling. The recognizer leaves with the
/// view.
final class NavBarHoldView: ExpoView, UIGestureRecognizerDelegate {
  let onHold = EventDispatcher()

  private weak var navigation: UINavigationController?
  private var recognizer: UILongPressGestureRecognizer?
  private var origin = CGPoint.zero
  private var holding = false

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detach()
    } else {
      attach()
    }
  }

  deinit {
    detach()
  }

  private func attach() {
    guard recognizer == nil,
          let controller = owningController(of: self),
          let navigation = controller.navigationController else {
      return
    }
    let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(handle))
    recognizer.minimumPressDuration = 0
    recognizer.cancelsTouchesInView = false
    recognizer.delaysTouchesBegan = false
    recognizer.delaysTouchesEnded = false
    recognizer.delegate = self
    navigation.view.addGestureRecognizer(recognizer)
    self.recognizer = recognizer
    self.navigation = navigation
  }

  private func detach() {
    if let recognizer {
      recognizer.view?.removeGestureRecognizer(recognizer)
    }
    recognizer = nil
    navigation = nil
    end()
  }

  @objc private func handle(_ recognizer: UILongPressGestureRecognizer) {
    switch recognizer.state {
    case .began:
      origin = recognizer.location(in: nil)
      holding = true
      onHold(["phase": "begin"])
    case .changed:
      let point = recognizer.location(in: nil)
      if holding, hypot(point.x - origin.x, point.y - origin.y) > holdSlop {
        end()
      }
    case .ended, .cancelled, .failed:
      end()
    default:
      break
    }
  }

  private func end() {
    guard holding else {
      return
    }
    holding = false
    onHold(["phase": "end"])
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard let navigation,
          navigation.topViewController === owningController(of: self) else {
      return false
    }
    let bar = navigation.navigationBar
    guard bar.bounds.height > inlineRowHeight else {
      return false
    }
    let point = touch.location(in: bar)
    return bar.bounds.contains(point) && point.y > inlineRowHeight
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    return true
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
