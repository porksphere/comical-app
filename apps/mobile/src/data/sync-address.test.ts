import { describe, expect, test } from 'bun:test';

import { parseSyncAddress } from './sync-address';

describe('parseSyncAddress', () => {
  test('takes the address the desktop shows, as it shows it', () => {
    expect(parseSyncAddress('http://10.0.0.5:3130/abcdefghjkmn')).toBe('http://10.0.0.5:3130/abcdefghjkmn');
  });

  test('takes a plain server too, and drops a trailing slash either way', () => {
    expect(parseSyncAddress('http://10.0.0.5:3100/')).toBe('http://10.0.0.5:3100');
    expect(parseSyncAddress(' https://comical.example/key/ \n')).toBe('https://comical.example/key');
  });

  test('refuses what is not a server address', () => {
    for (const text of [
      '',
      'hello',
      'WIFI:S:home;T:WPA;P:pw;;',
      'ftp://10.0.0.5/key',
      'http://10.0.0.5:3130/key/deeper',
      'http://10.0.0.5:3130/key?x=1',
      'http://10.0.0.5:3130/key#frag',
      'http://user:pw@10.0.0.5:3130/key',
    ]) {
      expect(parseSyncAddress(text)).toBeNull();
    }
  });
});
