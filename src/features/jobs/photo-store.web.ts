// Фото объекта в браузере: выбор с камеры или из галереи (обычный <input type=file>),
// сжатие до 1600 px (JPEG), миниатюра 360 px, хранение в IndexedDB ЭТОГО браузера на ЭТОМ телефоне.
// Никуда не отправляется. Ошибки не бросаются наружу — возвращается понятная причина.
import { newId, type JobPhoto, type PhotoKind } from './jobs-model';

export type PickSource = 'camera' | 'gallery';
export type PickResult = { ok: true; photos: JobPhoto[]; skipped: number } | { ok: false; reason: string };

export const PHOTOS_SUPPORTED = typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
export const PHOTO_WHERE = 'Фото хранятся только в этом браузере на этом телефоне. В другом браузере или на другом телефоне их не будет.';

const DB = 'forman-photos';
const STORE = 'blobs';
const FULL = 1600;
const THUMB = 360;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req ? (req.result as T) : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

// Выбор файлов: input создаётся и «нажимается» сразу в обработчике нажатия (иначе Safari не откроет окно)
function chooseFiles(source: PickSource): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.setAttribute('capture', 'environment');
    else input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-1000px';
    input.setAttribute('data-testid', `photo-input-${source}`);
    let done = false;
    const finish = (files: File[]) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function toJpeg(img: HTMLImageElement, max: number, q: number): Promise<{ blob: Blob; w: number; h: number }> {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas'));
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve({ blob: b, w, h }) : reject(new Error('blob'))), 'image/jpeg', q));
}

export async function pickPhotos(source: PickSource, kind: PhotoKind): Promise<PickResult> {
  if (!PHOTOS_SUPPORTED) return { ok: false, reason: 'Этот браузер не умеет хранить фото. Откройте ссылку в Safari или Chrome.' };
  const files = await chooseFiles(source); // до первого await — ничего, чтобы окно выбора открылось
  if (!files.length) return { ok: true, photos: [], skipped: 0 };
  const photos: JobPhoto[] = [];
  let skipped = 0;
  for (const f of files) {
    try {
      const img = await loadImage(f);
      const full = await toJpeg(img, FULL, 0.82);
      const thumb = await toJpeg(img, THUMB, 0.75);
      const now = new Date();
      const id = newId('ph', now);
      await tx('readwrite', s => { s.put(full.blob, `${id}:full`); s.put(thumb.blob, `${id}:thumb`); });
      photos.push({ id, kind, addedAt: now.toISOString(), w: full.w, h: full.h, bytes: full.blob.size, name: f.name || (kind === 'order' ? 'скрин заказа' : 'фото') });
    } catch {
      skipped++;
    }
  }
  if (!photos.length) return { ok: false, reason: 'Не удалось прочитать файл. Если это HEIC с компьютера — выберите JPG/PNG или снимите заново с телефона.' };
  return { ok: true, photos, skipped };
}

const urls = new Map<string, string>();

export async function photoUrl(id: string, size: 'thumb' | 'full'): Promise<string | null> {
  const key = `${id}:${size}`;
  const have = urls.get(key);
  if (have) return have;
  try {
    const b = await tx<Blob>('readonly', s => s.get(key));
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(key, u);
    return u;
  } catch {
    return null;
  }
}

export async function deletePhotos(ids: string[]): Promise<void> {
  if (!ids.length || !PHOTOS_SUPPORTED) return;
  try {
    await tx('readwrite', s => { for (const id of ids) { s.delete(`${id}:full`); s.delete(`${id}:thumb`); } });
  } catch { /* не удалилось — останется мусор в хранилище, экран не ломаем */ }
  for (const id of ids) for (const k of [`${id}:full`, `${id}:thumb`]) {
    const u = urls.get(k);
    if (u) { URL.revokeObjectURL(u); urls.delete(k); }
  }
}

export async function storageInfo(): Promise<{ usedMB: number; quotaMB: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || !e.quota) return null;
    return { usedMB: (e.usage ?? 0) / 1048576, quotaMB: e.quota / 1048576 };
  } catch {
    return null;
  }
}

// ---------- Отправка отчёта с фото (Web Share) ----------
// Двухшаговая схема: «Подготовить» читает фото из IndexedDB, «Отправить» вызывает navigator.share
// сразу в нажатии (Safari требует «свежее» действие пользователя).
export async function photoFiles(photos: JobPhoto[]): Promise<File[]> {
  const out: File[] = [];
  for (const [k, p] of photos.entries()) {
    try {
      const b = await tx<Blob>('readonly', s => s.get(`${p.id}:full`));
      if (b) out.push(new File([b], `${p.kind === 'order' ? 'zakaz' : 'foto'}-${String(k + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
    } catch { /* пропускаем фото, которого нет */ }
  }
  return out;
}

export function canShareFiles(files: File[]): boolean {
  try { return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files }); } catch { return false; }
}

export async function shareFiles(files: File[], title: string, text: string): Promise<'ok' | 'cancel' | 'fail'> {
  try {
    await navigator.share({ files, title, text });
    return 'ok';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancel' : 'fail';
  }
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ---------- Сохранность ----------
// Просим браузер не стирать данные сам (Safari иначе может очистить сайт через 7 дней без захода)
export async function requestPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

// Встроенный браузер мессенджера: у него своё хранилище, данные «потеряются» при переходе в Safari
export function inAppBrowser(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Line\//i.test(ua)) return 'LINE';
  return null;
}
