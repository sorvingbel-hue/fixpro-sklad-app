// Отметки чек-листа: сначала на устройство, затем (если команда подключена) — в общую базу.
// Коллекция library_progress (в базе: fm_library_progress), документ «<устройство>__<сценарий>».
// Так у каждого телефона свой чек-лист по каждому сценарию, а бригадир позже сможет видеть все.
import { getItem, setItem } from '@/lib/storage';
import { getDoc, listDocs, saveDoc, type SaveResult } from '@/lib/sync';

export const PROGRESS_COL = 'library_progress';
const K_DEVICE = 'fm.library.device';

export type Progress = {
  deviceId: string;
  scenarioId: string;
  done: string[];      // ключи отмеченных пунктов (см. checklist.ts)
  updatedAt: string;   // ISO-время последней отметки
};

// Постоянный номер этого устройства (создаётся один раз и хранится на устройстве)
let devicePromise: Promise<string> | null = null;
export function getDeviceId(): Promise<string> {
  if (!devicePromise) {
    devicePromise = (async () => {
      const saved = await getItem(K_DEVICE);
      if (saved) return saved;
      const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await setItem(K_DEVICE, id);
      return id;
    })();
  }
  return devicePromise;
}

export const progressDocId = (deviceId: string, scenarioId: string) => deviceId + '__' + scenarioId;

// Отметки этого устройства по одному сценарию
export async function loadProgress(scenarioId: string): Promise<string[]> {
  const device = await getDeviceId();
  const doc = await getDoc<Progress>(PROGRESS_COL, progressDocId(device, scenarioId));
  return Array.isArray(doc?.done) ? doc.done.filter(k => typeof k === 'string') : [];
}

export async function saveProgress(scenarioId: string, done: string[]): Promise<SaveResult> {
  const device = await getDeviceId();
  const data: Progress = { deviceId: device, scenarioId, done, updatedAt: new Date().toISOString() };
  return saveDoc(PROGRESS_COL, progressDocId(device, scenarioId), data);
}

// Все отметки этого устройства: сценарий → ключи (для списка сценариев)
export async function loadAllProgress(): Promise<Record<string, string[]>> {
  const device = await getDeviceId();
  const docs = await listDocs<Progress>(PROGRESS_COL);
  const out: Record<string, string[]> = {};
  for (const d of docs) {
    if (d.data.deviceId !== device || typeof d.data.scenarioId !== 'string') continue;
    if (Array.isArray(d.data.done)) out[d.data.scenarioId] = d.data.done;
  }
  return out;
}
