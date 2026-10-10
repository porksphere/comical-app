import { describe, expect, test } from 'bun:test';

import { shortError } from './friendly-error';

describe('shortError', () => {
  test('keeps a short message as it is', () => {
    expect(shortError(new Error('bridge "x" not found'))).toBe('bridge "x" not found');
  });

  test('takes the first non-empty line, collapsed, without a leading Error:', () => {
    expect(shortError(new Error('\nError:  getSeries   threw: boom\n    at foo (bar.js:1)'))).toBe('getSeries threw: boom');
  });

  test('cuts a long message with an ellipsis, inside the limit', () => {
    const out = shortError(new Error('a'.repeat(200)), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });

  test('a file path keeps only its last segment, a URL is left alone', () => {
    expect(shortError(new Error('bridge "x" not found in C:\\Users\\me\\AppData\\app\\bridges'))).toBe(
      'bridge "x" not found in …\\bridges',
    );
    expect(shortError(new Error('cannot read /home/me/.local/share/app/library.db'))).toBe(
      'cannot read …/library.db',
    );
    expect(shortError(new Error('fetch https://example.com/a/b failed'))).toBe('fetch https://example.com/a/b failed');
  });

  test('a non-Error or an empty message still says something', () => {
    expect(shortError('plain')).toBe('plain');
    expect(shortError(new Error('   '))).toBe('Request failed');
    expect(shortError(undefined)).toBe('Request failed');
  });
});
