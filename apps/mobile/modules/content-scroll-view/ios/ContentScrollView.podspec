Pod::Spec.new do |s|
  s.name           = 'ContentScrollView'
  s.version        = '0.1.0'
  s.summary        = 'Names the list a screen\'s navigation bar follows'
  s.description    = 'Expo native view that tells the view controller holding it which scroll view is its content, through UIViewController.setContentScrollView.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
