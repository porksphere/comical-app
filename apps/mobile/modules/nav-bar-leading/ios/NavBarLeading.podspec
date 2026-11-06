Pod::Spec.new do |s|
  s.name           = 'NavBarLeading'
  s.version        = '0.2.0'
  s.summary        = 'Owns a screen\'s leading navigation bar item: its picture, its name and its menu'
  s.description    = 'Expo native view that keeps the picture, accessibility label and menu of a screen\'s leading navigation bar item, setting them on the item in place whenever they change and whenever the item is rebuilt.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
