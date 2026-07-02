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

  # Compile the shared iOS host (ComicalHostIOS: ComicalBridgeContext etc.) and bundle its generated
  # `harness.js` resource straight from the `comical` git submodule (at the comical-app repo root),
  # into this pod's module — so `ComicalBridgeContext` is available without a separate framework.
  # Path is relative to this podspec (apps/mobile/modules/comical-runtime/ios). See SETUP.md
  # (paths + `bun run build:native` to generate harness.js before xcodebuild).
  host_ios = File.join(__dir__, '..', '..', '..', '..', '..', 'external', 'comical', 'packages', 'host-ios', 'Sources', 'ComicalHostIOS')

  s.source_files = 'ComicalRuntimeModule.swift', "#{host_ios}/**/*.swift"
  s.resources    = ["#{host_ios}/Resources/harness.js"]
  s.swift_version = '5.9'
end
