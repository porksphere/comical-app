import ExpoModulesCore
import UIKit

public class SoftEdgeBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SoftEdgeBlur")

    View(SoftEdgeBlurView.self) {
      Prop("visible") { (view: SoftEdgeBlurView, visible: Bool) in
        view.setVisible(visible)
      }
    }
  }
}

/// The system's dark material under a mask that keeps it whole along the top and fades it out
/// toward the bottom, the look of iOS 26's soft scroll-edge effect. It comes and goes by animating
/// the effect itself: UIKit stops rendering a visual effect view properly once it or anything
/// above it is faded.
final class SoftEdgeBlurView: ExpoView {
  private static let material = UIBlurEffect(style: .systemMaterialDark)

  private let effectView = UIVisualEffectView(effect: nil)
  private let fade = FadeMaskView()
  private var visible: Bool?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    effectView.isUserInteractionEnabled = false
    effectView.mask = fade
    addSubview(effectView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    effectView.frame = bounds
    fade.frame = effectView.bounds
  }

  func setVisible(_ next: Bool) {
    guard next != visible else { return }
    let first = visible == nil
    visible = next
    let apply = { self.effectView.effect = next ? Self.material : nil }
    if first || window == nil {
      apply()
    } else {
      UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState], animations: apply)
    }
  }
}

/// Opaque at the top, eased out to clear at the bottom.
private final class FadeMaskView: UIView {
  override class var layerClass: AnyClass { CAGradientLayer.self }

  override init(frame: CGRect) {
    super.init(frame: frame)
    let gradient = layer as! CAGradientLayer
    let alphas: [CGFloat] = [1, 1, 0.8, 0.4, 0.12, 0]
    gradient.colors = alphas.map { UIColor(white: 0, alpha: $0).cgColor }
    gradient.locations = [0, 0.4, 0.58, 0.76, 0.9, 1]
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}
