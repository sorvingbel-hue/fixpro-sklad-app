// Экран объекта (рабочая версия, 5 функций): 1 Объект → 2 Заказ → 3 Трак → 4 Фото по шагам → 5 Сюрприз → Сдать и отчёт.
// Вопросы до работы и заметки — свёрнуты. Этапы-галочки и «Бригада» убраны с экрана (данные в документе остаются).
// Всё сохраняется само (через ~0,7 с после правки) только на этом устройстве. Время последнего
// сохранения видно наверху — чтобы было ясно, что сохранилось и где.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import { getItem as getStored, setItem as setStored } from '@/lib/storage';

import { Checkbox, Collapsible } from '../training/parts';
import { exportText } from '../training/share';
import type { WorkV03Doc } from '../work/import-v03';
import {
  addOrderItems, addQuestion, quantity, QUESTIONS_MAX, removeQuestion, SAMPLE_SOURCE, setOrderQty, setQuestion, summarize, truckForReport, verdict,
} from '../work/work-model';
import {
  addPhotos, addSurprise, ADDRESS_MAX, buildFieldReport, jobProgress, markSurpriseSent, newId, patchJob, PHOTOS_MAX, removePhoto,
  removeSurprise, REPORT_LANG_DEFAULT, reportFileName, setPhotoKind, setPhotoStep, stepsSummary, validateJob,
  type Job, type JobPhoto, type PhotoKind, type ReportLang, type Surprise,
} from './jobs-model';
import { loadWork, saveWork } from './jobs-store';
import { fetchSample, OCR_SAMPLE_NAME } from './order-ocr';
import { OrderOcrPanel } from './order-ocr-panel';
import { PhotoGrid } from './photo-grid';
import {
  addImageBlob, canShareFiles, copyText, deletePhotos, PHOTO_WHERE, photoFiles, PHOTOS_SUPPORTED, pickPhotos, shareFiles, type PickSource,
} from './photo-store';
import { StepsSection } from './steps-section';
import { SurpriseSection } from './surprise-section';
import { TruckSection } from './truck-section';

const REPORT_LANG_KEY = 'fm.reportLang';

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
  const [newQ, setNewQ] = useState('');
  const [shareReady, setShareReady] = useState<{ files: File[]; text: string } | null>(null);
  const latest = useRef<WorkV03Doc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reportLang, setReportLang] = useState<ReportLang>(REPORT_LANG_DEFAULT);
  const draftOpen = useRef(false); // открыт черновик со скрина (не подтверждён) — при уходе к списку спросить

  useEffect(() => {
    let alive = true;
    void getStored(REPORT_LANG_KEY).then(v => { if (alive && (v === 'en' || v === 'ru')) setReportLang(v); });
    return () => { alive = false; };
  }, []);

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
      let j = removePhoto(job, p.id);
      if ((j.surprises ?? []).some(x => x.photoIds.includes(p.id))) {
        j = patchJob(j, { surprises: (j.surprises ?? []).map(x => ({ ...x, photoIds: x.photoIds.filter(id => id !== p.id) })) });
      }
      const ok = await saveJob(j);
      setPhotoMsg(ok ? { ok: true, text: 'Фото удалено.' } : { ok: false, text: 'Не удалось сохранить изменение.' });
    });
  }

  // Тип у миниатюры: фото объекта ↔ скрин заказа (добавили не той кнопкой)
  function onKind(p: JobPhoto, kind: PhotoKind) {
    const base = p.step ? setPhotoStep(job, p.id, null) : job;
    void saveJob(setPhotoKind(base, p.id, kind)).then(ok => {
      setShareReady(null);
      setPhotoMsg(ok
        ? { ok: true, text: kind === 'order' ? 'Перенесено в «Скрин заказа» — теперь его можно разобрать (кнопка «Разобрать» ниже).' : 'Перенесено в «Фото объекта» — это просто вложение, разбирать его не будем.' }
        : { ok: false, text: 'Не удалось сохранить изменение.' });
    });
  }

  // Фото в шаг монтажа (или в «Сюрприз»): pickPhotos — первым действием в нажатии (иначе Safari не откроет выбор)
  async function onShoot(step: string): Promise<string[]> {
    setPhotoMsg(null);
    if (job.photos.length >= PHOTOS_MAX) { setPhotoMsg({ ok: false, text: `В объекте уже ${PHOTOS_MAX} фото — удалите лишние.` }); return []; }
    const pending = pickPhotos('gallery', 'photo');
    setBusy(true);
    try {
      const r = await pending;
      if (!r.ok) { setPhotoMsg({ ok: false, text: r.reason }); return []; }
      if (!r.photos.length) return [];
      const photos = r.photos.map(p => ({ ...p, step }));
      const next = addPhotos(job, photos);
      const ok = await saveJob(next);
      setShareReady(null);
      const kept = next.photos.slice(-photos.length).map(p => p.id).filter(id => photos.some(p => p.id === id));
      setPhotoMsg(ok ? { ok: true, text: `${kept.length > 1 ? `Фото добавлены (${kept.length})` : 'Фото добавлено'} и сохранено на этом устройстве${r.skipped ? `; не прочитано файлов: ${r.skipped}` : ''}.` } : { ok: false, text: 'Фото не записалось в объект — попробуйте ещё раз.' });
      return ok ? kept : [];
    } finally {
      setBusy(false);
    }
  }

  async function onSurpriseSave(text: string, photoIds: string[]) {
    const next = addSurprise(job, text, photoIds);
    if (next === job) return false;
    return saveJob(next);
  }

  async function onSurpriseDiscard(ids: string[]) {
    await deletePhotos(ids);
    let j = job;
    for (const id of ids) j = removePhoto(j, id);
    await saveJob(j);
  }

  function onSurpriseRemove(sp: Surprise) {
    confirmAction(`Удалить сюрприз${sp.photoIds.length ? ` и его фото (${sp.photoIds.length})` : ''}? Вернуть будет нельзя.`, async () => {
      if (sp.photoIds.length) await deletePhotos(sp.photoIds);
      let j = removeSurprise(job, sp.id);
      for (const id of sp.photoIds) j = removePhoto(j, id);
      setShareReady(null);
      await saveJob(j);
    });
  }

  function setLang(l: ReportLang) {
    setReportLang(l);
    setShareReady(null);
    setReportMsg(null);
    void setStored(REPORT_LANG_KEY, l);
  }

  function reportText(now: Date): string | null {
    const d = latest.current;
    if (!d) return null;
    return buildFieldReport(job, {
      truck: truckForReport(d, reportLang),
      openQuestions: d.questions.filter(q => !q.resolved).map(q => q.text),
      notes: d.notes,
    }, reportLang, now);
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
  const shots = stepsSummary(job);
  const others = job.photos.filter(p => p.kind === 'photo' && !p.step);
  const orders = job.photos.filter(p => p.kind === 'order');
  const realOrders = orders.filter(p => !p.sample); // пример — не настоящий заказ
  const bad = work.items.filter(i => verdict(i).kind === 'bad');
  const unchecked = work.items.filter(i => i.status === 'unknown');
  const openQ = work.questions.filter(q => !q.resolved);
  const unsent = (job.surprises ?? []).filter(x => !x.sentAt);
  const gaps = [
    ...(realOrders.length ? [] : ['нет скрина заказа']),
    ...(work.items.length === 0 ? ['трак не сверен'] : unchecked.length ? [`трак: не отмечено ${unchecked.length}`] : []),
    ...(shots.missing.length ? [`нет фото: ${shots.missing.map(x => x.ru).join(', ')}`] : []),
    ...(unsent.length ? [`сюрприз не отправлен: ${unsent.length}`] : []),
  ];

  // К списку объектов: неподтверждённый черновик со скрина пропадёт — спросить
  const leave = () => {
    if (draftOpen.current) confirmAction('Черновик со скрина не подтверждён — правки пропадут, в список трака ничего не добавится. Уйти к списку объектов?', onBack);
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
          text={saveFail ? 'Не удалось сохранить — записи остаются на экране, попробуйте ещё раз' : savedAt ? `Сохранено на этом телефоне · ${hms(savedAt)}` : 'Всё, что вы вводите, сохраняется само на этом телефоне'}
          testID="job-save"
        />
      </Card>

      <Text style={s.h}>1. Объект</Text>
      <Card>
        <Field label="Как вы называете объект *" value={job.title} onChangeText={t => void saveJob(patchJob(job, { title: t }))} placeholder="Напр.: замена печи, Клермонт" testID="job-title" />
        {v.errors.title ? <Notice kind="warn" text={v.errors.title} /> : null}
        <Field label="Адрес" value={job.address ?? ''} maxLength={ADDRESS_MAX} onChangeText={t => void saveJob(patchJob(job, { address: t }))} placeholder={job.example ? 'В демо настоящий адрес не пишите' : 'Улица, дом, город'} testID="job-address" />
        <Field label="№ заказа — если есть" value={job.orderNo} onChangeText={t => void saveJob(patchJob(job, { orderNo: t }))} testID="job-order" />
      </Card>

      <Text style={s.h}>{`2. Заказ · скрин: ${realOrders.length}`}</Text>
      <Card>
        {PHOTOS_SUPPORTED ? (
          <Button title="🧾  Добавить скрин заказа" onPress={() => onPick('gallery', 'order')} disabled={busy} testID="pick-order" />
        ) : <Notice kind="info" text={PHOTO_WHERE} />}
        <Muted>Скриншот заказа. «Разобрать» прочитает позиции прямо на телефоне и добавит их в «Трак». Лучше скриншот, а не фото экрана.</Muted>
        {busy ? <Notice kind="info" text="Жду выбор и сжимаю фото…" /> : null}
        {photoMsg ? <Notice kind={photoMsg.ok ? 'ok' : 'warn'} text={photoMsg.text} testID="photo-msg" /> : null}
        <PhotoGrid photos={orders} onDelete={onDeletePhoto} onKind={onKind} empty="Скрина заказа пока нет." />
        <OrderOcrPanel
          orders={orders}
          items={work.items.map(i => ({ id: i.id, name: i.name, qty: quantity(i.required), actual: quantity(i.actual), unit: i.unit }))}
          addSample={addSample}
          onConfirm={onOrderConfirm}
          onDraft={open => { draftOpen.current = open; }}
        />
      </Card>

      <Text style={s.h}>{`3. Трак · ${work.items.length - unchecked.length}/${work.items.length} отмечено${bad.length ? ` · не хватает ${bad.length}` : ''}`}</Text>
      <TruckSection work={work} update={update} confirm={confirmAction} />

      <Text style={s.h}>{`4. Фото по шагам · ${shots.done}/${shots.total}`}</Text>
      {PHOTOS_SUPPORTED ? (
        <StepsSection job={job} busy={busy} onShoot={st => void onShoot(st)} onDelete={onDeletePhoto} onKind={onKind} />
      ) : <Notice kind="info" text={PHOTO_WHERE} />}
      {others.length ? (
        <Collapsible title={`Другие фото (без шага) · ${others.length}`} testID="other-photos">
          <PhotoGrid photos={others} onDelete={onDeletePhoto} onKind={onKind} empty="" />
        </Collapsible>
      ) : null}
      {photoMsg && !busy ? <Notice kind={photoMsg.ok ? 'ok' : 'warn'} text={photoMsg.text} /> : null}

      <Text style={s.h}>{`5. Сюрприз${(job.surprises ?? []).length ? ` · ${(job.surprises ?? []).length}` : ''}`}</Text>
      <SurpriseSection
        job={job}
        lang={reportLang}
        busy={busy}
        onShoot={onShoot}
        onSave={onSurpriseSave}
        onSent={(id, sent) => void saveJob(markSurpriseSent(job, id, sent))}
        onRemove={onSurpriseRemove}
        onDeletePhoto={onDeletePhoto}
        onDiscard={ids => void onSurpriseDiscard(ids)}
      />

      <Collapsible title={`Вопросы до работы · открыто ${openQ.length}`} testID="questions">
        {work.questions.map(q => (
          <Card key={q.id}>
            <Text style={s.title}>{q.text}</Text>
            <Field label="Ответ и откуда он получен" value={q.answer} multiline onChangeText={x => update(d => setQuestion(d, q.id, { answer: x }))} />
            <Checkbox label="Уточнено; ответ записан" checked={q.resolved} onChange={x => update(d => setQuestion(d, q.id, { resolved: x && !!q.answer.trim() }))} testID={`q-${q.id}`} />
            <Button title="Убрать вопрос" kind="secondary" onPress={() => confirmAction('Убрать этот вопрос?', () => update(d => removeQuestion(d, q.id)))} />
          </Card>
        ))}
        <Field label="Что уточнить до работы (у офиса, продавца, клиента)" value={newQ} multiline onChangeText={setNewQ} testID="q-new" />
        <Button
          title={work.questions.length >= QUESTIONS_MAX ? `Не больше ${QUESTIONS_MAX} вопросов` : 'Добавить вопрос'}
          kind="secondary"
          disabled={!newQ.trim() || work.questions.length >= QUESTIONS_MAX}
          onPress={() => { update(d => addQuestion(d, newQ, newId('q'))); setNewQ(''); }}
          testID="q-add"
        />
      </Collapsible>

      <Field label="Заметки по объекту" value={work.notes} multiline onChangeText={x => update(d => ({ ...d, notes: x }))} testID="job-notes" />

      <Text style={s.h}>Сдать и отчёт</Text>
      <Card>
        {gaps.length ? (
          <View style={[s.short, s.shortBad]} testID="job-gaps">
            <Text style={[s.shortTitle, { color: colors.warnText }]}>Не хватает до сдачи</Text>
            {gaps.map(g => <Text key={g} style={s.shortLine}>{`• ${g}`}</Text>)}
            <Text style={s.shortNone}>Отчёт можно отправить и так — пробелы в нём будут видны.</Text>
          </View>
        ) : <Notice kind="ok" text="Всё на месте: заказ, трак, фото по шагам, сюрпризы отправлены." testID="job-gaps" />}
        <Text style={s.sub}>Язык отчёта</Text>
        <View style={s.row}>
          {(['en', 'ru'] as const).map(l => (
            <View key={l} style={s.cell}>
              <Button title={l === 'en' ? 'English' : 'Русский'} kind={reportLang === l ? 'primary' : 'secondary'} onPress={() => setLang(l)} testID={`lang-${l}`} />
            </View>
          ))}
        </View>
        <Muted>Заголовки и итоги — на выбранном языке. Ваши заметки и тексты сюрпризов уходят как написаны.</Muted>
        {Platform.OS === 'web' ? (
          shareReady ? (
            <Button title={`📤  Отправить отчёт и ${shareReady.files.length - 1} фото`} onPress={() => void onShare()} testID="job-share" />
          ) : (
            <Button title="📤  Подготовить отчёт с фото" onPress={() => void onPrepareShare()} testID="job-share-prepare" />
          )
        ) : null}
        {Platform.OS === 'web' ? <Button title="Скопировать текст отчёта" kind="secondary" onPress={() => void onCopy()} testID="job-copy" /> : null}
        <Button title={Platform.OS === 'web' ? 'Скачать отчёт (.txt)' : 'Отправить отчёт'} kind="secondary" onPress={onReport} testID="job-report" />
        <Muted>«Отправить» открывает меню телефона: WhatsApp, почта, сообщения. Фото идут отдельными файлами.</Muted>
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
