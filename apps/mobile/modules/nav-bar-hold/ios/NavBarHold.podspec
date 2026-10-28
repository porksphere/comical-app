Pod::Spec.new do |s|
  s.name           = 'NavBarHold'
  s.version        = '0.1.0'
  s.summary        = 'Reports a press held on a screen\'s large navigation title'
  s.description    = 'Expo native view that reads a hold on the large title band of the navigation bar of the screen it sits in and reports its beginning and end.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
