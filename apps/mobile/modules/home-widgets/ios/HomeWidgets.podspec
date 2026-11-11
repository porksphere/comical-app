Pod::Spec.new do |s|
  s.name           = 'HomeWidgets'
  s.version        = '0.1.0'
  s.summary        = 'Writes the home-screen widgets their feed'
  s.description    = 'Expo native module storing the widgets feed and covers in the App Group folder and reloading the widgets.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # `generated/SharedContainer.swift` is the widget extension's own, copied in at prebuild
  # (plugins/with-widget-shared-sources.js).
  s.source_files = 'HomeWidgetsModule.swift', 'generated/*.swift'
  s.swift_version = '5.9'
end
