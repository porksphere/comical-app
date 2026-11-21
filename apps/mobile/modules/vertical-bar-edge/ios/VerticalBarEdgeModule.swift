import ExpoModulesCore
import UIKit

public class VerticalBarEdgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VerticalBarEdge")

    View(VerticalBarEdgeView.self) {
      Events("onEdge")
    }
  }
}

final class VerticalBarEdgeView: ExpoView {
  let onEdge = EventDispatcher()

  private var reported: String?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    report()
  }

  // The deprecated callback on purpose: it runs for every trait, where registering for this one
  // needs its trait type, which the SDK's documentation doesn't name.
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    report()
  }

  private func report() {
    guard window != nil, #available(iOS 27.1, tvOS 27.1, *) else {
      return
    }
    let edge: String
    switch traitCollection.verticalBarEdge {
    case .leading: edge = "leading"
    case .trailing: edge = "trailing"
    default: edge = "unspecified"
    }
    guard edge != reported else {
      return
    }
    reported = edge
    onEdge(["edge": edge])
  }
}
