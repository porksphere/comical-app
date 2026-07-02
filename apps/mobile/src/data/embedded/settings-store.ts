/**
 * AsyncStorage-backed `SettingsStore` — the on-device analog of the server's file-backed
 * per-bridge settings. One JSON blob per bridge under a namespaced key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SettingValue } from '@comical/contract';
import type { SettingsStore } from './types';

const keyFor = (id: string): string => `comical:embedded:settings:${id}`;

export const asyncStorageSettings: SettingsStore = {
  async get(id) {
    const raw = await AsyncStorage.getItem(keyFor(id));
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, SettingValue>;
    } catch {
      return {};
    }
  },
  async set(id, values) {
    await AsyncStorage.setItem(keyFor(id), JSON.stringify(values));
  },
};
