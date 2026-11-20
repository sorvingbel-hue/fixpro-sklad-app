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
  addItem, addOrderItems, addQuestion, addTeam, buildWorkReport, ITEMS_MAX, quantity, QUESTIONS_MAX, removeItem, removeQuestion,
  removeTeam, SAMPLE_SOURCE, setCheck, setItem, setOrderQty, setQuestion, setTeam, shortages, shortageText, summarize, TEAM_MAX, verdict,
} from '../work/work-model';
import { ItemCard, TeamCard } from '../work/work-section';
import {
  addPhotos, buildJobHeader, jobProgress, newId, patchJob, PHOTOS_MAX, removePhoto, reportFileName, setPhotoKind, validateJob,
  type Job, type JobPhoto, type PhotoKind,
} from './jobs-model';
import { loadWork, saveWork } from './jobs-store';
import { fetchSample, OCR_SAMPLE_NAME } from './order-ocr';
import { OrderOcrPanel } from './order-ocr-panel';
import { PhotoGrid } from './photo-grid';
import {
  addImageBlob, canShareFiles, copyText, deletePhotos, PHOTO_WHERE, photoFiles, PHOTOS_SUPPORTED, pickPhotos, shareFiles, type PickSource,
} from './photo-store';

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
  const [newQ, setNewQ] = useState('');
  const [shareReady, setShareReady] = useState<{ files: File[]; text: string } | null>(null);
  const latest = useRef<WorkV03Doc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftOpen = useRef(false); // открыт черновик со скрина (не подтверждён) — при уходе к списку спросить

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
      const what = kind === 'order' ? 'Скрин заказа добавлен' : r.photos.length > 1 ? `Фото добавлены (${r.photos.length})` : 'Фото добавлено';
      setShareReady(null);
      setPhotoMsg(ok
        ? { ok: true, text: `${what} и сохранено на этом устройстве${r.skipped ? `; не прочитано файлов: ${r.skipped}` : ''}.` }
        : { ok: false, text: 'Фото сохранено, но список объекта не записался — попробуйте ещё раз.' });
    }).finally(() => setBusy(false));
  }

  function onDeletePhoto(p: JobPhoto) {
    confirmAction(`Удалить ${p.kind === 'order' ? 'скрин заказа' : 'это фото'}? Вернуть будет нельзя.`, async () => {
      await deletePhotos([p.id]);
      setShareReady(null);
      const ok = await saveJob(removePhoto(job, p.id));
      setPhotoMsg(ok ? { ok: true, text: 'Фото удалено.' } : { ok: false, text: 'Не удалось сохранить изменение.' });
    });
  }

  // Тип у миниатюры: фото объекта ↔ скрин заказа (добавили не той кнопкой)
  function onKind(p: JobPhoto, kind: PhotoKind) {
    void saveJob(setPhotoKind(job, p.id, kind)).then(ok => {
      setShareReady(null);
      setPhotoMsg(ok
        ? { ok: true, text: kind === 'order' ? 'Перенесено в «Скрин заказа» — теперь его можно разобрать (кнопка «Разобрать» ниже).' : 'Перенесено в «Фото объекта» — это просто вложение, разбирать его не будем.' }
        : { ok: false, text: 'Не удалось сохранить изменение.' });
    });
  }

  function reportText(now: Date): string | null {
    const d = latest.current;
    if (!d) return null;
    const sh = shortages(d);
    const short = sh.length ? ['НЕДОСТАЧА ПО ЗАКАЗУ:', ...sh.map(x => `• ${shortageText(x)}`), '', ''].join('\n') : '';
    return buildJobHeader(job, now) + '\n' + short + buildWorkReport(d, now, job.title);
  }

  // «Попробовать разбор на примере»: вымышленный скрин заказа с сайта «Формана» → в объект как скрин заказа (ПРИМЕР).
  // Пример в объекте один: повторное нажатие разбирает уже добавленный, а не добавляет ещё один.
  async function addSample(): Promise<{ ok: true; photo: JobPhoto } | { ok: false; reason: string }> {
    const have = job.photos.find(p => p.kind === 'order' && p.sample);
    if (have) return { ok: true, photo: have };
    if (job.photos.length >= PHOTOS_MAX) return { ok: false, reason: `В объекте уже ${PHOTOS_MAX} фото — удалите лишние.` };
    const blob = await fetchSample();
    if (!blob) return { ok: false, reason: 'Не удалось загрузить пример с сайта «Формана». Первый раз нужна сеть.' };
    const r = await addImageBlob(blob, 'order', OCR_SAMPLE_NAME);
    if (!r.ok) return r;
    const photo: JobPhoto = { ...r.photos[0], sample: true };
    if (!(await saveJob(addPhotos(job, [photo])))) {
      await deletePhotos([photo.id]);
      return { ok: false, reason: 'Пример не записался в объект — попробуйте ещё раз.' };
    }
    setShareReady(null);
    setPhotoMsg({ ok: true, text: 'Пример скрина заказа (вымышленный) добавлен и сохранён на этом устройстве.' });
    return { ok: true, photo };
  }

  // «Подтвердить и добавить в сверку» в черновике: только здесь сверка меняется.
  // add — новые позиции; replace — «заменить количество» у позиций, которые уже есть (повторный разбор, второй скрин)
  function onOrderConfirm(p: { add: { name: string; qty: number | null; unit: string }[]; replace: { id: string; qty: number }[] }, sample: boolean) {
    const cur = latest.current;
    if (!cur) return { added: 0, replaced: 0, overLimit: p.add.length };
    let doc = cur, replaced = 0;
    for (const r of p.replace) {
      const next = setOrderQty(doc, r.id, r.qty);
      if (next !== doc) { doc = next; replaced++; }
    }
    const base = newId('oi');
    const res = addOrderItems(doc, p.add, k => `${base}-${k}`, sample ? SAMPLE_SOURCE : undefined);
    if (res.added || replaced) update(() => res.doc);
    return { added: res.added, replaced, overLimit: res.overLimit };
  }

  async function onReport() {
    const now = new Date();
    const text = reportText(now);
    if (!text) return;
    const ok = await exportText(text, reportFileName(job, now), `Отчёт: ${job.title}`);
    setReportMsg(ok ? (Platform.OS === 'web' ? { ok: true, text: 'Отчёт скачан файлом .txt' } : null) : { ok: false, text: 'Не удалось сформировать отчёт' });
  }

  // Шаг 1: собрать файлы (текст + фото). Шаг 2 — отдельным нажатием «Отправить».
  async function onPrepareShare() {
    const now = new Date();
    const text = reportText(now);
    if (!text) return;
    const txt = new File([text], reportFileName(job, now), { type: 'text/plain' });
    const files = [txt, ...(await photoFiles(job.photos))];
    if (!canShareFiles(files)) {
      setShareReady(null);
      setReportMsg({ ok: false, text: 'Этот браузер не умеет отправлять файлы. Скачайте отчёт (.txt) и отправьте фото из галереи, или скопируйте текст.' });
      return;
    }
    setShareReady({ files, text });
    setReportMsg({ ok: true, text: `Готово к отправке: отчёт и ${files.length - 1} фото. Нажмите «Отправить».` });
  }

  async function onShare() {
    if (!shareReady) return;
    const r = await shareFiles(shareReady.files, `Отчёт: ${job.title}`, shareReady.text.split('\n')[0]);
    if (r === 'ok') { setReportMsg({ ok: true, text: 'Отчёт с фото отправлен.' }); setShareReady(null); }
    else if (r === 'fail') setReportMsg({ ok: false, text: 'Отправить не получилось. Скачайте отчёт (.txt) или скопируйте текст.' });
  }

  async function onCopy() {
    const text = reportText(new Date());
    const ok = !!text && (await copyText(text));
    setReportMsg(ok ? { ok: true, text: 'Текст отчёта скопирован — вставьте в WhatsApp или письмо.' } : { ok: false, text: 'Не удалось скопировать.' });
  }

  if (!work) return <Muted>Открываю объект…</Muted>;

  const sum = summarize(work);
  const prog = jobProgress(job, sum);
  const photos = job.photos.filter(p => p.kind === 'photo');
  const orders = job.photos.filter(p => p.kind === 'order');
  const realOrders = orders.filter(p => !p.sample); // пример — не настоящий заказ
  const bad = work.items.filter(i => verdict(i).kind === 'bad');
  const unchecked = work.items.filter(i => verdict(i).kind === 'info');
  const openQ = work.questions.filter(q => !q.resolved);
  const openChecks = work.phases.flatMap(p => p.checks.filter(c => !work.checks[c[0]]).map(c => `${p.title}: ${c[1]}`));
  const short = shortages(work);
  const waitTruck = work.items.filter(i => quantity(i.required) !== null && quantity(i.actual) === null && i.status !== 'missing');

  // К списку объектов: неподтверждённый черновик со скрина пропадёт — спросить
  const leave = () => {
    if (draftOpen.current) confirmAction('Черновик со скрина не подтверждён — правки пропадут, в сверку ничего не добавится. Уйти к списку объектов?', onBack);
    else onBack();
  };

  return (
    <View style={s.wrap} testID="job-screen">
      <Button title="← Все объекты" kind="secondary" onPress={leave} testID="job-back" />

      <Card title={job.title || 'Объект без названия'}>
        <Text style={s.steps}>{prog.steps.map(x => `${x.done ? '✓' : '○'} ${x.label}`).join('   ')}</Text>
        {job.example ? <Notice kind="info" text="ДЕМО · пример с вымышленными данными. Можно менять и удалять как угодно." testID="job-demo" /> : null}
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
        <Field label="№ заказа (Orcatec или другой) — если есть" value={job.orderNo} onChangeText={t => void saveJob(patchJob(job, { orderNo: t }))} testID="job-order" />
        <Muted>* — обязательно. Остальное можно заполнить позже. Точный адрес клиента в демо лучше не писать.</Muted>
      </Card>

      <Text style={s.h}>{`2. Фото и скрин заказа · ${photos.length} фото, ${orders.length} скрин`}</Text>
      <Card>
        {PHOTOS_SUPPORTED ? (
          <>
            {/* Две разные кнопки: фото объекта — просто вложение; скрин заказа — его можно разобрать.
                Фото — без «только камера»: телефон сам предложит «Снять фото» или «Медиатека». */}
            <View style={s.pick}>
              <Button title="📷  Фото объекта — просто вложение" onPress={() => onPick('gallery', 'photo')} disabled={busy} testID="pick-camera" />
              <Muted>«До», «после», шильдик, щиток. Снять или выбрать из галереи. Не разбирается — уходит в отчёт фотографией.</Muted>
            </View>
            <View style={s.pick}>
              <Button title="🧾  Скрин заказа — можно разобрать" onPress={() => onPick('gallery', 'order')} disabled={busy} testID="pick-order" />
              <Muted>Скриншот заказа (Orcatec). Кнопка «Разобрать» прочитает позиции и количества прямо на телефоне.</Muted>
            </View>
            {busy ? <Notice kind="info" text="Жду выбор и сжимаю фото…" /> : null}
            <Muted>{PHOTO_WHERE}</Muted>
          </>
        ) : <Notice kind="info" text={PHOTO_WHERE} />}
        {photoMsg ? <Notice kind={photoMsg.ok ? 'ok' : 'warn'} text={photoMsg.text} testID="photo-msg" /> : null}
        <Text style={s.sub}>{`📷 Фото объекта — вложения · ${photos.length}`}</Text>
        <PhotoGrid photos={photos} onDelete={onDeletePhoto} onKind={onKind} empty="Пока нет фото. «До», «после», шильдик, щиток — что нужно офису." />
        <Text style={s.sub}>{`🧾 Скрин заказа — можно разобрать · ${orders.length}`}</Text>
        <PhotoGrid photos={orders} onDelete={onDeletePhoto} onKind={onKind} empty="Пока нет скрина заказа. Сделайте скриншот заказа в Orcatec и добавьте его сюда." />
        <OrderOcrPanel
          orders={orders}
          items={work.items.map(i => ({ id: i.id, name: i.name, qty: quantity(i.required), actual: quantity(i.actual), unit: i.unit }))}
          addSample={addSample}
          onConfirm={onOrderConfirm}
          onDraft={open => { draftOpen.current = open; }}
        />
      </Card>

      <Text style={s.h}>{`3. Сверка заказа и трака · ${sum.ok} ок, ${sum.bad} проблем из ${sum.items}`}</Text>
      <Muted>Для каждой позиции: сколько нужно по заказу, сколько в траке, есть / нет.</Muted>
      {work.items.length === 0 ? <Notice kind="info" text="Список пуст. Добавьте ниже, что должно быть в траке по заказу: оборудование и материалы." /> : null}
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
          <Button title="Убрать вопрос" kind="secondary" onPress={() => confirmAction('Убрать этот вопрос?', () => update(d => removeQuestion(d, q.id)))} />
        </Card>
      ))}
      <Card title="Добавить вопрос">
        <Field label="Что нужно уточнить до работы (у офиса, продавца, клиента)" value={newQ} multiline onChangeText={setNewQ} testID="q-new" />
        <Button
          title={work.questions.length >= QUESTIONS_MAX ? `Не больше ${QUESTIONS_MAX} вопросов` : 'Добавить вопрос'}
          kind="secondary"
          disabled={!newQ.trim() || work.questions.length >= QUESTIONS_MAX}
          onPress={() => { update(d => addQuestion(d, newQ, newId('q'))); setNewQ(''); }}
          testID="q-add"
        />
      </Card>

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

      <Field label="Заметки по объекту" value={work.notes} multiline onChangeText={x => update(d => ({ ...d, notes: x }))} testID="job-notes" />

      <Text style={s.h}>6. Итог</Text>
      <Card>
        <Text style={s.sumLine} testID="job-summary">
          {`Фото: ${photos.length} · скрин заказа: ${realOrders.length}${orders.length > realOrders.length ? ' (+ пример)' : ''} · сверка: ${sum.ok} ок, ${sum.bad} проблем, ${unchecked.length} не проверено · вопросы открыты: ${openQ.length} · этапы: ${sum.checksDone}/${sum.checksTotal}`}
        </Text>
        {realOrders.length === 0 ? (
          <Notice kind="warn" text={orders.length ? 'Нет скрина настоящего заказа (есть только вымышленный ПРИМЕР) — офис не увидит, что было в заказе.' : 'Нет скрина заказа — офис не увидит, что было в заказе.'} />
        ) : null}
        <View style={[s.short, short.length ? s.shortBad : null]} testID="job-shortage">
          <Text style={[s.shortTitle, short.length ? { color: colors.warnText } : null]}>Недостача по заказу</Text>
          {short.length ? short.map(x => <Text key={x.id} style={s.shortLine} testID={`shortage-${x.id}`}>{`• ${shortageText(x)}`}</Text>) : (
            <Text style={s.shortNone}>
              {work.items.length === 0 ? 'Сверка пуста — добавьте позиции вручную или «Разобрать» скрин заказа.'
                : waitTruck.length ? `Пока не видно: впишите «В траке» в «3. Сверка» (не вписано у ${waitTruck.length}).`
                : 'Недостачи нет — по вписанным количествам всё на месте.'}
            </Text>
          )}
          {short.length && waitTruck.length ? <Text style={s.shortNone}>{`Ещё не вписано «В траке» у ${waitTruck.length}.`}</Text> : null}
        </View>
        {bad.length ? <Notice kind="warn" text={`Не хватает / проблемы: ${bad.map(i => i.name).join('; ')}`} /> : null}
        {openQ.length ? <Notice kind="info" text={`Открытые вопросы: ${openQ.map(q => q.text).join('; ')}`} /> : null}
        {openChecks.length ? <Notice kind="info" text={`Не отмечено этапов: ${openChecks.length}`} /> : (
          <Notice kind="ok" text="Все этапы отмечены." />
        )}
        {Platform.OS === 'web' ? (
          shareReady ? (
            <Button title={`📤  Отправить отчёт и ${shareReady.files.length - 1} фото`} onPress={() => void onShare()} testID="job-share" />
          ) : (
            <Button title="📤  Подготовить отчёт с фото" onPress={() => void onPrepareShare()} testID="job-share-prepare" />
          )
        ) : null}
        <Button title={Platform.OS === 'web' ? 'Скачать отчёт (.txt)' : 'Отправить отчёт'} kind="secondary" onPress={onReport} testID="job-report" />
        {Platform.OS === 'web' ? <Button title="Скопировать текст отчёта" kind="secondary" onPress={() => void onCopy()} testID="job-copy" /> : null}
        <Muted>«Отправить» открывает меню телефона: WhatsApp, почта, сообщения. В отчёт входят поля, сверка, вопросы, этапы; фото — отдельными файлами.</Muted>
        {reportMsg ? <Notice kind={reportMsg.ok ? 'ok' : 'warn'} text={reportMsg.text} /> : null}
      </Card>

      <Button title="← Все объекты" kind="secondary" onPress={leave} />
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
  short: { gap: space.xs, borderRadius: radius.sm, padding: space.md, backgroundColor: colors.infoBg },
  shortBad: { backgroundColor: colors.warnBg, borderWidth: 2, borderColor: colors.warnText },
  shortTitle: { fontSize: font.large, fontWeight: '800', color: colors.infoText },
  shortLine: { fontSize: font.body, fontWeight: '800', color: colors.warnText, lineHeight: font.body * 1.35 },
  shortNone: { fontSize: font.small, fontWeight: '700', color: colors.infoText },
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
  pick: { gap: space.xs, padding: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg },
});
