Pod::Spec.new do |s|
  s.name           = 'SystemContextMenu'
  s.version        = '0.1.0'
  s.summary        = 'The system context menu on a view React Native draws'
  s.description    = 'Expo native view that puts a UIContextMenuInteraction on its content: the held view lifts, and the menu is built on demand from rows the app supplies while it opens, updating in place as they change.'
  s.author         = 'porksphere'
  s.homepage       = 'https://github.com/porksphere/comical-app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
