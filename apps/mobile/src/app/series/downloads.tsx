// The series page's twin of /downloads — the same screen, registered inside the modal's own
// stack (see _layout.tsx here) so it pushes as a real page over the series page. Routed here
// rather than to the root route by useSeriesSubPath.
export { default } from '../downloads';
