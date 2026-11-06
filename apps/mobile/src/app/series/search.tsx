// The series page's twin of /search, for the tag/author/type chips (and the removed page's
// "find elsewhere"): registered inside the modal's own stack (see _layout.tsx here) so it pushes
// as a real card over the series page, with the system bar's search field and the native chevron
// back. Routed here by useOpenSeriesSearch (lib/series-nav) on iOS; elsewhere the search opens
// as an in-screen layer on index.tsx instead.
export { default } from '../search';
