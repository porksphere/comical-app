// Reusable filter definitions + value helpers. These are data-only so the same
// filters can be declared once and rendered anywhere (e.g. a search page, a
// per-source config, etc.).

import { Spacing } from '@/constants/theme';
import type { ApiFilter } from '@/data/api';

// Shared layout knobs so every control on the filter bar — filters, the Sort
// pill, and the overflow chip — reads as one family (same height + corner
// radius). Tune here to resize the whole row at once.
export const CONTROL_HEIGHT = 44;
export const CONTROL_RADIUS = Spacing.three;

export type TriValue = 'include' | 'exclude';
export type TriState = Record<string, TriValue>;

/** An option's `value` (sent to the API, used as the selection key) can differ
 *  from its `label` (shown to the user) — e.g. a bridge's genre filter may use
 *  opaque numeric ids as values with human-readable names as labels. */
export type Option = { value: string; label: string };

export type FilterDef =
  | { id: string; label: string; type: 'string'; placeholder?: string }
  | { id: string; label: string; type: 'toggle' }
  | { id: string; label: string; type: 'number'; min: number; max: number; step?: number; default?: number; unit?: string }
  /** `single: true` renders as a one-at-a-time picker (maps a contract `select` filter). */
  | { id: string; label: string; type: 'multi'; options: Option[]; selectAllByDefault?: boolean; single?: boolean }
  | { id: string; label: string; type: 'includeExclude'; options: Option[] }
  /** Static tag list when `options` is given; otherwise `search` drives a live async lookup
   *  (maps a contract `tag-multiselect` filter, whose tags come from `GET /bridges/:id/tags`). */
  | { id: string; label: string; type: 'tags'; options?: Option[]; search?: (query: string) => Promise<Option[]> };

export type FilterValue = string | number | boolean | string[] | TriState;

/** Look up an option's display label by value; falls back to the value itself
 *  (e.g. for a `tags` search result whose value/label happen to be the same). */
export function labelFor(options: Option[] | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

/** The initial value for a filter (supports multi-select that starts fully selected). */
export function initialValue(def: FilterDef): FilterValue {
  switch (def.type) {
    case 'string':
      return '';
    case 'toggle':
      return false;
    case 'number':
      return def.default ?? def.min;
    case 'multi':
      return def.selectAllByDefault ? def.options.map((o) => o.value) : [];
    case 'includeExclude':
    case 'tags':
      return {};
  }
}

/** Adapt a bridge-advertised `@comical/contract` filter into this UI's `FilterDef`. */
export function filterDefFromApi(f: ApiFilter): FilterDef {
  switch (f.type) {
    case 'text':
      return { id: f.key, label: f.label, type: 'string' };
    case 'toggle':
      return { id: f.key, label: f.label, type: 'toggle' };
    case 'number':
      return { id: f.key, label: f.label, type: 'number', min: f.min ?? 0, max: f.max ?? 9999 };
    case 'select':
      return { id: f.key, label: f.label, type: 'multi', options: f.options, single: true };
    case 'multiselect':
      return f.excludable
        ? { id: f.key, label: f.label, type: 'includeExclude', options: f.options }
        : { id: f.key, label: f.label, type: 'multi', options: f.options, selectAllByDefault: f.defaultAll };
    case 'tag-multiselect':
      // Populated by the caller with a live `GET /bridges/:id/tags?q=` search — see index.tsx.
      return { id: f.key, label: f.label, type: 'tags' };
  }
}

/**
 * Convert this UI's `FilterValue` back into the `@comical/contract` shape for a
 * query — `null` when the value is still at its untouched `initialValue`, so an
 * unset filter never counts as "active" (that's what drops Browse into results
 * mode — see `index.tsx`'s `hasActiveQuery`). A `number` filter's initial value
 * is its `default`/`min`, not empty, so it needs an explicit comparison rather
 * than a truthiness check; same for a `multi` filter that starts fully selected
 * (`selectAllByDefault`) — its initial value is a full, non-empty array.
 */
export function filterValueToApi(def: FilterDef, value: FilterValue): { key: string; value: unknown } | null {
  switch (def.type) {
    case 'string': {
      const s = value as string;
      return s ? { key: def.id, value: s } : null;
    }
    case 'toggle':
      return value ? { key: def.id, value: true } : null;
    case 'number': {
      const n = value as number;
      return n === initialValue(def) ? null : { key: def.id, value: n };
    }
    case 'multi': {
      const arr = (value as string[]) ?? [];
      const initial = initialValue(def) as string[];
      const atInitial = arr.length === initial.length && arr.every((v) => initial.includes(v));
      if (!arr.length || atInitial) return null;
      return { key: def.id, value: def.single ? arr[0] : arr };
    }
    case 'includeExclude':
    case 'tags': {
      const tri = (value as TriState) ?? {};
      const include = Object.keys(tri).filter((k) => tri[k] === 'include');
      const exclude = Object.keys(tri).filter((k) => tri[k] === 'exclude');
      if (!include.length && !exclude.length) return null;
      return { key: def.id, value: { include, exclude } };
    }
  }
}

export type ChipTone = 'include' | 'exclude' | 'neutral';
export type ChipItem = { key: string; label: string; tone: ChipTone };

/** Summarize a filter's value as chips for the trigger button. */
export function summarize(def: FilterDef, value: FilterValue): ChipItem[] {
  switch (def.type) {
    case 'string': {
      const s = (value as string) ?? '';
      return s ? [{ key: 's', label: `"${s}"`, tone: 'neutral' }] : [];
    }
    case 'toggle':
      return value ? [{ key: 't', label: 'On', tone: 'neutral' }] : [];
    case 'number': {
      const n = value as number;
      return n != null ? [{ key: 'n', label: `${n}${def.unit ?? ''}`, tone: 'neutral' }] : [];
    }
    case 'multi': {
      const arr = (value as string[]) ?? [];
      return arr.map((v) => ({ key: v, label: labelFor(def.options, v), tone: 'neutral' as ChipTone }));
    }
    case 'includeExclude':
    case 'tags': {
      const tri = (value as TriState) ?? {};
      const inc = Object.keys(tri).filter((k) => tri[k] === 'include');
      const exc = Object.keys(tri).filter((k) => tri[k] === 'exclude');
      return [
        ...inc.map((v) => ({ key: `+${v}`, label: labelFor(def.options, v), tone: 'include' as ChipTone })),
        ...exc.map((v) => ({ key: `-${v}`, label: labelFor(def.options, v), tone: 'exclude' as ChipTone })),
      ];
    }
  }
}

export function emptyText(def: FilterDef): string {
  return def.type === 'string' ? 'None' : 'Any';
}

/** Cycle a tri-state value: off → include → exclude → off. */
export function cycleTri(current: TriValue | undefined): TriValue | undefined {
  if (!current) return 'include';
  if (current === 'include') return 'exclude';
  return undefined;
}
