/**
 * `menu-touch-gate` — native only, nothing to import. An app-delegate subscriber puts a gesture
 * recognizer on each window that has React Native ignore the tap closing a system menu (a
 * navigation bar item's, or `menu-anchor`'s), so the view under that tap is not pressed too.
 * UIKit on iOS 26 hit-tests that tap through the menu's container to the view beneath; native
 * responders are suppressed but gesture recognizers are not, and React Native's touch handler
 * is one. Expo's own gate (expo-modules-core) is installed only by its SwiftUI host view, which
 * these UIKit menus never mount.
 */
export {};
