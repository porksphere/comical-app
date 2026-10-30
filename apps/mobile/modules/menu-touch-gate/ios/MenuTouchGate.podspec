Pod::Spec.new do |s|
  s.name           = 'MenuTouchGate'
  s.version        = '0.1.0'
  s.summary        = 'Keeps the tap that closes a system menu from pressing the React Native view under it'
  s.description    = 'Expo app-delegate subscriber installing a window-level gesture recognizer that has React Native ignore touches while a UIKit menu is open.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
