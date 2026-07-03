/**
 * Web has no on-device JS engine for bridges, so the embedded runtime is never installed — the app
 * stays on the remote transport. These no-ops keep `_layout.tsx`'s `startEmbeddedRuntime()` call and
 * the Settings registry manager platform-agnostic, and keep `@comical/*` out of the web bundle.
 */
export function startEmbeddedRuntime(): void {
  // intentionally empty
}

export function addEmbeddedRegistry(_url: string): void {
  // intentionally empty — web is always remote
}

export function removeEmbeddedRegistry(_url: string): void {
  // intentionally empty — web is always remote
}
