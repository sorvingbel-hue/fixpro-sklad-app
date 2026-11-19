// Экран объекта: 1 Объект → 2 Фото и скрин заказа → 3 Сверка заказа и трака → 4 Вопросы → 5 Этапы → 6 Итог.
// Всё сохраняется само (через ~0,7 с после правки) только на этом устройстве. Время последнего
// сохранения видно наверху — чтобы было ясно, что сохранилось и где.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import { Checkbox, Collapsible } from '../training/parts';
import { exportText } from '../training/share';
import type { WorkV03Doc } from '../work/import-v03';
import {
  addItem, addTeam, buildWorkReport, ITEMS_MAX, removeItem, removeTeam, setCheck, setItem, setQuestion, setTeam,
  summarize, TEAM_MAX, verdict,
} from '../work/work-model';
import { ItemCard, TeamCard } from '../work/work-section';
import {
  addPhotos, buildJobHeader, jobProgress, newId, patchJob, PHOTOS_MAX, removePhoto, validateJob,
  type Job, type JobPhoto, type PhotoKind,
} from './jobs-model';
import { loadWork, saveWork } from './jobs-store';
import { PhotoGrid } from './photo-grid';
import { deletePhotos, PHOTO_WHERE, PHOTOS_SUPPORTED, pickPhotos, type PickSource } from './photo-store';

export function confirmAction(text: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(text)) onYes();
    return;
  }
  Alert.alert(text, undefined, [{ text: 'Отмена', style: 'cancel' }, { text: 'Да', style: 'destructive', onPress: onYes }]);
}

const hms = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Props = {
  job: Job;
  onJob: (j: Job) => Promise<boolean>; // сохранить карточку объекта (список объектов)
  onBack: () => void;
  onDelete: (j: Job) => void;
};

export function JobScreen({ job, onJob, onBack, onDelete }: Props) {
  const [work, setWork] = useState<WorkV03Doc | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveFail, setSaveFail] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newItem, setNewItem] = useState({ name: '', qty: '', unit: 'шт.' });
  const latest = useRef<WorkV03Doc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadWork(job.id).then(d => { if (alive) { latest.current = d; setWork(d); } });
    return () => { alive = false; };
  }, [job.id]);

  const flush = useCallback(async () => {
    timer.current = null;
    const d = latest.current;
    if (!d) return;
    const ok = await saveWork(d);
    setSaveFail(!ok);
    if (ok) setSavedAt(new Date());
  }, []);

  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);

  const update = useCallback((fn: (d: WorkV03Doc) => WorkV03Doc) => {
    const cur = latest.current;
    if (!cur) return;
    const next = { ...fn(cur), updated: new Date().toISOString() };
    latest.current = next;
    setWork(next);
    setReportMsg(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  const saveJob = useCallback(async (j: Job) => {
    const ok = await onJob(j);
    setSaveFail(!ok);
    if (ok) setSavedAt(new Date());
    return ok;
  }, [onJob]);

  const v = validateJob(job);

  // Выбор фото: pickPhotos вызывается первым действием в нажатии — иначе Safari не откроет окно выбора
  function onPick(source: PickSource, kind: PhotoKind) {
    setPhotoMsg(null);
    if (job.photos.length >= PHOTOS_MAX) { setPhotoMsg({ ok: false, text: `В объекте уже ${PHOTOS_MAX} фото — удалите лишние.` }); return; }
    const pending = pickPhotos(source, kind);
    setBusy(true);
    pending.then(async r => {
      if (!r.ok) { setPhotoMsg({ ok: false, text: r.reason }); return; }
      if (!r.photos.length) return; // выбор отменён
      const ok = await saveJob(addPhotos(job, r.photos));
      const what = kind === 'order' ? 'Скрин заказа' : r.photos.length > 1 ? `Фото (${r.photos.length})` : 'Фото';
      setPhotoMsg(ok
        ? { ok: true, text: `${what} добавлено и сохранено на этом устройстве${r.skipped ? `; не прочитано файлов: ${r.skipped}` : ''}.` }
        : { ok: false, text: 'Фото сохранено, но список объекта не записался — попробуйте ещё раз.' });
    }).finally(() => setBusy(false));
  }

  function onDeletePhoto(p: JobPhoto) {
    confirmAction(`Удалить ${p.kind === 'order' ? 'скрин заказа' : 'это фото'}? Вернуть будет нельзя.`, async () => {
      await deletePhotos([p.id]);
      const ok = await saveJob(removePhoto(job, p.id));
      setPhotoMsg(ok ? { ok: true, text: 'Фото удалено.' } : { ok: false, text: 'Не удалось сохранить изменение.' });
    });
  }

  async function onReport() {
    const d = latest.current;
    if (!d) return;
    const now = new Date();
    const text = buildJobHeader(job, now) + '\n' + buildWorkReport(d, now);
    const safe = (job.orderNo || job.title).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'obekt';
    const ok = await exportText(text, `forman-${safe}-${now.toISOString().slice(0, 10)}.txt`, `Отчёт: ${job.title}`);
    setReportMsg(ok ? (Platform.OS === 'web' ? { ok: true, text: 'Отчёт скачан файлом .txt' } : null) : { ok: false, text: 'Не удалось сформировать отчёт' });
  }

  if (!work) return <Muted>Открываю объект…</Muted>;

  const sum = summarize(work);
  const prog = jobProgress(job, sum);
  const photos = job.photos.filter(p => p.kind === 'photo');
  const orders = job.photos.filter(p => p.kind === 'order');
  const bad = work.items.filter(i => verdict(i).kind === 'bad');
  const unchecked = work.items.filter(i => verdict(i).kind === 'info');
  const openQ = work.questions.filter(q => !q.resolved);
  const openChecks = work.phases.flatMap(p => p.checks.filter(c => !work.checks[c[0]]).map(c => `${p.title}: ${c[1]}`));

  return (
    <View style={s.wrap} testID="job-screen">
      <Button title="← Все объекты" kind="secondary" onPress={onBack} testID="job-back" />

      <Card title={job.title || 'Объект без названия'}>
        <Text style={s.steps}>{prog.steps.map(x => `${x.done ? '✓' : '○'} ${x.label}`).join('   ')}</Text>
        {job.example ? <Muted>Пример: данные вымышленные. Можно менять и удалять как угодно.</Muted> : null}
        <Notice
          kind={saveFail ? 'warn' : 'ok'}
          text={saveFail ? 'Не удалось сохранить — записи остаются на экране, попробуйте ещё раз' : savedAt ? `Сохранено на этом устройстве · ${hms(savedAt)}` : 'Всё, что вы вводите, сохраняется само на этом устройстве'}
          testID="job-save"
        />
        <Muted>Где хранится: только на этом телефоне, в этом браузере. В базу команды и в интернет не отправляется.</Muted>
      </Card>

      <Text style={s.h}>1. Объект</Text>
      <Card>
        <Field label="Как вы называете объект *" value={job.title} onChangeText={t => void saveJob(patchJob(job, { title: t }))} placeholder="Напр.: замена печи, Клермонт" testID="job-title" />
        {v.errors.title ? <Notice kind="warn" text={v.errors.title} /> : null}
        <Field label="№ заказа (OrcaTech или другой) — если есть" value={job.orderNo} onChangeText={t => void saveJob(patchJob(job, { orderNo: t }))} testID="job-order" />
        <Field label="Заметка к объекту — не обязательно" value={job.note} multiline onChangeText={t => void saveJob(patchJob(job, { note: t }))} testID="job-note" />
        <Muted>* — обязательно. Остальное можно заполнить позже. Точный адрес клиента в демо лучше не писать.</Muted>
      </Card>

      <Text style={s.h}>{`2. Фото и скрин заказа · ${photos.length} фото, ${orders.length} скрин`}</Text>
      <Card>
        {PHOTOS_SUPPORTED ? (
          <>
            <Button title="📷  Сделать фото" onPress={() => onPick('camera', 'photo')} disabled={busy} testID="pick-camera" />
            <Button title="🖼  Фото из галереи" kind="secondary" onPress={() => onPick('gallery', 'photo')} disabled={busy} testID="pick-gallery" />
            <Button title="🧾  Скрин заказа (OrcaTech)" kind="secondary" onPress={() => onPick('gallery', 'order')} disabled={busy} testID="pick-order" />
            {busy ? <Notice kind="info" text="Жду выбор и сжимаю фото…" /> : null}
            <Muted>{PHOTO_WHERE}</Muted>
          </>
        ) : <Notice kind="info" text={PHOTO_WHERE} />}
        {photoMsg ? <Notice kind={photoMsg.ok ? 'ok' : 'warn'} text={photoMsg.text} testID="photo-msg" /> : null}
        <Text style={s.sub}>Фото с объекта</Text>
        <PhotoGrid photos={photos} onDelete={onDeletePhoto} empty="Пока нет фото. «До», «после», шильдик, щиток — что нужно офису." />
        <Text style={s.sub}>Скрин заказа</Text>
        <PhotoGrid photos={orders} onDelete={onDeletePhoto} empty="Пока нет скрина заказа. Сделайте скриншот заказа в OrcaTech и добавьте его сюда." />
      </Card>

      <Text style={s.h}>{`3. Сверка заказа и трака · ${sum.ok} ок, ${sum.bad} проблем из ${sum.items}`}</Text>
      <Muted>Для каждой позиции: сколько заказано, сколько в траке, есть / нет. Шаблонные позиции замените своими.</Muted>
      {work.items.map(i => (
        <View key={i.id} style={s.itemWrap}>
          <ItemCard item={i} onChange={patch => update(d => setItem(d, i.id, patch))} />
          <Button title="Убрать позицию" kind="secondary" onPress={() => confirmAction(`Убрать «${i.name}» из сверки?`, () => update(d => removeItem(d, i.id)))} testID={`item-remove-${i.id}`} />
        </View>
      ))}
      <Card title="Добавить позицию">
        <Field label="Что (оборудование или материал)" value={newItem.name} onChangeText={x => setNewItem(n => ({ ...n, name: x }))} testID="item-new-name" />
        <View style={s.row}>
          <View style={s.cell}><Field label="Нужно, кол-во" value={newItem.qty} keyboardType="numeric" onChangeText={x => setNewItem(n => ({ ...n, qty: x }))} testID="item-new-qty" /></View>
          <View style={s.cell}><Field label="Ед." value={newItem.unit} onChangeText={x => setNewItem(n => ({ ...n, unit: x }))} /></View>
        </View>
        <Button
          title={work.items.length >= ITEMS_MAX ? `Не больше ${ITEMS_MAX} позиций` : 'Добавить в сверку'}
          kind="secondary"
          disabled={!newItem.name.trim() || work.items.length >= ITEMS_MAX}
          onPress={() => {
            const q = Number(newItem.qty);
            update(d => addItem(d, newItem.name, newItem.qty.trim() && Number.isFinite(q) && q >= 0 ? q : null, newItem.unit, newId('it')));
            setNewItem({ name: '', qty: '', unit: 'шт.' });
          }}
          testID="item-add"
        />
      </Card>

      <Text style={s.h}>{`4. Вопросы до работы · открыто ${sum.questionsOpen}`}</Text>
      {work.questions.map(q => (
        <Card key={q.id}>
          <Text style={s.title}>{q.text}</Text>
          <Field label="Ответ и откуда он получен" value={q.answer} multiline onChangeText={x => update(d => setQuestion(d, q.id, { answer: x }))} />
          <Checkbox label="Уточнено мной; ответ записан" checked={q.resolved} onChange={x => update(d => setQuestion(d, q.id, { resolved: x && !!q.answer.trim() }))} testID={`q-${q.id}`} />
        </Card>
      ))}

      <Text style={s.h}>{`5. Этапы · ${sum.checksDone}/${sum.checksTotal}`}</Text>
      {work.phases.map(p => (
        <Collapsible key={p.id} open title={`${p.title} · ${p.checks.filter(c => work.checks[c[0]]).length}/${p.checks.length}`} testID={`phase-${p.id}`}>
          {p.checks.map(([id, text]) => (
            <Checkbox key={id} label={text} checked={!!work.checks[id]} onChange={x => update(d => setCheck(d, id, x))} testID={`check-${id}`} />
          ))}
        </Collapsible>
      ))}

      <Collapsible title={`Бригада и передача готовности · ${work.team.length} (не обязательно)`} testID="team">
        {work.team.map((t, k) => (
          <TeamCard key={k} row={t} onChange={patch => update(d => setTeam(d, k, patch))} onRemove={() => confirmAction('Удалить это назначение?', () => update(d => removeTeam(d, k)))} />
        ))}
        <Button title={work.team.length >= TEAM_MAX ? `Не больше ${TEAM_MAX}` : 'Добавить назначение'} kind="secondary" disabled={work.team.length >= TEAM_MAX} onPress={() => update(addTeam)} />
      </Collapsible>

      <Field label="Заметки смены" value={work.notes} multiline onChangeText={x => update(d => ({ ...d, notes: x }))} testID="job-notes" />

      <Text style={s.h}>6. Итог</Text>
      <Card>
        <Text style={s.sumLine} testID="job-summary">
          {`Фото: ${photos.length} · скрин заказа: ${orders.length} · сверка: ${sum.ok} ок, ${sum.bad} проблем, ${unchecked.length} не проверено · вопросы открыты: ${openQ.length} · этапы: ${sum.checksDone}/${sum.checksTotal}`}
        </Text>
        {orders.length === 0 ? <Notice kind="warn" text="Нет скрина заказа — офис не увидит, что было в заказе." /> : null}
        {bad.length ? <Notice kind="warn" text={`Не хватает / проблемы: ${bad.map(i => i.name).join('; ')}`} /> : null}
        {openQ.length ? <Notice kind="info" text={`Открытые вопросы: ${openQ.map(q => q.text).join('; ')}`} /> : null}
        {openChecks.length ? <Notice kind="info" text={`Не отмечено этапов: ${openChecks.length}`} /> : (
          <Notice kind="ok" text="Все этапы отмечены." />
        )}
        <Button title={Platform.OS === 'web' ? 'Скачать отчёт объекта (.txt)' : 'Отправить отчёт объекта'} onPress={onReport} testID="job-report" />
        <Muted>В отчёт входят поля, сверка, вопросы, этапы и названия фото. Сами фото остаются на телефоне.</Muted>
        {reportMsg ? <Notice kind={reportMsg.ok ? 'ok' : 'warn'} text={reportMsg.text} /> : null}
      </Card>

      <Button title="← Все объекты" kind="secondary" onPress={onBack} />
      <Button title="Удалить объект" kind="secondary" onPress={() => confirmAction(`Удалить объект «${job.title}» вместе с фото? Вернуть будет нельзя.`, () => onDelete(job))} testID="job-delete" />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.md },
  h: { fontSize: font.large, fontWeight: '800', color: colors.text, marginTop: space.sm },
  sub: { fontSize: font.body, fontWeight: '800', color: colors.text, marginTop: space.sm },
  title: { fontSize: font.body, fontWeight: '700', color: colors.text },
  steps: { fontSize: font.small, fontWeight: '700', color: colors.infoText, backgroundColor: colors.infoBg, borderRadius: radius.sm, padding: space.sm, overflow: 'hidden' },
  sumLine: { fontSize: font.small, color: colors.text, lineHeight: font.small * 1.4, fontWeight: '700' },
  itemWrap: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
});
