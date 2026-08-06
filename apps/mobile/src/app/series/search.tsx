// The series page's twin of /search, registered inside the modal's own stack (see _layout.tsx
// here) so it pushes as a real card over the series page — with UIKit's own edge-pop, which the
// in-screen search LAYER cannot have.
//
// Only reachable while the `nativeSearchStack` experiment is on; see lib/experimental.ts for what
// the experiment is for and what to compare. Delete both together.
export { default } from '../search';
