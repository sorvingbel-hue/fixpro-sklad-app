// Фото объекта — общий интерфейс. Веб-версия (photo-store.web.ts): камера/галерея через браузер,
// сжатие, хранение в IndexedDB этого браузера. В приложении на телефоне (Expo Go) фото пока нет:
// кнопки показывают это прямо, а не делают вид, что работают.
import type { JobPhoto, PhotoKind } from './jobs-model';

export type PickSource = 'camera' | 'gallery';
export type PickResult = { ok: true; photos: JobPhoto[]; skipped: number } | { ok: false; reason: string };

export const PHOTOS_SUPPORTED = false;
export const PHOTO_WHERE = 'Фото в приложении на телефоне появятся в следующей сборке. Сейчас фото работают в веб-версии по ссылке.';

export async function pickPhotos(_source: PickSource, _kind: PhotoKind): Promise<PickResult> {
  return { ok: false, reason: PHOTO_WHERE };
}

export async function photoUrl(_id: string, _size: 'thumb' | 'full'): Promise<string | null> {
  return null;
}

export async function deletePhotos(_ids: string[]): Promise<void> {}

export async function storageInfo(): Promise<{ usedMB: number; quotaMB: number } | null> {
  return null;
}

// Отправка отчёта с фото и сохранность — только в веб-версии
export async function photoFiles(_photos: JobPhoto[]): Promise<File[]> { return []; }
export function canShareFiles(_files: File[]): boolean { return false; }
export async function shareFiles(_files: File[], _title: string, _text: string): Promise<'ok' | 'cancel' | 'fail'> { return 'fail'; }
export async function copyText(_text: string): Promise<boolean> { return false; }
export async function requestPersist(): Promise<boolean | null> { return null; }
export function inAppBrowser(): string | null { return null; }
