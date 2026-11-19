// Распознавание скрина заказа — общий интерфейс. Веб-версия (order-ocr.web.ts): tesseract.js в браузере телефона.
// В приложении на телефоне (Expo Go) распознавания пока нет: кнопка показывает это прямо, а не делает вид, что работает.
import type { OcrLine } from './order-parse';

export type OcrStage = 'load' | 'recognize';
export type OcrOutcome =
  | { ok: true; lines: OcrLine[]; words: number; ms: number; loadMs: number }
  | { ok: false; stage: OcrStage; reason: string };

export const OCR_SUPPORTED = false;
export const OCR_SAMPLE_NAME = 'ПРИМЕР скрина заказа (вымышленный).png';
export const OCR_WHERE = 'Распознавание скрина пока работает только в веб-версии по ссылке (на телефоне, без отправки скрина).';
export const OCR_FIRST = '';
export const OCR_READY = '';
export const OCR_MANUAL = 'Позиции можно вписать вручную в «3. Сверка» (кнопка «Добавить в сверку»).';

export async function recognizeOrder(_image: Blob, _onProgress: (stage: OcrStage, pct: number) => void): Promise<OcrOutcome> {
  return { ok: false, stage: 'load', reason: OCR_WHERE + ' ' + OCR_MANUAL };
}

export function cancelOcr(): void {}

export async function fetchSample(): Promise<Blob | null> {
  return null;
}

export async function keepOcrOffline(): Promise<{ kept: number; total: number } | null> {
  return null;
}

export async function ocrOfflineReady(): Promise<boolean> {
  return false;
}
