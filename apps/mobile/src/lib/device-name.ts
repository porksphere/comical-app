import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/** The device this is running on — its user-assigned name where the OS exposes one, else the model.
 *  Empty on web, where neither is available (`Device.deviceName` is hard-null there). */
export function deviceLabel(): string {
  return Constants.deviceName || Device.modelName || '';
}

/** What this device calls itself to a sync hub: the label above, or the platform when there is none —
 *  the hub lists it, and a blank row says nothing. */
export function syncDeviceName(): string {
  return deviceLabel() || (Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Browser');
}
