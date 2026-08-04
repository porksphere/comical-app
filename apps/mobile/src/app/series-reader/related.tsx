import SeriesReaderScreen from './index';

// EXPERIMENTAL series-reader DRILLED instance: the same combined page, registered as an ordinary
// opaque card in the modal's own stack — how a series opened FROM a series (related rails, nested
// search results) presents. It slides in like any pushed page and pops on the nested stack's
// native edge gesture ("drilled" disables the page's own edge-swipe recreation, which exists
// because the modal itself has no native gesture). NOT a second transparent modal: stacking two
// contained transparent modals loses the middle screen's view on iOS (see _layout.tsx here).
// Remove with the experiment.
export default function RelatedSeriesReaderScreen() {
  return <SeriesReaderScreen drilled />;
}
