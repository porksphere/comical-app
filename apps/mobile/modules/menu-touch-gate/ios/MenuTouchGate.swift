import ExpoModulesCore
import UIKit.UIGestureRecognizerSubclass

/// Installs `MenuTouchGate` on every window of the app as it comes up, so a tap that closes a
/// system menu never also presses the React Native view under it.
///
/// Expo ships the same gate (`SystemMenuTouchGate` in expo-modules-core) but only installs it from
/// its SwiftUI host view, so it is missing from a window until some SwiftUI content has been on
/// screen. The menus here are UIKit's — the navigation bar's items (react-native-screens) and the
/// `menu-anchor` row — which host no SwiftUI, so the gate goes in at launch instead.
public class MenuTouchGateAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private var observers: [NSObjectProtocol] = []

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    for window in application.windows {
      MenuTouchGate.install(in: window)
    }
    let center = NotificationCenter.default
    for name in [UIWindow.didBecomeVisibleNotification, UIWindow.didBecomeKeyNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { notification in
        if let window = notification.object as? UIWindow {
          MenuTouchGate.install(in: window)
        }
      })
    }
    return true
  }
}

/// A gesture recognizer on the window that, while a system menu is open, tells React Native's
/// surface touch handler to ignore each touch before UIKit delivers it. UIKit presents a menu in
/// a `_UIContextMenuContainerView` added to the window and hit-tests the dismissing tap through to
/// the view beneath; native responders are suppressed but gesture recognizers are not, so React
/// Native's handler (itself a recognizer) would otherwise fire `onPress` on the Pressable under
/// the tap. After Expo's `SystemMenuTouchGate` (expo-modules-core, MIT).
final class MenuTouchGate: UIGestureRecognizer, UIGestureRecognizerDelegate {
  init() {
    super.init(target: nil, action: nil)
    // Both default to true: never hold a touch back, and never give React Native's handler a
    // reason to cancel its own touches on the gate's account.
    delaysTouchesEnded = false
    cancelsTouchesInView = false
    delegate = self
  }

  static func install(in window: UIWindow) {
    let installed = window.gestureRecognizers?.contains { $0 is MenuTouchGate } ?? false
    if !installed {
      window.addGestureRecognizer(MenuTouchGate())
    }
  }

  /// The container is a direct subview of the window, and UIKit turns its interaction off the
  /// moment a dismissal commits, so a tap during the dismiss animation reaches the app again.
  private static func isShowingMenu(in window: UIWindow) -> Bool {
    let container = "_UI".appending("ContextMenuContainerView")
    return window.subviews.contains { view in
      view.isUserInteractionEnabled && NSStringFromClass(type(of: view)) == container
    }
  }

  private static func surfaceTouchHandlers(above view: UIView?) -> [UIGestureRecognizer] {
    var handlers: [UIGestureRecognizer] = []
    var current = view
    while let view = current {
      for recognizer in view.gestureRecognizers ?? []
      where NSStringFromClass(type(of: recognizer)) == "RCTSurfaceTouchHandler" {
        handlers.append(recognizer)
      }
      current = view.superview
    }
    return handlers
  }

  private func detachSurfaceTouchHandlers(from touches: Set<UITouch>, for event: UIEvent) {
    guard let window = view as? UIWindow, Self.isShowingMenu(in: window) else {
      return
    }
    for touch in touches {
      for handler in Self.surfaceTouchHandlers(above: touch.view) {
        handler.ignore(touch, for: event)
      }
    }
  }

  // UIKit asks the delegate about an event before delivering its touches to any recognizer.
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
    if let touches = event.allTouches {
      detachSurfaceTouchHandlers(from: touches.filter { $0.phase == .began }, for: event)
    }
    return true
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesBegan(touches, with: event)
    // Second chance, should React Native's handler have received the touch before the delegate ran.
    detachSurfaceTouchHandlers(from: touches, for: event)
    state = .failed
  }
}
