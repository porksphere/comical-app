// LOCAL STUB of the business-logic core.
//
// The real @porksphere/core lives in its own repository and is published to
// GitHub Packages. This stub exists only so the app's import path, Metro
// resolution, and CI wiring can be exercised end-to-end before the real core
// ships. Replace by depending on the published package (see /.npmrc).

export const CORE_VERSION = '0.0.0-stub';

export function greet(name: string): string {
  return `Hello, ${name}! — from @porksphere/core@${CORE_VERSION}`;
}
