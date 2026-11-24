/**
 * A trace of a chapter's page order (Settings → Developer → Trace page order), written to the
 * Diagnostics log: the list as the source gave it, what the reader put in each slot, what each
 * picture resolved to, and which page was on screen. Read together they say which of those four
 * a page out of order went wrong in. Off, none of it runs.
 */
import { useSelector } from '@legendapp/state/react';

import { logDiagnostic } from '@/lib/diagnostics';
import { persisted$ } from '@/lib/observable';
import { pageTail } from '@/lib/page-tail';
import { PROFILING_ENABLED } from '@/lib/profiling';

const trace$ = persisted$<boolean>('comical:pageOrderTrace', false);

export function usePageOrderTrace(): boolean {
  return useSelector(() => PROFILING_ENABLED && (trace$.get() ?? false));
}

export const pageOrderTrace = () => PROFILING_ENABLED && (trace$.peek() ?? false);

export function setPageOrderTrace(on: boolean): void {
  seen.clear();
  trace$.set(on);
}

const indexRun = (indexes: readonly number[]) =>
  indexes.every((v, i) => v === i) ? `0 to ${indexes.length - 1}, in order` : indexes.join(',');

/** The list a chapter's reader is handed. `indexes` are the source's own, in the order it sent the
 *  pages, when the list came from a bridge: the app sorts by them, so a list they disagree with is
 *  one the sort has rearranged. */
export function tracePageList(
  from: 'bridge' | 'device download' | 'paired computer',
  ids: { bridgeId: string; seriesId: string; chapterId: string },
  urls: readonly string[],
  indexes?: readonly number[],
): void {
  if (!pageOrderTrace()) return;
  const sent = indexes ? ` Indexes as sent: ${indexRun(indexes)}.` : '';
  logDiagnostic(
    'page-order',
    `List from the ${from}: ${urls.length} pages.${sent}\n${urls.map((u, i) => `${i}: ${pageTail(u)}`).join('\n')}`,
    { context: `bridge=${ids.bridgeId} series=${ids.seriesId} chapter=${ids.chapterId}` },
  );
}

/** The list as the reader holds it, which is the cached one when nothing was fetched. */
export function traceReaderList(urls: readonly string[], reader: string): void {
  if (!pageOrderTrace() || urls.length === 0) return;
  logDiagnostic('page-order', `Reader's list: ${urls.length} pages (${reader}).\n${urls.map((u, i) => `${i}: ${pageTail(u)}`).join('\n')}`);
}

// Once a session for each slot and picture: a pager mounts a page many times over.
const seen = new Set<string>();

/** What the reader put in slot `page`, and what it resolved to. */
export function tracePageResolved(page: number, uri: string, resolved: string): void {
  if (!pageOrderTrace()) return;
  const key = `${page}\n${uri}\n${resolved}`;
  if (seen.has(key)) return;
  seen.add(key);
  logDiagnostic('page-order', `Slot ${page}: ${pageTail(uri)} → ${resolved === uri ? 'as is' : pageTail(resolved)}`);
}

/** The page the reader says is on screen. */
export function tracePageShown(page: number, total: number, uri: string | undefined): void {
  if (!pageOrderTrace()) return;
  logDiagnostic('page-order', `On screen: ${page} of ${total}${uri ? `, ${pageTail(uri)}` : ''}`);
}
