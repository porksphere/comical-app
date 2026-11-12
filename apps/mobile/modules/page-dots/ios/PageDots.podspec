Pod::Spec.new do |s|
  s.name           = 'PageDots'
  s.version        = '0.1.0'
  s.summary        = 'The system page control'
  s.description    = 'Expo native view over UIPageControl: the row of dots that says which of several pages is showing, and takes a tap or a scrub to change it.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
