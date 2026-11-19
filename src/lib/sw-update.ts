// Работа без сети в веб-версии: регистрация service worker (public/sw.js → dist/sw.js) и «Есть обновление».
// Только веб и только сборка для сайта (`npm run web:export`). В разработке (__DEV__) SW не ставим,
// а оставшийся от сборки на этом адресе — снимаем, чтобы он не подсовывал старые файлы.
// На телефоне всегда одна версия целиком (страницы и код из кэша service worker). Новая версия скачивается
// сама и не включается сама: бригадир видит «Есть обновление» и нажимает, когда ему удобно
// (или она включится при следующем полном открытии «Формана»).
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

const BASE = `${process.env.EXPO_BASE_URL ?? ''}/`; // '/fixpro-sklad-app/forman/' (app.json → baseUrl)
const SW_URL = `${BASE}sw.js`;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const RELOAD_DELAY_MS = 1200;

export type UpdateState = 'none' | 'ready';

let state: UpdateState = 'none';
let reg: ServiceWorkerRegistration | null = null;
let started = false;
let requested = false;
const listeners = new Set<() => void>();

function setState(s: UpdateState) {
  state = s;
  listeners.forEach(l => l());
}

const supported = () =>
  Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export function startServiceWorker(): void {
  if (started || !supported()) return;
  started = true;
  const sw = navigator.serviceWorker;

  if (__DEV__) {
    sw.getRegistrations()
      .then(rs => rs.forEach(r => { if (new URL(r.scope).pathname === BASE) void r.unregister(); }))
      .catch(() => undefined);
    return;
  }

  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (requested) { window.location.reload(); return; }
    // Первая установка — не обновление. Смена версии из другой вкладки: в этой вкладке старый код, его файлов
    // в новом кэше нет (переход на другую вкладку дал бы белый экран), и старый код не должен писать данные
    // поверх новой версии — перезагружаемся. Через секунду: успеет сохраниться последняя правка (0,7 с).
    if (controlled) {
      setState('none');
      setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    }
    controlled = true;
  });

  const register = async () => {
    try {
      reg = await sw.register(SW_URL, { scope: BASE, updateViaCache: 'none' });
      watch(reg);
    } catch {
      // без SW приложение работает как раньше, только без открытия без сети
    }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

function watch(r: ServiceWorkerRegistration) {
  const sw = navigator.serviceWorker;
  if (r.waiting && sw.controller) setState('ready');
  r.addEventListener('updatefound', () => {
    const next = r.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      if (next.state === 'installed' && sw.controller) setState('ready');
    });
  });
  // Проверка новой версии: при возврате в приложение и раз в 30 минут (с экрана «Домой» его не закрывают неделями)
  let last = Date.now();
  const check = () => {
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    r.update().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, CHECK_EVERY_MS);
}

// Нажали «Есть обновление»: новая версия включается, страница перезагружается (данные на телефоне не трогаются)
export function applyUpdate(): void {
  requested = true;
  const waiting = reg?.waiting;
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
  setTimeout(() => window.location.reload(), 4000); // страховка, если браузер не сообщил о смене
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state, () => 'none');
}
