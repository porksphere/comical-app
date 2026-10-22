import type { SettingDescriptor } from '@/data/api';

/** A field whose stored value the server never sends back — only whether one is set. */
export function isSecretSetting(d: SettingDescriptor): boolean {
  return (d.type === 'string' && d.secret === true) || d.type === 'oauth-pin' || d.type === 'oauth-callback' || d.type === 'web-login';
}
