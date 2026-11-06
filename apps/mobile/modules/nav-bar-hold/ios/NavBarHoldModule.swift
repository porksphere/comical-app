import ExpoModulesCore

public class NavBarHoldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NavBarHold")

    View(NavBarHoldView.self) {
      Events("onHold")

      Prop("pulseSeq") { (view: NavBarHoldView, seq: Int) in
        view.pulseSeq = seq
      }
      Prop("pulseAmount") { (view: NavBarHoldView, amount: Double) in
        view.pulseAmount = CGFloat(amount)
      }

      OnViewDidUpdateProps { (view: NavBarHoldView) in
        view.propsDidUpdate()
      }
    }
  }
}

/// A touch that wanders further than this is a drag, not a hold; the title's label is taken this
/// much larger, too.
private let holdSlop: CGFloat = 10
/// A beat's swell is quick and its settle slower, the custom marks' pulse (`use-ramped-hold`).
private let pulseUp: TimeInterval = 0.07
private let pulseDown: TimeInterval = 0.12

/// A system large title is UIKit's own text with nothing of the app's in it, so a hold on it is
/// read from the bar's touches instead: this view, placed in the page, attaches a recognizer to
/// the navigation controller's view (the touch lands on the bar, which the controller's view
/// holds, and a recognizer sees every touch under its view) that reports a press beginning on the
/// title and ending — the lift, a drag past the slop, or the system cancelling it — as `onHold`
/// phases, for the screen's ramped hold. It takes only touches on the title's label, the largest
/// label in the bar showing the screen's title, of the screen that owns it while that screen is
/// the top one and while the bar is in place (minimized, the bar's content is moved above it),
/// and never cancels or delays the bar's own handling. The recognizer leaves with the view.
///
/// The ramp's beats come back as `pulseSeq` (a count) and `pulseAmount`, and each swells the held
/// label and lets it settle, the custom marks' pulse, since nothing of the app's draws the title.
final class NavBarHoldView: ExpoView, UIGestureRecognizerDelegate {
  let onHold = EventDispatcher()

  var pulseSeq = 0
  var pulseAmount: CGFloat = 0
  private var pulsedSeq = 0

  private weak var navigation: UINavigationController?
  private var recognizer: UILongPressGestureRecognizer?
  private var origin = CGPoint.zero
  private var holding = false
  private weak var heldLabel: UILabel?

  func propsDidUpdate() {
    guard pulseSeq != pulsedSeq else {
      return
    }
    pulsedSeq = pulseSeq
    guard let label = heldLabel else {
      return
    }
    let scale = 1 + pulseAmount
    UIView.animate(withDuration: pulseUp, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) {
      label.transform = CGAffineTransform(scaleX: scale, y: scale)
    } completion: { _ in
      UIView.animate(withDuration: pulseDown, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState]) {
        label.transform = .identity
      }
    }
  }

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
      if let navigation, let owner = owningController(of: self) {
        heldLabel = titleLabel(in: navigation.navigationBar, titled: owner.navigationItem.title)
      }
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
          let owner = owningController(of: self),
          navigation.topViewController === owner,
          let label = titleLabel(in: navigation.navigationBar, titled: owner.navigationItem.title) else {
      return false
    }
    let bar = navigation.navigationBar
    let frame = label.convert(label.bounds, to: bar).insetBy(dx: -holdSlop, dy: -holdSlop)
    guard frame.midY > 0, bar.bounds.contains(CGPoint(x: frame.midX, y: frame.midY)) else {
      return false
    }
    return frame.contains(touch.location(in: bar))
  }

  /// The bar's label showing the title at the largest size: the large title, where the inline
  /// title's label may stand hidden beside it with the same text.
  private func titleLabel(in bar: UINavigationBar, titled title: String?) -> UILabel? {
    guard let title, !title.isEmpty else {
      return nil
    }
    var found: UILabel?
    var queue: [UIView] = bar.subviews
    while !queue.isEmpty {
      let view = queue.removeFirst()
      if let label = view as? UILabel, label.text == title, !label.isHidden, label.alpha > 0,
         label.font.pointSize > (found?.font.pointSize ?? 0) {
        found = label
      }
      queue.append(contentsOf: view.subviews)
    }
    return found
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
