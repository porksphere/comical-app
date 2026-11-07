import ExpoModulesCore
import UIKit

public class ScreenCornersModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScreenCorners")

    // Clockwise from the top left, in points, in the window's current orientation.
    AsyncFunction("windowCorners") { () -> [Double]? in
      guard let window = Self.keyWindow() else { return nil }
      if #available(iOS 26.0, tvOS 26.0, *) {
        // The system's own answer, per corner: a view filling the window, rounded concentrically
        // with it, takes each of the window's corners — the display's radius where the window
        // reaches a rounded corner, none at a hard edge. Read back once it has laid out.
        let probe = UIView(frame: window.bounds)
        probe.isUserInteractionEnabled = false
        probe.alpha = 0
        probe.cornerConfiguration = .corners(radius: .containerConcentric(minimum: 0))
        window.addSubview(probe)
        probe.layoutIfNeeded()
        let corners: [UIRectCorner] = [.topLeft, .topRight, .bottomRight, .bottomLeft]
        let radii = corners.map { Double(probe.effectiveRadius(corner: $0)) }
        probe.removeFromSuperview()
        if radii.contains(where: { $0 > 0 }) { return radii }
      }
      // Before that, and wherever it answers nothing: the screen's one radius, all round.
      let screen = window.screen
      let key = "_displayCornerRadius"
      guard screen.responds(to: NSSelectorFromString(key)), let radius = screen.value(forKey: key) as? CGFloat else {
        return nil
      }
      return [Double](repeating: Double(radius), count: 4)
    }.runOnQueue(.main)
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }
}
