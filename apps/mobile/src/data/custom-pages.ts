/**
 * User-composed pages for the synthetic "Comical" aggregate bridge. Each page is an ordered list of
 * SECTIONS, and each section pins one bridge's list rendered as a rail or a grid. This is
 * user-authored *content* (not a copy of anything the server owns), so it lives in Legend State —
 * persisted, device-local (see AGENTS.md → State). Server data (each list's items + live name) is
 * still fetched through Query at render time (see `use-custom-page-rows.ts`).
 *
 * A section's `name` is OPTIONAL: when `null` the title is resolved dynamically from the live bridge
 * list metadata at render time, so a bridge renaming a list re-titles the section automatically with
 * no migration. A non-null `name` is the user's explicit override.
 *
 * Writes REPLACE the whole array (a new root reference) so `use$` subscribers on every screen — the
 * editor, the settings count, and the Comical home — re-render. A nested `store$[i]...set()` can
 * leave the root snapshot's identity unchanged and defeat a reader's `useMemo` (the same rule
 * `comical-home.ts` documents).
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** How a custom section is rendered. App-local — NOT the bridge list's own `layout`
 *  (`carousel|grid|ranked|hero`); a `rail` is a horizontal strip, a `grid` an infinite-scroll block. */
export type CustomLayout = 'rail' | 'grid';

export type CustomSection = {
  id: string;
  /** `null` → inherit the live bridge-list name at render time; a string is the user's override. */
  name: string | null;
  bridgeId: string;
  listId: string;
  layout: CustomLayout;
};

export type CustomPage = {
  id: string;
  name: string;
  sections: CustomSection[];
};

const customPages$ = persisted$<CustomPage[]>('comical:customPages', []);

/** Short, collision-resistant local id (not a real UUID — these never leave the device). */
function localId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Reactive list of all custom pages, in user order. */
export function useCustomPages(): CustomPage[] {
  return use$(customPages$);
}

/** Reactive single page by id (undefined if it was deleted / never existed). */
export function useCustomPage(id: string | undefined): CustomPage | undefined {
  const pages = use$(customPages$);
  return id ? pages.find((p) => p.id === id) : undefined;
}

// ─── Page mutators (whole-array replace) ────────────────────────────────────────

/** Append a new empty page; returns its id so the caller can navigate into it. */
export function addPage(name: string): string {
  const page: CustomPage = { id: localId(), name: name.trim() || 'Untitled', sections: [] };
  customPages$.set([...customPages$.peek(), page]);
  return page.id;
}

export function renamePage(pageId: string, name: string): void {
  customPages$.set(customPages$.peek().map((p) => (p.id === pageId ? { ...p, name: name.trim() || p.name } : p)));
}

export function deletePage(pageId: string): void {
  customPages$.set(customPages$.peek().filter((p) => p.id !== pageId));
}

/** Reorder the pages to match a new id order (keys the ReorderableList emits). Unknown ids are
 *  ignored; any page missing from `orderedIds` keeps its relative position at the end. */
export function reorderPages(orderedIds: string[]): void {
  customPages$.set(reorderBy(customPages$.peek(), orderedIds, (p) => p.id));
}

// ─── Section mutators (whole-array replace) ─────────────────────────────────────

export function addSection(pageId: string, section: Omit<CustomSection, 'id'>): void {
  const withId: CustomSection = { ...section, id: localId() };
  customPages$.set(
    customPages$.peek().map((p) => (p.id === pageId ? { ...p, sections: [...p.sections, withId] } : p)),
  );
}

export function updateSection(pageId: string, sectionId: string, patch: Partial<Omit<CustomSection, 'id'>>): void {
  customPages$.set(
    customPages$.peek().map((p) =>
      p.id === pageId
        ? { ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) }
        : p,
    ),
  );
}

export function deleteSection(pageId: string, sectionId: string): void {
  customPages$.set(
    customPages$.peek().map((p) =>
      p.id === pageId ? { ...p, sections: p.sections.filter((s) => s.id !== sectionId) } : p,
    ),
  );
}

export function reorderSections(pageId: string, orderedIds: string[]): void {
  customPages$.set(
    customPages$.peek().map((p) =>
      p.id === pageId ? { ...p, sections: reorderBy(p.sections, orderedIds, (s) => s.id) } : p,
    ),
  );
}

/** Sort `items` to match `orderedIds`; ranked items first in that order, the rest keep their
 *  original order at the end. Mirrors `list-order.ts`'s `applyOrder`, but for owned records the
 *  order lives inline in the array (not a separate id list), so this rewrites it directly. */
function reorderBy<T>(items: T[], orderedIds: string[], idOf: (item: T) => string): T[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
      if (a.r !== undefined) return -1;
      if (b.r !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.item);
}
