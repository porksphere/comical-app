Pod::Spec.new do |s|
  s.name           = 'NavBarLargeTitle'
  s.version        = '0.1.0'
  s.summary        = 'Puts a screen\'s large navigation title on the bar\'s own row'
  s.description    = 'Expo native view that sets the owning screen\'s large title display mode (inline: the large title on the bar\'s row beside its items, never collapsing) and keeps it set as the header config is reapplied.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
