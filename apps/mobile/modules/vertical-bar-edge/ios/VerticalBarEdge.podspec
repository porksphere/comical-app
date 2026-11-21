Pod::Spec.new do |s|
  s.name           = 'VerticalBarEdge'
  s.version        = '0.1.0'
  s.summary        = 'Reports the edge UIKit stands its bars on as a column'
  s.description    = 'Expo native view that reports its trait collection\'s verticalBarEdge (iOS 27.1) and each change to it.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
