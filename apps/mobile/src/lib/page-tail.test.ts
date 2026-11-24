import { describe, expect, test } from 'bun:test';

import { pageTail } from './page-tail';

describe('pageTail', () => {
  test('a host route shows the target inside it, without the target’s query', () => {
    const route = `/bridges/b/image?url=${encodeURIComponent('https://cdn.example/series/047/012.jpg?token=abc')}`;
    expect(pageTail(route)).toBe('https://cdn.example/series/047/012.jpg');
  });

  test('a long URL keeps its end, where one page differs from the next', () => {
    const tail = pageTail('https://cdn.example/a/very/long/path/that/goes/on/and/on/series/047/012.jpg');
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.endsWith('/047/012.jpg')).toBe(true);
  });

  test('a data URI is its type and size, never its bytes', () => {
    expect(pageTail(`data:image/jpeg;base64,${'A'.repeat(500)}`)).toBe('data:image/jpeg (523 chars)');
  });

  test('a route with no URL inside it is shown as written', () => {
    expect(pageTail('/bridges/b/page-image/s/c/7')).toBe('/bridges/b/page-image/s/c/7');
  });
});
