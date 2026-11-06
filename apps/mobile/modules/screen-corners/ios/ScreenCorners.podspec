Pod::Spec.new do |s|
  s.name           = 'ScreenCorners'
  s.version        = '0.1.0'
  s.summary        = 'Reports the corner radii of the app window'
  s.description    = 'Expo native module reading the window corners the system resolves for the display, per corner.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ScreenCornersModule.swift'
  s.swift_version = '5.9'
end
