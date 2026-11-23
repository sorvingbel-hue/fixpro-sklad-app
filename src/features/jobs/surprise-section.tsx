// «Сюрприз» (М4): то, чего нет в заказе. Фото + пара слов → «Отправить в офис» (меню телефона: WhatsApp, СМС).
// «Отправлено» ставит бригадир сам (или само, если меню «Поделиться» завершилось). Удалить — с вопросом.
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import { Checkbox } from '../training/parts';
import { localTime, SURPRISE_STEP, SURPRISES_MAX, surpriseMessage, type Job, type JobPhoto, type ReportLang, type Surprise } from './jobs-model';
import { PhotoGrid } from './photo-grid';
import { canShareFiles, copyText, photoFiles, shareFiles } from './photo-store';

type Props = {
  job: Job;
  lang: ReportLang;
  busy: boolean;
  onShoot: (step: string) => Promise<string[]>;      // снять/выбрать фото в шаг 'surprise' → id добавленных фото
  onSave: (text: string, photoIds: string[]) => Promise<boolean>;
  onSent: (id: string, sent: boolean) => void;
  onRemove: (sp: Surprise) => void;
  onDeletePhoto: (p: JobPhoto) => void;
  onDiscard: (photoIds: string[]) => void;   // «Отмена» нового сюрприза: его фото не нужны
};

export function SurpriseSection({ job, lang, busy, onShoot, onSave, onSent, onRemove, onDeletePhoto, onDiscard }: Props) {
  const [draft, setDraft] = useState<{ text: string; photoIds: string[] } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ready, setReady] = useState<{ id: string; files: File[] } | null>(null);
  const list = job.surprises ?? [];
  const photosOf = (ids: string[]) => job.photos.filter(p => ids.includes(p.id));
  const draftPhotos = draft ? photosOf(draft.photoIds) : [];

  async function addPhoto() {
    const ids = await onShoot(SURPRISE_STEP);
    if (ids.length) setDraft(d => (d ? { ...d, photoIds: [...d.photoIds, ...ids] } : d));
  }

  async function save() {
    if (!draft) return;
    const ok = await onSave(draft.text, draftPhotos.map(p => p.id));
    if (ok) { setDraft(null); setMsg({ ok: true, text: 'Сюрприз записан. Нажмите «Отправить в офис».' }); }
    else setMsg({ ok: false, text: 'Не записалось — напишите пару слов или добавьте фото.' });
  }

  // Шаг 1 — собрать фото (Safari требует, чтобы само «Поделиться» было сразу в нажатии)
  async function prepare(sp: Surprise) {
    setMsg(null);
    const files = await photoFiles(photosOf(sp.photoIds));
    if (files.length && !canShareFiles(files)) {
      const ok = await copyText(surpriseMessage(job, sp, lang));
      setMsg(ok ? { ok: true, text: 'Этот браузер не отправляет фото. Текст скопирован — вставьте в WhatsApp, фото пришлите из галереи.' } : { ok: false, text: 'Этот браузер не умеет отправлять. Перепишите текст и пришлите фото из галереи.' });
      return;
    }
    setReady({ id: sp.id, files });
  }

  async function send(sp: Surprise) {
    const files = ready?.id === sp.id ? ready.files : [];
    const text = surpriseMessage(job, sp, lang);
    let r: 'ok' | 'cancel' | 'fail';
    if (files.length) r = await shareFiles(files, 'Surprise', text);
    else {
      try { await navigator.share({ title: 'Surprise', text }); r = 'ok'; } catch (e) { r = e instanceof DOMException && e.name === 'AbortError' ? 'cancel' : 'fail'; }
    }
    setReady(null);
    if (r === 'ok') { onSent(sp.id, true); setMsg({ ok: true, text: 'Отправлено. Отметка «отправлено» поставлена.' }); }
    else if (r === 'fail') {
      const ok = await copyText(text);
      setMsg(ok ? { ok: true, text: 'Меню «Поделиться» не открылось. Текст скопирован — вставьте в WhatsApp.' } : { ok: false, text: 'Не получилось отправить.' });
    }
  }

  return (
    <View style={s.wrap} testID="surprise">
      {draft ? (
        <Card title="Новый сюрприз">
          <Field label="Что не так (пара слов)" value={draft.text} multiline onChangeText={x => setDraft(d => (d ? { ...d, text: x } : d))} placeholder="Напр.: под блоком гнилая площадка, нужна новая" testID="surprise-text" />
          <Button title="📷  Добавить фото" kind="secondary" onPress={() => void addPhoto()} disabled={busy} testID="surprise-photo" />
          {draftPhotos.length ? <PhotoGrid photos={draftPhotos} onDelete={onDeletePhoto} empty="" /> : null}
          <Button title="Записать" onPress={() => void save()} disabled={!draft.text.trim() && !draftPhotos.length} testID="surprise-save" />
          <Button title="Отмена" kind="secondary" onPress={() => { if (draft.photoIds.length) onDiscard(draft.photoIds); setDraft(null); }} />
        </Card>
      ) : (
        <Button
          title={list.length >= SURPRISES_MAX ? `Не больше ${SURPRISES_MAX}` : '⚠️  Сюрприз — этого нет в заказе'}
          kind="secondary"
          disabled={list.length >= SURPRISES_MAX}
          onPress={() => { setMsg(null); setDraft({ text: '', photoIds: [] }); }}
          testID="surprise-new"
        />
      )}
      {list.length === 0 && !draft ? <Muted>Гнилая площадка, не тот размер, нет disconnect — снимите и сразу отправьте офису до начала работ.</Muted> : null}
      {list.map(sp => (
        <View key={sp.id} style={[s.item, sp.sentAt ? s.itemSent : s.itemOpen]} testID={`surprise-${sp.id}`}>
          <Text style={s.text}>{sp.text || 'Без текста'}</Text>
          <Muted>{`${localTime(sp.createdAt)} · фото: ${sp.photoIds.length} · ${sp.sentAt ? `отправлено ${localTime(sp.sentAt)}` : 'ещё не отправлено'}`}</Muted>
          {sp.photoIds.length ? <PhotoGrid photos={photosOf(sp.photoIds)} onDelete={onDeletePhoto} empty="" /> : null}
          {Platform.OS === 'web' ? (
            ready?.id === sp.id || !sp.photoIds.length
              ? <Button title="📤  Отправить в офис" onPress={() => void send(sp)} testID={`surprise-send-${sp.id}`} />
              : <Button title="📤  Подготовить отправку" kind={sp.sentAt ? 'secondary' : 'primary'} onPress={() => void prepare(sp)} testID={`surprise-prepare-${sp.id}`} />
          ) : null}
          <Checkbox label="Отправлено офису" checked={!!sp.sentAt} onChange={x => onSent(sp.id, x)} testID={`surprise-sent-${sp.id}`} />
          <Button title="Удалить сюрприз" kind="secondary" onPress={() => onRemove(sp)} />
        </View>
      ))}
      {msg ? <Notice kind={msg.ok ? 'ok' : 'warn'} text={msg.text} testID="surprise-msg" /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  item: { gap: space.xs, padding: space.md, borderRadius: radius.sm, borderWidth: 2 },
  itemOpen: { borderColor: colors.warnText, backgroundColor: colors.warnBg },
  itemSent: { borderColor: colors.okText, backgroundColor: colors.okBg },
  text: { fontSize: font.body, fontWeight: '800', color: colors.text },
});
