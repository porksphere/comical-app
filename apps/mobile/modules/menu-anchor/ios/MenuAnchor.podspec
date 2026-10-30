Pod::Spec.new do |s|
  s.name           = 'MenuAnchor'
  s.version        = '0.1.0'
  s.summary        = 'A system popup menu of checkmarked options over a React Native row'
  s.description    = 'Expo native view holding an invisible UIButton whose primary action is a UIMenu of selectable options with sharp, pre-shaped pictures.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
