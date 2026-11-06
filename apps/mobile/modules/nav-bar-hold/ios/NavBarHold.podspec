Pod::Spec.new do |s|
  s.name           = 'NavBarHold'
  s.version        = '0.2.0'
  s.summary        = 'Reports a press held on a screen\'s large navigation title'
  s.description    = 'Expo native view that reads the navigation bar\'s touches and reports a press that begins on the screen\'s large title and its end, for a hold gesture on a title that is UIKit\'s own text.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
