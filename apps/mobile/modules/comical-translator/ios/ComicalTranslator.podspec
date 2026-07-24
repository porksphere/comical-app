Pod::Spec.new do |s|
  s.name           = 'ComicalTranslator'
  s.version        = '0.1.0'
  s.summary        = 'On-device OCR + translation backend for the live translator'
  s.description    = 'Expo native module: image decode to RGBA, Vision OCR, Apple Translation (iOS 18+).'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Vision / Translation / SwiftUI are system frameworks; Translation usage is gated
  # @available(iOS 18, *) at runtime so the deployment target stays 15.1.
  s.source_files = '*.swift'
  s.swift_version = '5.9'
end
