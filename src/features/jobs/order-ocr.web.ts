// Распознавание скрина заказа В БРАУЗЕРЕ ТЕЛЕФОНА (tesseract.js 7, WebAssembly). Скрин никуда не отправляется:
// картинка берётся из IndexedDB этого браузера и распознаётся здесь же, в фоновом потоке (Web Worker).
// Файлы распознавания лежат на сайте «Формана» (public/ocr/t7 → <сайт>/fixpro-sklad-app/forman/ocr/t7/), без CDN;
// скачиваются при первом «Разобрать» и дальше берутся из кэша service worker forman-ocr-files (работает и без сети;
// если первый разбор шёл мимо service worker — keepOcrOffline просит его сохранить файлы).
// Ошибки не бросаются наружу — возвращается понятная причина; пустой результат успехом не выдаётся.
import { groupWordsToLines, type OcrLine, type OcrWord } from './order-parse';

const BASE = `${process.env.EXPO_BASE_URL ?? ''}/`; // '/fixpro-sklad-app/forman/'
export const OCR_DIR = `${BASE}ocr/t7/`;
export const OCR_SAMPLE_URL = `${BASE}ocr/primer-zakaza.png`;
export const OCR_SAMPLE_NAME = 'ПРИМЕР скрина заказа (вымышленный).png';

export const OCR_SUPPORTED = typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly === 'object';
export const OCR_WHERE = 'Распознавание идёт на телефоне, скрин никуда не отправляется.';
export const OCR_FIRST = 'При первом «Разобрать» телефон один раз скачает модуль распознавания (до 7 МБ) с сайта «Формана». Потом распознавание работает и без сети.';
export const OCR_READY = '✓ Модуль распознавания сохранён на этом телефоне — «Разобрать» работает и без сети.';
export const OCR_MANUAL = 'Позиции можно вписать вручную в «3. Сверка» (кнопка «Добавить в сверку»).';

export type OcrStage = 'load' | 'recognize';
export type OcrOutcome =
  | { ok: true; lines: OcrLine[]; words: number; ms: number; loadMs: number }
  | { ok: false; stage: OcrStage; reason: string };

const LOAD_TIMEOUT_MS = 4 * 60 * 1000;      // медленная мобильная сеть: до 7 МБ при первом разборе
const RECOGNIZE_TIMEOUT_MS = 3 * 60 * 1000;

type TesseractWorker = {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: Blob, o?: object, out?: object): Promise<{ data: { blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null } }>;
  terminate(): Promise<unknown>;
};
type TesseractLib = { createWorker(lang: string, oem: number, opts: object): Promise<TesseractWorker> };
type Logger = { status: string; progress: number };

let lib: Promise<TesseractLib> | null = null;

// tesseract.min.js — обычным <script> с сайта «Формана» (в основной код приложения не входит: грузится при первом разборе)
function loadLib(): Promise<TesseractLib> {
  if (lib) return lib;
  lib = new Promise<TesseractLib>((resolve, reject) => {
    const w = window as unknown as { Tesseract?: TesseractLib };
    if (w.Tesseract) { resolve(w.Tesseract); return; }
    const el = document.createElement('script');
    el.src = `${OCR_DIR}tesseract.min.js`;
    el.async = true;
    el.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error('lib-empty')));
    el.onerror = () => { el.remove(); reject(new Error('lib-load')); };
    document.head.appendChild(el);
  }).catch(e => { lib = null; throw e; });
  return lib;
}

// SIMD (быстрее) есть в Safari 16.4+ и Chrome; без него — обычное ядро. Проверка — как в wasm-feature-detect.
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
function corePath(): string {
  let simd = false;
  try { simd = WebAssembly.validate(SIMD_TEST); } catch { simd = false; }
  return `${OCR_DIR}${simd ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'}`;
}

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout-${what}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Мелкий текст распознаётся хуже — увеличиваем (на телефоне, canvas). Мерило — ширина: у длинного скрина
// прокруткой длинная сторона большая, а буквы мелкие (старые скрины хранились только 1600 px по длинной стороне:
// 1170×4960 → 377×1600). Проверено: такой скрин без увеличения — 5 позиций из 40, с увеличением до 1000 px — 40 из 40.
const MIN_W = 1000, MIN_LONG = 1200, MAX_UP = 3, MAX_AREA = 12e6;
export function upscaleFactor(w: number, h: number): number {
  const k = Math.min(Math.max(MIN_W / w, MIN_LONG / Math.max(w, h)), MAX_UP, Math.sqrt(MAX_AREA / (w * h)));
  return k > 1.05 ? k : 1;
}

// Готовая картинка — сразу файлом (PNG): если телефону не хватит памяти, распознаём исходную, а не ждём зависания
async function prepare(img: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(img);
    const k = upscaleFactor(bmp.width, bmp.height);
    if (k === 1) { bmp.close?.(); return img; }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    if (!ctx) { bmp.close?.(); return img; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
    c.width = 0; c.height = 0; // освободить память холста
    return out ?? img;
  } catch {
    return img;
  }
}

type Run = { worker: TesseractWorker | null; cancelled: boolean; stop: () => void; stopped: Promise<never> };
let current: Run | null = null;

// «Остановить» срабатывает сразу, даже пока модуль ещё скачивается
export function cancelOcr(): void {
  if (!current) return;
  current.cancelled = true;
  current.stop();
  void current.worker?.terminate().catch(() => undefined);
}

function newRun(): Run {
  let stop = () => undefined as void;
  const stopped = new Promise<never>((_, reject) => { stop = () => reject(new Error('cancelled')); });
  stopped.catch(() => undefined);
  return { worker: null, cancelled: false, stop, stopped };
}

function why(e: unknown, stage: OcrStage, cancelled: boolean): string {
  const m = String((e as Error)?.message ?? e ?? '');
  if (cancelled) return 'Распознавание остановлено. ' + OCR_MANUAL;
  if (stage === 'load') {
    const net = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (/timeout/.test(m)) return 'Модуль распознавания не загрузился за 4 минуты (медленная сеть?). Попробуйте ещё раз при хорошей связи. ' + OCR_MANUAL;
    if (net || /lib-load|Network|fetch|Failed to load|importScripts|NetworkError/i.test(m))
      return 'Не удалось скачать модуль распознавания с сайта «Формана»' + (net ? ' — нет сети. ' : '. ') +
        'На этом телефоне его ещё нет (или браузер его стёр). Нужна связь один раз (до 7 МБ): после удачного разбора ' +
        'со связью модуль хранится на телефоне и «Разобрать» работает без сети. ' + OCR_MANUAL;
    return `Распознавание не запустилось в этом браузере (${m.slice(0, 80) || 'ошибка'}). ` + OCR_MANUAL;
  }
  if (/timeout/.test(m)) return 'Распознавание длилось больше 3 минут и остановлено. ' + OCR_MANUAL;
  return `Распознавание упало (${m.slice(0, 80) || 'ошибка'}). ` + OCR_MANUAL;
}

// Распознать картинку на телефоне. onProgress: этап и проценты (0–100) — для «Распознаю… 40%».
export async function recognizeOrder(image: Blob, onProgress: (stage: OcrStage, pct: number) => void): Promise<OcrOutcome> {
  if (!OCR_SUPPORTED) return { ok: false, stage: 'load', reason: 'Этот браузер не умеет распознавать текст (нет WebAssembly). ' + OCR_MANUAL };
  cancelOcr();
  const run = newRun();
  current = run;
  const step = <T,>(p: Promise<T>, ms: number, what: string) => Promise.race([timeout(p, ms, what), run.stopped]);
  let stage: OcrStage = 'load';
  const t0 = performance.now();
  let t1 = t0;
  try {
    onProgress('load', 0);
    const T = await step(loadLib(), LOAD_TIMEOUT_MS, 'lib');
    if (run.cancelled) throw new Error('cancelled');
    const logger = (m: Logger) => {
      if (run.cancelled) return;
      const p = Math.max(0, Math.min(1, Number(m.progress) || 0));
      if (m.status === 'loading tesseract core') onProgress('load', Math.round(5 + p * 40));
      else if (m.status === 'initializing tesseract') onProgress('load', 48);
      else if (m.status === 'loading language traineddata') onProgress('load', Math.round(50 + p * 45));
      else if (m.status === 'initializing api') onProgress('load', 97);
      else if (m.status === 'recognizing text') onProgress('recognize', Math.round(p * 100));
    };
    const pending = T.createWorker('eng', 1, {
      workerPath: `${OCR_DIR}worker.min.js`,
      corePath: corePath(),
      langPath: OCR_DIR.replace(/\/$/, ''),
      workerBlobURL: false, // поток грузится с адреса сайта: его файлы тоже идут через кэш service worker
      cacheMethod: 'none',  // модель не копируем ещё и в IndexedDB: она уже в кэше service worker (место на телефоне)
      logger,
      errorHandler: () => undefined,
    });
    // остановили, пока поток запускался, — закрыть его, когда запустится
    pending.then(w => { if (run.cancelled) void w.terminate().catch(() => undefined); }, () => undefined);
    const worker = await step(pending, LOAD_TIMEOUT_MS, 'load');
    run.worker = worker;
    if (run.cancelled) throw new Error('cancelled');
    await step(worker.setParameters({ preserve_interword_spaces: '1' }), RECOGNIZE_TIMEOUT_MS, 'params');
    stage = 'recognize';
    t1 = performance.now();
    onProgress('recognize', 0);
    const input = await prepare(image);
    const r = await step(worker.recognize(input, {}, { text: true, blocks: true }), RECOGNIZE_TIMEOUT_MS, 'recognize');
    if (run.cancelled) throw new Error('cancelled');
    const words: OcrWord[] = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) {
      if (w && typeof w.text === 'string' && w.text.trim()) {
        words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox, symbols: (w.symbols ?? []).map(x => ({ text: x.text, confidence: x.confidence, bbox: x.bbox })) });
      }
    }
    if (!words.length) return { ok: false, stage, reason: 'На картинке не найден текст. Проверьте, что это скрин заказа (не фото) и он резкий. ' + OCR_MANUAL };
    return { ok: true, lines: groupWordsToLines(words), words: words.length, ms: performance.now() - t1, loadMs: t1 - t0 };
  } catch (e) {
    return { ok: false, stage, reason: why(e, stage, run.cancelled) };
  } finally {
    if (run.worker) void run.worker.terminate().catch(() => undefined); // память телефона: поток не держим
    if (current === run) current = null;
  }
}

// ---------- Без сети ----------
// Файлы, нужные для разбора без сети (ядро — то, что выбрано для этого браузера), и пример
function offlineUrls(): string[] {
  return [`${OCR_DIR}tesseract.min.js`, `${OCR_DIR}worker.min.js`, corePath(), `${OCR_DIR}eng.traineddata.gz`, OCR_SAMPLE_URL]
    .map(u => new URL(u, window.location.href).href);
}

// После удачного разбора: попросить service worker сохранить файлы распознавания на телефоне. Нужно, если разбор
// шёл мимо него (первое открытие по медленной сети: service worker ещё ставился — ждём, пока он включится, до 5 минут).
// Ответ — сколько файлов в кэше; без service worker (приватный режим, разработка) — null.
export async function keepOcrOffline(waitMs = 5 * 60 * 1000): Promise<{ kept: number; total: number } | null> {
  try {
    const sws = navigator.serviceWorker;
    if (!sws) return null;
    const reg = await Promise.race([sws.ready, new Promise<null>(r => setTimeout(() => r(null), waitMs))]);
    const sw = reg?.active;
    if (!sw) return null;
    return await new Promise(resolve => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), waitMs);
      ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data as { kept: number; total: number }); };
      sw.postMessage({ type: 'OCR_KEEP', urls: offlineUrls() }, [ch.port2]);
    });
  } catch {
    return null;
  }
}

// Всё ли нужное для разбора без сети уже лежит в кэше этого телефона
export async function ocrOfflineReady(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    for (const u of offlineUrls().slice(0, 4)) if (!(await caches.match(u))) return false;
    return true;
  } catch {
    return false;
  }
}

// Встроенный вымышленный пример скрина заказа — с этого же сайта (в кэше после первого раза)
export async function fetchSample(): Promise<Blob | null> {
  try {
    const r = await fetch(OCR_SAMPLE_URL);
    if (!r.ok) return null;
    const b = await r.blob();
    return b.size > 1000 ? b : null;
  } catch {
    return null;
  }
}
