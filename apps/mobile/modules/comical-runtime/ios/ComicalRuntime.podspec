Pod::Spec.new do |s|
  s.name           = 'ComicalRuntime'
  s.version        = '0.1.0'
  s.summary        = 'On-device Comical bridge runtime (JavaScriptCore)'
  s.description    = 'Expo native module running Comical bridge bundles in JSC via ComicalHostIOS.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The shared iOS host (ComicalHostIOS: ComicalBridgeContext etc.) + generated harness.js are copied
  # into ./generated/ from the comical submodule by the `with-comical-ios-sources` config plugin
  # during prebuild (CocoaPods can't include source_files outside the pod dir). See that plugin.
  s.source_files = 'ComicalRuntimeModule.swift', 'generated/**/*.swift'
  s.resources    = ['generated/Resources/harness.js']
  s.swift_version = '5.9'
end
