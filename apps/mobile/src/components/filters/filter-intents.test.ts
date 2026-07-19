import { describe, expect, test } from 'bun:test';

import { resolveMetaIntent, resolveTagIntent } from './filter-intents';
import type { FilterDef } from './filter-types';

const tagsDef: FilterDef = { id: 'genres', label: 'Genres', type: 'tags' };
const authorStr: FilterDef = { id: 'author', label: 'Author', type: 'string' };
const typeMulti: FilterDef = {
  id: 'type',
  label: 'Type',
  type: 'multi',
  options: [
    { value: 'manga', label: 'Manga' },
    { value: 'manhwa', label: 'Manhwa' },
  ],
};

describe('resolveTagIntent', () => {
  test('matching tag filter → value + label hint', () => {
    expect(resolveTagIntent([tagsDef], { filterKey: 'genres', tagId: 't1', label: 'Action' })).toEqual({
      defId: 'genres',
      labelHint: { t1: 'Action' },
      value: { t1: 'include' },
    });
  });

  test('bridge lacks the tag filter → null (intent dropped)', () => {
    expect(resolveTagIntent([authorStr], { filterKey: 'genres', tagId: 't1', label: 'Action' })).toBeNull();
  });

  test('id matches but the field is not a selectable filter → null', () => {
    const notTags: FilterDef = { id: 'genres', label: 'Genres', type: 'string' };
    expect(resolveTagIntent([notTags], { filterKey: 'genres', tagId: 't1', label: 'Action' })).toBeNull();
  });

  test('genre → a plain multi filter → single-element array value', () => {
    const genreMulti: FilterDef = {
      id: 'genre',
      label: 'Genres',
      type: 'multi',
      options: [{ value: '39', label: 'Action' }],
    };
    expect(resolveTagIntent([genreMulti], { filterKey: 'genre', tagId: '39', label: 'Action' })).toEqual({
      defId: 'genre',
      labelHint: { '39': 'Action' },
      value: ['39'],
    });
  });

  test('genre → an excludable (includeExclude) filter → tri-state include', () => {
    const genreExcl: FilterDef = {
      id: 'genre',
      label: 'Genres',
      type: 'includeExclude',
      options: [{ value: '39', label: 'Action' }],
    };
    expect(resolveTagIntent([genreExcl], { filterKey: 'genre', tagId: '39', label: 'Action' })).toEqual({
      defId: 'genre',
      labelHint: { '39': 'Action' },
      value: { '39': 'include' },
    });
  });
});

describe('resolveMetaIntent', () => {
  test('string field → sets the field verbatim', () => {
    expect(resolveMetaIntent([authorStr], { metaKey: 'author', value: 'Oda' })).toEqual({
      kind: 'filter',
      defId: 'author',
      value: 'Oda',
    });
  });

  test('multi field, matching option (case-insensitive) → single-element array', () => {
    expect(resolveMetaIntent([typeMulti], { metaKey: 'type', value: 'manhwa' })).toEqual({
      kind: 'filter',
      defId: 'type',
      value: ['manhwa'],
    });
  });

  test('alias match (Type meta → a "format" field) works', () => {
    const formatMulti: FilterDef = {
      id: 'format',
      label: 'Format',
      type: 'multi',
      options: [{ value: 'manga', label: 'Manga' }],
    };
    expect(resolveMetaIntent([formatMulti], { metaKey: 'type', value: 'Manga' })).toEqual({
      kind: 'filter',
      defId: 'format',
      value: ['manga'],
    });
  });

  test('include/exclude or tags field → tri-state include', () => {
    const authorTags: FilterDef = { id: 'author', label: 'Author', type: 'tags', options: [{ value: 'a1', label: 'Oda' }] };
    expect(resolveMetaIntent([authorTags], { metaKey: 'author', value: 'oda' })).toEqual({
      kind: 'filter',
      defId: 'author',
      value: { a1: 'include' },
    });
  });

  test('field found but no matching option → fall back to query', () => {
    expect(resolveMetaIntent([typeMulti], { metaKey: 'type', value: 'Nonexistent' })).toEqual({
      kind: 'query',
      query: 'Nonexistent',
    });
  });

  test('no matching field at all → fall back to query', () => {
    expect(resolveMetaIntent([tagsDef], { metaKey: 'author', value: 'Oda' })).toEqual({
      kind: 'query',
      query: 'Oda',
    });
  });
});
