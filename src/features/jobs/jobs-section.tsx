// Раздел «Объекты» во вкладке «Смена»: «Начать смену / Продолжить».
// Список объектов на этом устройстве → новый объект (минимум полей) или пример → экран объекта.
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import { seedWork, summarize } from '../work/work-model';
import { JobScreen } from './job-screen';
import { jobProgress, localTime, makeJob, sortJobs, upsertJob, validateJob, workForJob, type Job } from './jobs-model';
import { deleteJobData, loadJobs, loadWork, saveJobs, saveWork } from './jobs-store';
import { inAppBrowser, PHOTOS_SUPPORTED, requestPersist } from './photo-store';

const day = (iso: string) => localTime(iso).slice(0, 10);

export function JobsSection({ onTop }: { onTop?: () => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', orderNo: '' });
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<Record<string, ReturnType<typeof summarize>>>({});
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const inApp = inAppBrowser();
  const ref = useRef<Job[]>([]);

  const refresh = useCallback(async () => {
    const list = await loadJobs();
    ref.current = list;
    setJobs(list);
    const p: Record<string, ReturnType<typeof summarize>> = {};
    for (const j of list) p[j.id] = summarize(await loadWork(j.id));
    setProgress(p);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Сохранить карточку объекта: сразу на экран, потом в хранилище устройства
  const onJob = useCallback(async (j: Job) => {
    const next = sortJobs(upsertJob(ref.current, j));
    ref.current = next;
    setJobs(next);
    return saveJobs(next);
  }, []);

  function openJob(id: string | null) {
    setOpenId(id);
    onTop?.();
  }

  async function create(example = false) {
    setTried(true);
    setMsg(null);
    const input = example ? { title: 'Пример: замена печи (вымышленные данные)', orderNo: 'DEMO-01' } : form;
    if (!validateJob(input).ok) return;
    const j = { ...makeJob(input), ...(example ? { example: true } : {}) };
    const ok = (await onJob(j)) && (await saveWork(workForJob(seedWork(), j.id, { example })));
    if (!ok) { setMsg({ ok: false, text: 'Не удалось сохранить на этом устройстве. Возможно, браузер в приватном режиме — откройте обычную вкладку.' }); return; }
    setForm({ title: '', orderNo: '' });
    setTried(false);
    if (!example) void requestPersist().then(setPersisted); // попросить браузер не стирать данные сам
    openJob(j.id);
  }

  async function onDelete(j: Job) {
    await deleteJobData(j);
    const next = ref.current.filter(x => x.id !== j.id);
    ref.current = next;
    setJobs(next);
    await saveJobs(next);
    openJob(null);
    setMsg({ ok: true, text: `Объект «${j.title}» удалён.` });
  }

  if (!jobs) return <Muted>Загружаю объекты…</Muted>;

  const open = openId ? jobs.find(j => j.id === openId) : null;
  if (open) {
    return <JobScreen job={open} onJob={onJob} onBack={() => { openJob(null); void refresh(); }} onDelete={onDelete} />;
  }

  const v = validateJob(form);

  return (
    <View style={s.wrap} testID="jobs-section">
      {jobs.length ? (
        <>
          <Text style={s.h}>Продолжить</Text>
          {jobs.map(j => {
            const p = jobProgress(j, progress[j.id] ?? null);
            return (
              <Card key={j.id}>
                <Text style={s.title}>{j.example ? `ДЕМО · ${j.title}` : j.title}</Text>
                <Muted>{`${j.orderNo ? `Заказ ${j.orderNo} · ` : ''}начат ${day(j.createdAt)}`}</Muted>
                <Text style={s.steps}>{p.steps.map(x => `${x.done ? '✓' : '○'} ${x.label}`).join('   ')}</Text>
                <Muted>{`Фото ${p.photos} · скрин заказа ${p.orders} · сверка ${p.itemsOk}/${p.items} · этапы ${p.checksDone}/${p.checksTotal}`}</Muted>
                <Button title="Продолжить" onPress={() => openJob(j.id)} testID={`job-open-${j.id}`} />
              </Card>
            );
          })}
        </>
      ) : (
        <Card title="Форман — помощник бригадира HVAC">
          <Text style={s.lead}>Работа на сегодня: заказ, трак, фото, этапы и отчёт офису — в одном месте. Как это работает:</Text>
          <Text style={s.list}>{'1. Создайте объект — хватит названия.\n2. Добавьте фото и скрин заказа.\n3. Сверьте заказ и трак, пройдите этапы.\n4. Откройте итог и скачайте отчёт.'}</Text>
        </Card>
      )}

      <Card title={jobs.length ? 'Новый объект' : 'Новый объект — шаг 1'}>
        <Field label="Как вы называете объект *" value={form.title} onChangeText={t => setForm(f => ({ ...f, title: t }))} placeholder="Напр.: замена печи, Клермонт" testID="new-title" />
        {tried && v.errors.title ? <Notice kind="warn" text={v.errors.title} testID="new-title-error" /> : null}
        <Field label="№ заказа (Orcatec) — если есть" value={form.orderNo} onChangeText={t => setForm(f => ({ ...f, orderNo: t }))} testID="new-order" />
        <Button title="Начать по-настоящему" onPress={() => void create()} testID="new-create" />
        <Muted>Всё хранится только на этом телефоне, в этом браузере. В базу команды не уходит.</Muted>
      </Card>

      {!jobs.some(j => j.example) ? (
        <Button title="Посмотреть пример (ДЕМО)" kind="secondary" onPress={() => void create(true)} testID="new-example" />
      ) : null}
      {msg ? <Notice kind={msg.ok ? 'ok' : 'warn'} text={msg.text} /> : null}

      {inApp ? (
        <Notice kind="warn" text={`Ссылка открыта внутри ${inApp}. У него своё хранилище — данные могут пропасть. Откройте ссылку в Safari или Chrome (меню «…» → «Открыть в браузере»).`} testID="inapp-warn" />
      ) : null}
      {PHOTOS_SUPPORTED ? (
        <Card title="Чтобы данные не пропали">
          <Text style={s.list}>{'iPhone: кнопка «Поделиться» → «На экран „Домой“». Открывайте «Форман» с этой иконки.\nAndroid: меню ⋮ → «Добавить на главный экран».'}</Text>
          <Muted>Без этого Safari может сам стереть данные сайта, если неделю не заходить. Данные хранятся только на этом телефоне.</Muted>
          {persisted === true ? <Notice kind="ok" text="Браузер обещал не стирать данные сам." /> : null}
        </Card>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.md },
  h: { fontSize: font.large, fontWeight: '800', color: colors.text },
  title: { fontSize: font.body, fontWeight: '800', color: colors.text },
  lead: { fontSize: font.body, fontWeight: '700', color: colors.text },
  list: { fontSize: font.body, color: colors.text, lineHeight: font.body * 1.5 },
  steps: { fontSize: font.small, fontWeight: '700', color: colors.infoText, backgroundColor: colors.infoBg, borderRadius: radius.sm, padding: space.sm, overflow: 'hidden' },
});
