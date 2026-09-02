import { useKeepAwake } from 'expo-keep-awake';

/** Holds the screen awake for as long as it is mounted — rendered by the reader pane while a page
 *  is actually being read (not while the reader is parked as a decorative strip) and the setting
 *  is on. A component rather than a conditional hook call, since hooks can't be conditional. */
export function KeepScreenAwake() {
  useKeepAwake('reader');
  return null;
}
