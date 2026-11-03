Pod::Spec.new do |s|
  s.name           = 'NavBarFade'
  s.version        = '0.1.0'
  s.summary        = 'Crossfades a screen\'s navigation bar when its title or material changes'
  s.description    = 'Expo native view that watches its screen\'s navigation item and adds a Core Animation fade to the navigation bar whenever the title or the background material changes.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
