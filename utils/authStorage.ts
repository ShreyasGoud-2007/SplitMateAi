import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

function getWebStorage(): Storage {
  if (typeof localStorage === 'undefined') {
    throw new Error('Browser storage is not available for Supabase authentication.');
  }
  return localStorage;
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return getWebStorage().getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      getWebStorage().setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      getWebStorage().removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
