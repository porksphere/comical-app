Pod::Spec.new do |s|
  s.name           = 'NavBarScroll'
  s.version        = '0.2.0'
  s.summary        = 'Names the scroll view a screen\'s navigation bar follows'
  s.description    = 'Expo native view handing a screen\'s view controller the scroll view UIKit should read its navigation bar\'s scroll edge from.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
