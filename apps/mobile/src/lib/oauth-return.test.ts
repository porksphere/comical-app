import { describe, expect, test } from 'bun:test';

import { awaitOAuthReturn, deliverOAuthReturn, isOAuthReturnRoute, parseOAuthReturn } from './oauth-return';

describe('parseOAuthReturn', () => {
  test('reads a code exchange out of the query', () => {
    expect(parseOAuthReturn('comical://oauth-callback?code=abc%2Bdef&state=native%3Aff00')).toEqual({
      code: 'abc+def',
      state: 'native:ff00',
    });
  });

  test('reads an implicit grant out of the fragment', () => {
    expect(parseOAuthReturn('/oauth-token#access_token=tok&token_type=Bearer&state=native')).toEqual({
      token: 'tok',
      state: 'native',
    });
  });

  test('prefers a description over the error code, in either shape', () => {
    expect(parseOAuthReturn('/oauth-callback?error=access_denied&error_description=denied%20it').error).toBe('denied it');
    expect(parseOAuthReturn('/oauth-token#error=access_denied&message=The+user+denied').error).toBe('The user denied');
    expect(parseOAuthReturn('/oauth-callback?error=access_denied').error).toBe('access_denied');
  });

  test('survives a malformed escape', () => {
    expect(parseOAuthReturn('/oauth-callback?code=%E0%A4%A&state=s')).toEqual({ code: '%E0%A4%A', state: 's' });
  });
});

describe('deliverOAuthReturn', () => {
  test('hands the return to the waiter', async () => {
    const pending = awaitOAuthReturn();
    expect(deliverOAuthReturn('/oauth-callback?code=c&state=native%3A1')).toBe(true);
    expect(await pending).toEqual({ code: 'c', state: 'native:1' });
  });

  test('consumes a return nobody is waiting for', () => {
    expect(deliverOAuthReturn('/oauth-token#access_token=t')).toBe(true);
  });

  test('leaves other routes alone', () => {
    expect(deliverOAuthReturn('/add-registry?url=x')).toBe(false);
    expect(isOAuthReturnRoute('/oauth-tokens')).toBe(false);
    expect(isOAuthReturnRoute('/oauth-token')).toBe(true);
  });

  test('accepts the trailing slash Windows adds to a scheme link', async () => {
    expect(isOAuthReturnRoute('/oauth-callback/?code=c')).toBe(true);
    expect(isOAuthReturnRoute('/oauth-token/#access_token=t')).toBe(true);
    const pending = awaitOAuthReturn();
    deliverOAuthReturn('/oauth-token/#access_token=t&state=native');
    expect(await pending).toEqual({ token: 't', state: 'native' });
  });

  test('a newer sign-in replaces the older waiter', async () => {
    const first = awaitOAuthReturn();
    const second = awaitOAuthReturn();
    expect(await first).toBeNull();
    deliverOAuthReturn('/oauth-callback?code=c&state=s');
    expect(await second).toEqual({ code: 'c', state: 's' });
  });
});
