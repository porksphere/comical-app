Pod::Spec.new do |s|
  s.name           = 'NavBarEdge'
  s.version        = '0.1.0'
  s.summary        = 'Reports how far a screen\'s navigation bar has slid away'
  s.description    = 'Expo native view that follows its screen\'s navigation bar on screen and reports how far its bottom edge sits above where it rests, as iOS bar minimization slides it away and back.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
