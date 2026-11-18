// Хранилище на устройстве: AsyncStorage (на телефоне — файл приложения, в браузере — localStorage).
// Ни одна функция не бросает ошибку: при сбое чтения возвращается значение по умолчанию.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import type { KV } from './sync-core';

// При сборке веб-версии страницы рендерятся в Node, где браузерного хранилища нет
const canUse = () => Platform.OS !== 'web' || typeof window !== 'undefined';

export async function getItem(key: string): Promise<string | null> {
  if (!canUse()) return null;
  try { return await AsyncStorage.getItem(key); } catch { return null; }
}

export async function setItem(key: string, value: string): Promise<boolean> {
  if (!canUse()) return false;
  try { await AsyncStorage.setItem(key, value); return true; } catch { return false; }
}

export async function removeItem(key: string): Promise<boolean> {
  if (!canUse()) return false;
  try { await AsyncStorage.removeItem(key); return true; } catch { return false; }
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const s = await getItem(key);
  if (s == null) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function setJSON(key: string, value: unknown): Promise<boolean> {
  try { return await setItem(key, JSON.stringify(value)); } catch { return false; }
}

// То же в виде объекта «ключ → строка» для ядра синхронизации
export const kv: KV = {
  getItem,
  setItem: async (k, v) => { await setItem(k, v); },
  removeItem: async k => { await removeItem(k); },
};
