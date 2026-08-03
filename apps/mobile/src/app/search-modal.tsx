// EXPERIMENTAL series-reader companion route: the SAME Search screen, registered a second time
// with a modal-compatible presentation. `/series-reader` is a contained transparent modal, and
// react-native-screens can't push a plain card ON TOP of a transparent modal (the new screen
// lands underneath / presents as a sheet) — so navigations out of the series-reader's details
// (tag chips, author/artist/type meta cells) target THIS route instead: another contained
// transparent modal (opaque content, slide-in animation), which stacks correctly and looks like
// the ordinary pushed Search page. Remove with the experiment — see app/series-reader.tsx.
export { default } from './search';
