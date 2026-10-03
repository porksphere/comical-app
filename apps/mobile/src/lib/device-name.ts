import { use$ } from '@legendapp/state/react';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { persisted$ } from '@/lib/observable';

/** The device this is running on — its user-assigned name where the OS exposes one, else the model.
 *  Empty on web, where neither is available (`Device.deviceName` is hard-null there).
 *
 *  iOS 16+ hands a generic "iPhone"/"iPad" to any app without Apple's user-assigned-device-name
 *  entitlement, which a sideloaded build can't carry — so that answer is treated as no answer and
 *  the model name stands in for it. */
export function deviceLabel(): string {
  const assigned = Constants.deviceName || '';
  const generic = Platform.OS === 'ios' && (assigned === 'iPhone' || assigned === 'iPad');
  return (generic ? '' : assigned) || Device.modelName || '';
}

const chosenName$ = persisted$('comical:sync:deviceName', '');

/** What this device calls itself to a sync hub when the user hasn't said: the label above, or the
 *  platform when there is none — the hub lists it, and a blank row says nothing. */
export function defaultSyncDeviceName(): string {
  return deviceLabel() || (Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Browser');
}

/** What this device calls itself to a sync hub: the user's choice, else the default. */
export function syncDeviceName(): string {
  return chosenName$.peek().trim() || defaultSyncDeviceName();
}

/** The user's own name for this device, '' while they haven't set one. */
export function useChosenSyncDeviceName(): [string, (name: string) => void] {
  return [use$(chosenName$), setChosenSyncDeviceName];
}

function setChosenSyncDeviceName(name: string): void {
  chosenName$.set(name);
}
