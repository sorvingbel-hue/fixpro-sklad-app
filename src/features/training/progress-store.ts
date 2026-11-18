// Прогресс тренажёра. Главная копия — на устройстве (свой ключ хранилища).
// Копия уходит в базу команды через общую синхронизацию (src/lib/sync.ts):
// коллекция forman_training_progress (в базе с префиксом: fm_forman_training_progress),
// документ = случайный номер устройства. Имён и личных данных нет.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { getItem, setItem, setJSON } from '@/lib/storage';
import { getSyncStatus, saveDoc, useSyncStatus } from '@/lib/sync';

import type { Lesson } from './content';
import { countFirst, countPassed, countPractice, initialProgress, isValidProgress, type Progress } from './logic';

export const PROGRESS_COL = 'forman_training_progress';
const K_PROGRESS = 'fm.training.closet01';
const K_DEVICE = 'fm.training.device';
const K_PUSHED = 'fm.training.pushed'; // «команда|время версии», которая уже лежит в базе

export type SaveState = 'restored' | 'formatChanged' | 'storageOff' | 'savedLocal' | 'savedTeam' | 'saveFail';

// ---------- номер устройства (случайный, хранится на устройстве) ----------
let cachedDevice: string | null = null;
function randomHex(len: number): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(len / 2);
    c.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  let s = '';
  while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
export async function getDeviceId(): Promise<string> {
  if (cachedDevice) return cachedDevice;
  const have = await getItem(K_DEVICE);
  cachedDevice = have || 'dev-' + randomHex(16);
  if (!have) await setItem(K_DEVICE, cachedDevice);
  return cachedDevice;
}

// Что отправляется в базу: только прогресс, без имён
function toDoc(p: Progress, total: number) {
  return {
    schema: p.schema,
    scenario: 'closet-01',
    index: p.index,
    answers: p.answers,
    passed: p.passed,
    first: p.first,
    tries: p.tries,
    practice: p.practice,
    done: countPassed(p),
    firstTry: countFirst(p),
    practiceDone: countPractice(p),
    total,
    platform: Platform.OS,
    updatedAt: p.updatedAt,
  };
}

// Отправить копию в базу (через общую очередь синхронизации). true — уже в базе команды
async function pushProgress(p: Progress, total: number): Promise<boolean> {
  const id = await getDeviceId();
  const r = await saveDoc(PROGRESS_COL, id, toDoc(p, total));
  const team = getSyncStatus().team?.space;
  if (r.synced && team) await setItem(K_PUSHED, team + '|' + p.updatedAt);
  return r.synced;
}

export function useTrainingProgress(lessons: Lesson[]) {
  const n = lessons.length;
  const [progress, setProgress] = useState<Progress>(() => initialProgress(n));
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const team = useSyncStatus().team?.space ?? null;
  const latest = useRef(progress);
  const seq = useRef(0);

  // Загрузка с устройства
  useEffect(() => {
    let alive = true;
    void (async () => {
      const raw = await getItem(K_PROGRESS);
      let next = initialProgress(n);
      let st: SaveState | null = null;
      if (raw) {
        try {
          const cand: unknown = JSON.parse(raw);
          if (isValidProgress(cand, lessons)) { next = cand; st = 'restored'; } else st = 'formatChanged';
        } catch { st = 'formatChanged'; }
      } else if (!(await setItem(K_PROGRESS + '.probe', '1'))) {
        st = 'storageOff';
      }
      if (!alive) return;
      latest.current = next;
      setProgress(next);
      setSaveState(st);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [n, lessons]);

  // Подключили команду (или открыли приложение с командой) — отправить текущую версию, если её там ещё нет
  useEffect(() => {
    if (!loaded || !team) return;
    const p = latest.current;
    if (!p.updatedAt) return;
    void (async () => {
      if ((await getItem(K_PUSHED)) !== team + '|' + p.updatedAt) await pushProgress(p, n);
    })();
  }, [loaded, team, n]);

  // Сохранить: сразу на экран и на устройство, затем копия в базу
  const save = useCallback(async (next: Progress) => {
    latest.current = next;
    setProgress(next);
    const my = ++seq.current;
    const ok = await setJSON(K_PROGRESS, next);
    if (my === seq.current) setSaveState(ok ? 'savedLocal' : 'saveFail');
    const synced = await pushProgress(next, n);
    if (ok && synced && my === seq.current) setSaveState('savedTeam');
  }, [n]);

  return { progress, loaded, saveState, save };
}
