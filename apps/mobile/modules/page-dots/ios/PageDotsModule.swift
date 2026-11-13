import ExpoModulesCore
import UIKit

public class PageDotsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PageDots")

    View(PageDotsView.self) {
      Events("onPage")
      Prop("count") { (view: PageDotsView, count: Int?) in
        view.control.numberOfPages = max(0, count ?? 0)
      }
      Prop("page") { (view: PageDotsView, page: Int?) in
        view.control.currentPage = page ?? 0
      }
    }
  }
}

/// UIKit's own dots, so a tap either side of them and a scrub along them are the system's.
final class PageDotsView: ExpoView {
  let control = UIPageControl()
  let onPage = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // The control's own colours are white on nothing, made for a photo behind it: on a page they
    // are the label colours, which follow the window's light or dark as the bars do.
    control.currentPageIndicatorTintColor = .label
    control.pageIndicatorTintColor = .tertiaryLabel
    control.hidesForSinglePage = true
    control.backgroundStyle = .minimal
    control.allowsContinuousInteraction = true
    control.addTarget(self, action: #selector(changed), for: .valueChanged)
    addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = bounds
  }

  @objc private func changed() {
    onPage(["page": control.currentPage])
  }
}
