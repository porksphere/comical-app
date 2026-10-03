import { describe, expect, test } from 'bun:test';

import { displaySyncAddress, parseSyncAddress } from './sync-address';

describe('parseSyncAddress', () => {
  test('splits the code the desktop shows into the server and the secret', () => {
    expect(parseSyncAddress('http://10.0.0.5:3130/abcdefghjkmn')).toEqual({
      url: 'http://10.0.0.5:3130',
      secret: 'abcdefghjkmn',
    });
  });

  test('takes a plain server with no secret, and drops a trailing slash', () => {
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

describe('displaySyncAddress', () => {
  test('hides the key', () => {
    expect(displaySyncAddress('http://10.0.0.5:3130/abcdefghjkmn')).toBe('http://10.0.0.5:3130/••••');
  });

  test('leaves a server without one alone', () => {
    for (const address of ['http://localhost:3100', 'https://comical.example/api', 'not a url']) {
      expect(displaySyncAddress(address)).toBe(address);
    }
  });
});
