/**
 * Web has no on-device JS engine for bridges, so the embedded runtime is never installed — the app
 * stays on the remote transport. This no-op keeps `_layout.tsx`'s unconditional
 * `startEmbeddedRuntime()` call platform-agnostic and keeps `@comical/*` out of the web bundle.
 */
export function startEmbeddedRuntime(): void {
  // intentionally empty
}
