// Заметки к сценарию — пока только текст и только на этом устройстве (в базу не уходят).
// Голос: на телефоне можно нажать микрофон на клавиатуре (диктовка). Запись звука — позже.
import { getJSON, setJSON } from '@/lib/storage';

export type LibraryNote = { id: string; text: string; at: string };

const key = (scenarioId: string) => 'fm.library.notes.' + scenarioId;

export async function loadNotes(scenarioId: string): Promise<LibraryNote[]> {
  const list = await getJSON<LibraryNote[]>(key(scenarioId), []);
  return Array.isArray(list) ? list.filter(n => n && typeof n.text === 'string') : [];
}

// Добавить заметку в начало списка. Возвращает новый список или null, если не сохранилось.
export async function addNote(scenarioId: string, text: string): Promise<LibraryNote[] | null> {
  const clean = text.trim();
  if (!clean) return null;
  const list = await loadNotes(scenarioId);
  const note: LibraryNote = { id: Date.now().toString(36), text: clean, at: new Date().toISOString() };
  const next = [note, ...list];
  return (await setJSON(key(scenarioId), next)) ? next : null;
}

export async function deleteNote(scenarioId: string, noteId: string): Promise<LibraryNote[] | null> {
  const next = (await loadNotes(scenarioId)).filter(n => n.id !== noteId);
  return (await setJSON(key(scenarioId), next)) ? next : null;
}
