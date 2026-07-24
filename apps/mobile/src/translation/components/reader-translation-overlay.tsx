import { useReaderSettings } from '@/hooks/use-reader-settings';
import { isTranslationSupported } from '@/translation';
import { TranslationOverlay } from './translation-overlay';

/**
 * The reader-facing gate around TranslationOverlay: renders nothing unless the feature is
 * supported on this build (native module linked) AND the reader's "Live translate" toggle is
 * on. Keeping the gate here lets the three reader insertion points (paged page, webtoon paged
 * row, webtoon continuous row) stay one-line unconditional siblings of <ReaderPage>.
 */
export function ReaderTranslationOverlay(props: {
  pageKey: string;
  width: number;
  height: number;
  fit: 'contain' | 'width';
}) {
  const [{ liveTranslate }] = useReaderSettings();
  if (!liveTranslate || !isTranslationSupported()) return null;
  return <TranslationOverlay {...props} />;
}
