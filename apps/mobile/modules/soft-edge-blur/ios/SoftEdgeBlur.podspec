Pod::Spec.new do |s|
  s.name           = 'SoftEdgeBlur'
  s.version        = '0.1.0'
  s.summary        = 'A system material blur that fades out along its height'
  s.description    = 'Expo native view holding a UIVisualEffectView masked by a gradient, shown and hidden by animating its effect.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
