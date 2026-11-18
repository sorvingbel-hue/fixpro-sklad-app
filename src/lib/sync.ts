// Синхронизация для приложения: один общий клиент на всё приложение.
// Логика — в ./sync-core.ts (её же проверяет tests/sync.test.mjs на настоящей базе).
//
// Как пользоваться в экранах:
//   const status = useSyncStatus();                 // статус для строки «Синхронизировано / Нет связи…»
//   await saveDoc('notes', 'shift', { text });       // сохранить (сначала на устройство, потом в базу)
//   const doc = await getDoc('notes', 'shift');      // прочитать
//   const list = await listDocs('notes');            // список
// Ни одна функция не бросает ошибку в UI.
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { kv } from './storage';
import { createSyncClient, parseTeamCode, type DocData, type SyncStatus } from './sync-core';

export { parseTeamCode };
export type { ConnectResult, Doc, DocData, SaveResult, SyncState, SyncStatus } from './sync-core';

// Адрес и публичный ключ базы берутся из .env при сборке (EXPO_PUBLIC_*)
const client = createSyncClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_KEY,
  storage: kv,
  colPrefix: 'fm_', // коллекции «Формана» в базе: fm_<имя>, отдельно от коллекций «Склада»
});

const RETRY_MS = 30_000;
let started = false;

// Запуск при старте приложения (вызывается один раз из корневого _layout):
// загрузить команду, отправить накопленное, повторять при возврате в приложение и раз в 30 с.
export function startSync(): void {
  if (started) return;
  started = true;
  void (async () => {
    await client.init();
    // Веб: ссылка вида …/#s=<команда>&k=<код> сразу подключает команду.
    // Код из адреса уже убран скриптом в src/app/+html.tsx и лежит в sessionStorage.
    const link = takeTeamLink();
    if (link) await client.connectTeam(link.space, link.code);
    if (await client.ping()) await client.pushPending();
  })();
  AppState.addEventListener('change', s => { if (s === 'active') void retry(); });
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', () => void retry());
  setInterval(() => {
    const st = client.getStatus().state;
    if (st === 'pending' || st === 'offline' || st === 'error') void retry();
  }, RETRY_MS);
}

function takeTeamLink() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const h = window.sessionStorage.getItem('fm.link');
    if (!h) return null;
    window.sessionStorage.removeItem('fm.link');
    return parseTeamCode(h);
  } catch { return null; }
}

async function retry() {
  if (!client.getStatus().team) return;
  if (await client.ping()) await client.pushPending();
}

export const connectTeam = (space: string, code: string) => client.connectTeam(space, code);
export const disconnectTeam = () => client.disconnectTeam();
export const saveDoc = (col: string, id: string, data: DocData) => client.saveDoc(col, id, data);
export const getDoc = <T extends DocData = DocData>(col: string, id: string) => client.getDoc<T>(col, id);
export const listDocs = <T extends DocData = DocData>(col: string) => client.listDocs<T>(col);
export const deleteDoc = (col: string, id: string) => client.deleteDoc(col, id);
export const pushPending = () => client.pushPending();
export const getSyncStatus = (): SyncStatus => client.getStatus();
export const subscribeSync = (fn: (s: SyncStatus) => void) => client.subscribe(fn);
export const isSyncConfigured = () => client.isConfigured();
export const teamFragment = () => client.teamFragment();

// React-хук: текущий статус синхронизации, экран перерисуется при изменении
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(client.subscribe, client.getStatus, client.getStatus);
}
