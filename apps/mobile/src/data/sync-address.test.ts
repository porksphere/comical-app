import { describe, expect, test } from 'bun:test';

import { parseSyncAddress } from './sync-address';

describe('parseSyncAddress', () => {
  test('splits what the desktop shows into the server and the pairing code', () => {
    expect(parseSyncAddress('http://10.0.0.5:3130/abcdefghjkmn')).toEqual({
      url: 'http://10.0.0.5:3130',
      code: 'abcdefghjkmn',
    });
  });

  test('a path that could not be a code is the server\'s own', () => {
    // Twelve characters, but `l`, `o` and `1` are never in a code.
    expect(parseSyncAddress('http://10.0.0.5:3130/hello1worlds')).toEqual({ url: 'http://10.0.0.5:3130/hello1worlds' });
    expect(parseSyncAddress('http://10.0.0.5:3130/abcdefghjkm')).toEqual({ url: 'http://10.0.0.5:3130/abcdefghjkm' });
  });

  test('takes a plain server with no code, and drops a trailing slash', () => {
    expect(parseSyncAddress('http://10.0.0.5:3100/')).toEqual({ url: 'http://10.0.0.5:3100' });
    expect(parseSyncAddress(' https://comical.example/api/ \n')).toEqual({ url: 'https://comical.example/api' });
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
