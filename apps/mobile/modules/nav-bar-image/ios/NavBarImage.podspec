Pod::Spec.new do |s|
  s.name           = 'NavBarImage'
  s.version        = '0.1.0'
  s.summary        = 'Keeps a navigation bar item\'s picture in place across pushes and pops'
  s.description    = 'Expo native view that sets a decoded image on a screen\'s leading navigation bar item whenever the item is rebuilt.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
