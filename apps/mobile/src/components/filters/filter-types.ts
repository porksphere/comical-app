// Reusable filter definitions + value helpers. These are data-only so the same
// filters can be declared once and rendered anywhere (e.g. a search page, a
// per-source config, etc.).

export type TriValue = 'include' | 'exclude';
export type TriState = Record<string, TriValue>;

export type FilterDef =
  | { id: string; label: string; type: 'string'; placeholder?: string }
  | { id: string; label: string; type: 'number'; min: number; max: number; step?: number; default?: number; unit?: string }
  | { id: string; label: string; type: 'multi'; options: string[]; selectAllByDefault?: boolean }
  | { id: string; label: string; type: 'includeExclude'; options: string[] }
  | { id: string; label: string; type: 'tags'; options: string[] };

export type FilterValue = string | number | string[] | TriState;

/** The initial value for a filter (supports multi-select that starts fully selected). */
export function initialValue(def: FilterDef): FilterValue {
  switch (def.type) {
    case 'string':
      return '';
    case 'number':
      return def.default ?? def.min;
    case 'multi':
      return def.selectAllByDefault ? [...def.options] : [];
    case 'includeExclude':
    case 'tags':
      return {};
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
    case 'number': {
      const n = value as number;
      return n != null ? [{ key: 'n', label: `${n}${def.unit ?? ''}`, tone: 'neutral' }] : [];
    }
    case 'multi': {
      const arr = (value as string[]) ?? [];
      return arr.map((o) => ({ key: o, label: o, tone: 'neutral' as ChipTone }));
    }
    case 'includeExclude':
    case 'tags': {
      const tri = (value as TriState) ?? {};
      const inc = Object.keys(tri).filter((k) => tri[k] === 'include');
      const exc = Object.keys(tri).filter((k) => tri[k] === 'exclude');
      return [
        ...inc.map((o) => ({ key: `+${o}`, label: o, tone: 'include' as ChipTone })),
        ...exc.map((o) => ({ key: `-${o}`, label: o, tone: 'exclude' as ChipTone })),
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
