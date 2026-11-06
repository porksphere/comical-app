import ExpoModulesCore

final class UndecodableImageException: Exception {
  override var reason: String { "The image file could not be decoded" }
}

final class UnencodableImageException: Exception {
  override var reason: String { "The clipped image could not be encoded as PNG" }
}

public class ShapedImageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShapedImage")

    // UIKit draws a navigation bar item's or a menu row's image as the plain UIImage it is handed,
    // past any view modifier, so the only corner such a picture can have is one in its pixels.
    // `radius` is in points of the image as drawn at `scale`; half the side makes a circle.
    AsyncFunction("clip") { (uri: URL, radius: Double, scale: Double) throws -> String in
      let data = try Data(contentsOf: uri)
      guard let image = UIImage(data: data, scale: CGFloat(scale)) else {
        throw UndecodableImageException()
      }
      let bounds = CGRect(origin: .zero, size: image.size)
      let format = UIGraphicsImageRendererFormat()
      format.scale = image.scale
      format.opaque = false
      let shaped = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
        let corner = min(CGFloat(radius), min(bounds.width, bounds.height) / 2)
        UIBezierPath(roundedRect: bounds, cornerRadius: corner).addClip()
        image.draw(in: bounds)
      }
      guard let png = shaped.pngData() else {
        throw UnencodableImageException()
      }
      let out = uri.deletingPathExtension().appendingPathExtension("r\(Int(radius.rounded())).png")
      try png.write(to: out, options: .atomic)
      return out.absoluteString
    }
  }
}
