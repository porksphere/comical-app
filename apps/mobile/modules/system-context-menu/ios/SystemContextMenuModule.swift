import ExpoModulesCore

/// One row of a menu, or a submenu or inline section when it has `children`.
struct MenuNode: Decodable {
  let id: String?
  let title: String
  let subtitle: String?
  let symbol: String?
  let destructive: Bool?
  let disabled: Bool?
  let on: Bool?
  let keepsOpen: Bool?
  let inline: Bool?
  let children: [MenuNode]?
}

public class SystemContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SystemContextMenu")

    Function("setMenu") { (token: Int, json: String) in
      DispatchQueue.main.async {
        SystemContextMenuView.setMenu(token: token, json: json)
      }
    }

    View(SystemContextMenuView.self) {
      Events("onMenuRequest", "onMenuAction", "onMenuClose", "onPreviewPress")

      Prop("enabled") { (view: SystemContextMenuView, enabled: Bool?) in
        view.enabled = enabled ?? true
      }
      Prop("title") { (view: SystemContextMenuView, title: String?) in
        view.title = title ?? ""
      }
      Prop("previewRadius") { (view: SystemContextMenuView, radius: Double?) in
        view.previewRadius = CGFloat(radius ?? 0)
      }
      Prop("previewBackground") { (view: SystemContextMenuView, color: UIColor?) in
        view.previewBackground = color
      }
    }

    View(SystemContextMenuTargetView.self) {
      Prop("radius") { (view: SystemContextMenuTargetView, radius: Double?) in
        view.radius = radius.map { CGFloat($0) }
      }
    }
  }
}

/// The system context menu over the React Native content inside it. Holding the content lifts it
/// (or the `SystemContextMenuTargetView` inside it: a cover rather than the whole card) and opens
/// a menu whose rows are asked for only then. `onMenuRequest` hands JS a token, JS answers with
/// `setMenu`, and every later answer under the same token updates the open menu in place, so rows
/// waiting on a query fill in while it is up. The rows exist for one open at a time, never once
/// per card in a grid. Until the first answer the menu holds a deferred element, which UIKit draws
/// as its loading row; the lift usually outlasts the wait.
final class SystemContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  private static let rootIdentifier = UIMenu.Identifier("comical.system-context-menu.root")
  private static var lastToken = 0
  private static weak var active: SystemContextMenuView?

  let onMenuRequest = EventDispatcher()
  let onMenuAction = EventDispatcher()
  let onMenuClose = EventDispatcher()
  let onPreviewPress = EventDispatcher()

  var enabled = true
  var title = ""
  var previewRadius: CGFloat = 0
  var previewBackground: UIColor?

  private var token = 0
  private var nodes: [MenuNode]?
  private var pending: (([UIMenuElement]) -> Void)?
  private var shown = false
  /// Rows arrived after the menu was built and before it was on screen.
  private var stale = false
  private var interaction: UIContextMenuInteraction?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let interaction = UIContextMenuInteraction(delegate: self)
    addInteraction(interaction)
    self.interaction = interaction
  }

  static func setMenu(token: Int, json: String) {
    guard let view = active, view.token == token,
          let data = json.data(using: .utf8),
          let nodes = try? JSONDecoder().decode([MenuNode].self, from: data) else {
      return
    }
    view.apply(nodes)
  }

  private func apply(_ nodes: [MenuNode]) {
    self.nodes = nodes
    if let pending {
      self.pending = nil
      pending(elements(nodes))
    } else if shown {
      refresh()
    } else {
      stale = true
    }
  }

  /// The menu on screen may be a submenu the user opened, so it is rebuilt from the node with its
  /// identifier rather than from the root.
  private func refresh() {
    guard let nodes else {
      return
    }
    interaction?.updateVisibleMenu { [weak self] visible in
      guard let self else {
        return visible
      }
      if visible.identifier == Self.rootIdentifier {
        return visible.replacingChildren(self.elements(nodes))
      }
      guard let node = Self.node(visible.identifier.rawValue, in: nodes) else {
        return visible
      }
      return visible.replacingChildren(self.elements(node.children ?? []))
    }
  }

  private func rootMenu() -> UIMenu {
    stale = false
    let children: [UIMenuElement]
    if let nodes {
      children = elements(nodes)
    } else {
      children = [UIDeferredMenuElement { [weak self] completion in
        guard let self else {
          return completion([])
        }
        if let nodes = self.nodes {
          completion(self.elements(nodes))
        } else {
          self.pending = completion
        }
      }]
    }
    return UIMenu(title: title, identifier: Self.rootIdentifier, children: children)
  }

  private func elements(_ nodes: [MenuNode]) -> [UIMenuElement] {
    nodes.map(element)
  }

  private func element(_ node: MenuNode) -> UIMenuElement {
    let image = node.symbol.flatMap { UIImage(systemName: $0) }
    if let children = node.children {
      let inline = node.inline == true
      return UIMenu(
        title: inline ? "" : node.title,
        image: image,
        identifier: node.id.map { UIMenu.Identifier($0) },
        options: inline ? .displayInline : [],
        children: elements(children)
      )
    }
    var attributes: UIMenuElement.Attributes = []
    if node.destructive == true {
      attributes.insert(.destructive)
    }
    if node.disabled == true {
      attributes.insert(.disabled)
    }
    if node.keepsOpen == true {
      attributes.insert(.keepsMenuPresented)
    }
    let token = self.token
    let id = node.id ?? ""
    let action = UIAction(title: node.title, image: image, attributes: attributes, state: node.on == true ? .on : .off) {
      [weak self] _ in
      self?.onMenuAction(["token": token, "id": id])
    }
    action.subtitle = node.subtitle
    return action
  }

  private static func node(_ id: String, in nodes: [MenuNode]) -> MenuNode? {
    for node in nodes {
      if node.id == id {
        return node
      }
      if let found = node.children.flatMap({ Self.node(id, in: $0) }) {
        return found
      }
    }
    return nil
  }

  // MARK: - UIContextMenuInteractionDelegate

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard enabled else {
      return nil
    }
    cancelReactNativeTouches()
    Self.lastToken += 1
    token = Self.lastToken
    nodes = nil
    pending = nil
    shown = false
    stale = false
    Self.active = self
    onMenuRequest(["token": token])
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      self?.rootMenu()
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    highlightPreviewForItemWithIdentifier identifier: any NSCopying
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    dismissalPreviewForItemWithIdentifier identifier: any NSCopying
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    shown = true
    if stale {
      stale = false
      refresh()
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    let token = self.token
    shown = false
    pending = nil
    guard let animator else {
      onMenuClose(["token": token])
      return
    }
    animator.addCompletion { [weak self] in
      self?.onMenuClose(["token": token])
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willPerformPreviewActionForMenuWith configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionCommitAnimating
  ) {
    let token = self.token
    animator.preferredCommitStyle = .dismiss
    animator.addCompletion { [weak self] in
      self?.onPreviewPress(["token": token])
    }
  }

  /// What lifts: the marked view inside, else the whole content, clipped to its corners.
  private func targetedPreview() -> UITargetedPreview? {
    let target = Self.target(in: self) ?? self
    guard target.window != nil, !target.bounds.isEmpty else {
      return nil
    }
    let parameters = UIPreviewParameters()
    let radius = (target as? SystemContextMenuTargetView)?.radius ?? previewRadius
    parameters.visiblePath = UIBezierPath(roundedRect: target.bounds, cornerRadius: radius)
    parameters.backgroundColor = previewBackground ?? .clear
    return UITargetedPreview(view: target, parameters: parameters)
  }

  private static func target(in view: UIView) -> SystemContextMenuTargetView? {
    for subview in view.subviews {
      if let target = subview as? SystemContextMenuTargetView ?? Self.target(in: subview) {
        return target
      }
    }
    return nil
  }

  // A press released before the menu fully presents is still recognized as a tap by React
  // Native, so in-flight touches on the nearest surface are cancelled when the interaction
  // starts: what expo-router's link preview does, for the reason it gives. `reset` is left out
  // on purpose: the press is still active and UIKit delivers touchesCancelled after this returns,
  // and resetting first desyncs the touch registry.
  private func cancelReactNativeTouches() {
    guard let touchHandlerClass = NSClassFromString("RCTSurfaceTouchHandler") else {
      return
    }
    var view: UIView? = self
    while let current = view {
      if let recognizer = current.gestureRecognizers?.first(where: { $0.isKind(of: touchHandlerClass) }) {
        if recognizer.isEnabled {
          recognizer.isEnabled = false
          recognizer.isEnabled = true
        }
        return
      }
      view = current.superview
    }
  }
}

/// Marks the part of a `SystemContextMenuView`'s content that lifts when it is held: a card's
/// cover, not the card with its title under it.
final class SystemContextMenuTargetView: ExpoView {
  var radius: CGFloat?
}
