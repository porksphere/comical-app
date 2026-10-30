Pod::Spec.new do |s|
  s.name           = 'ShapedImage'
  s.version        = '0.1.0'
  s.summary        = 'Clips a PNG to a rounded square or circle'
  s.description    = 'Expo native module baking a corner radius into a bitmap for images UIKit draws as plain UIImages.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ShapedImageModule.swift'
  s.swift_version = '5.9'
end
