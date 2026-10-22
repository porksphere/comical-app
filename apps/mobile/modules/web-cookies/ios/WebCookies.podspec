Pod::Spec.new do |s|
  s.name           = 'WebCookies'
  s.version        = '0.1.0'
  s.summary        = 'Reads the cookies the app web views hold'
  s.description    = 'Expo native module reading and clearing WKWebView cookies for in-app sign-in.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'WebCookiesModule.swift'
  s.swift_version = '5.9'
end
