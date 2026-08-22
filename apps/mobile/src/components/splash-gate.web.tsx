/**
 * Web has no OS splash to hold, so the gate is a no-op here — matching the
 * native sibling's signature without pulling `expo-splash-screen` (whose
 * prevent/hide calls have nothing to act on in a browser) into the web bundle.
 */
export function SplashGate() {
  return null;
}
