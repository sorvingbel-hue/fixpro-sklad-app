// «Разобрать» скрин заказа: распознавание на телефоне → черновик позиций → бригадир проверяет и правит →
// «Подтвердить и добавить в сверку». До подтверждения сверка не меняется. Помеченные строки — оранжевые «проверь».
// Ручной ввод в «3. Сверка» остаётся как был; распознавание — только помощник.
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space, ui } from '@/lib/theme';

import { Collapsible, ProgressBar } from '../training/parts';
import { newId, type JobPhoto } from './jobs-model';
import {
  cancelOcr, keepOcrOffline, OCR_FIRST, OCR_MANUAL, OCR_READY, OCR_SUPPORTED, OCR_WHERE, ocrOfflineReady, recognizeOrder, type OcrStage,
} from './order-ocr';
import {
  DRAFT_MAX, FLAG_TEXT, parseOrderLines, planConfirm, rowQty, toRows, type ConfirmPlan, type DraftRow, type Dropped,
} from './order-parse';
import { photoBlob, photoUrl } from './photo-store';

function ask(text: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(text)) onYes();
    return;
  }
  Alert.alert(text, undefined, [{ text: 'Нет', style: 'cancel' }, { text: 'Да', style: 'destructive', onPress: onYes }]);
}

type Row = DraftRow & { nameTouched?: boolean };
type Draft = { photoId: string; photoName: string; sample: boolean; rows: Row[]; dropped: Dropped[]; ms: number; loadMs: number; lines: number };
type Msg = { kind: 'ok' | 'warn' | 'info'; text: string };

type Props = {
  orders: JobPhoto[];
  itemNames: string[]; // названия позиций, которые уже в сверке (повторы)
  addSample: () => Promise<{ ok: true; photo: JobPhoto } | { ok: false; reason: string }>;
  // sample — строки с вымышленного примера: в сверке у них свой источник «скрин заказа (ПРИМЕР…)»
  onConfirm: (rows: { name: string; qty: number | null; unit: string }[], sample: boolean) => { added: number; overLimit: number };
  onDraft?: (open: boolean) => void; // открыт / закрыт неподтверждённый черновик (экран спросит перед уходом)
};

const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

function Preview({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    photoUrl(id, 'full').then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url ? <Image source={{ uri: url }} style={s.preview} resizeMode="contain" accessibilityLabel="Скрин заказа" /> : <Muted>Скрин не найден в этом браузере.</Muted>;
}

export function OrderOcrPanel({ orders, itemNames, addSample, onConfirm, onDraft }: Props) {
  const [run, setRun] = useState<{ photoId: string; stage: OcrStage; pct: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dup, setDup] = useState<ConfirmPlan | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [offline, setOffline] = useState(false); // модуль распознавания уже сохранён на телефоне
  // Номер текущего разбора: результат прежнего (остановленного, перебитого вторым нажатием) на экран не попадает.
  // Ref, а не состояние: два нажатия в одном такте видят его сразу.
  const runNo = useRef(0);
  const working = useRef(false);

  useEffect(() => () => cancelOcr(), []);
  useEffect(() => {
    let alive = true;
    if (OCR_SUPPORTED) void ocrOfflineReady().then(x => { if (alive) setOffline(x); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    onDraft?.(!!draft);
    return () => onDraft?.(false);
  }, [draft, onDraft]);

  const busy = !!run || sampleBusy;

  async function start(p: JobPhoto) {
    if (working.current) return; // второе нажатие, пока идёт разбор, — не начинаем новый
    working.current = true;
    const no = ++runNo.current;
    try {
      setMsg(null);
      setDup(null);
      setDraft(null);
      setRun({ photoId: p.id, stage: 'load', pct: 0 });
      const blob = await photoBlob(p.id);
      if (no !== runNo.current) return;
      if (!blob) {
        setRun(null);
        setMsg({ kind: 'warn', text: 'Скрин не найден в памяти этого браузера — добавьте его заново. ' + OCR_MANUAL });
        return;
      }
      const r = await recognizeOrder(blob, (stage, pct) => { if (no === runNo.current) setRun(x => (x ? { ...x, stage, pct } : x)); });
      if (no !== runNo.current) return;
      setRun(null);
      if (!r.ok) { setMsg({ kind: 'warn', text: r.reason }); return; }
      const parsed = parseOrderLines(r.lines);
      const base = newId('dr');
      setDraft({
        photoId: p.id, photoName: p.name, sample: !!p.sample, rows: toRows(parsed.items, k => `${base}-${k}`),
        dropped: parsed.dropped, ms: r.ms, loadMs: r.loadMs, lines: r.lines.length,
      });
      // разбор прошёл — файлы распознавания оставить на телефоне (если шли мимо service worker) → разбор без сети
      void keepOcrOffline().then(() => ocrOfflineReady()).then(x => setOffline(x));
    } finally {
      if (no === runNo.current) working.current = false;
    }
  }

  function stop() {
    runNo.current++; // результат остановленного разбора не показываем
    working.current = false;
    cancelOcr();
    setRun(null);
    setMsg({ kind: 'warn', text: 'Распознавание остановлено. ' + OCR_MANUAL });
  }

  async function trySample() {
    if (working.current || sampleBusy) return;
    setMsg(null);
    setSampleBusy(true);
    const r = await addSample();
    setSampleBusy(false);
    if (!r.ok) { setMsg({ kind: 'warn', text: r.reason }); return; }
    await start(r.photo);
  }

  const patchRow = (k: number, patch: Partial<Row>) => setDraft(d => (d ? { ...d, rows: d.rows.map((r, n) => (n === k ? { ...r, ...patch } : r)) } : d));

  function finish(plan: ConfirmPlan, withDupes: boolean) {
    if (!draft) return;
    const take = new Set([...plan.add, ...(withDupes ? [...plan.dupExisting, ...plan.dupInDraft] : [])]);
    const rows = draft.rows.filter(r => take.has(r));
    if (!rows.length) {
      setDup(null);
      setMsg({ kind: 'warn', text: 'Добавлять нечего: в черновике нет новых строк с названием. Впишите название или нажмите «Отмена».' });
      return;
    }
    const res = onConfirm(rows.map(r => ({ name: r.name.trim(), qty: rowQty(r.qty), unit: r.unit.trim() || 'шт.' })), draft.sample);
    const noQty = rows.filter(r => rowQty(r.qty) === null).length;
    const skippedDup = withDupes ? 0 : plan.dupExisting.length + plan.dupInDraft.length;
    const noName = plan.empty.filter(r => r.raw || r.qty.trim()).length; // название стёрто — не добавлена
    setDup(null);
    setDraft(null);
    setMsg({
      kind: res.overLimit || noName ? 'warn' : 'ok',
      text: [
        `Добавлено в сверку: ${res.added} (заказано = кол-во со скрина, источник — ${draft.sample ? 'ПРИМЕР скрина, вымышленный' : 'скрин заказа'}).`,
        noQty ? `Без количества: ${noQty} — впишите в сверке.` : '',
        skippedDup ? `Повторы не добавлены: ${skippedDup}.` : '',
        noName ? `Строки без названия не добавлены: ${noName}.` : '',
        res.overLimit ? `Не поместилось (в сверке не больше 40 позиций): ${res.overLimit}.` : '',
        'Теперь впишите «В траке» у каждой позиции в «3. Сверка».',
      ].filter(Boolean).join(' '),
    });
  }

  function onConfirmPress() {
    if (!draft) return;
    const plan = planConfirm(draft.rows, itemNames);
    if (plan.dupExisting.length || plan.dupInDraft.length) { setDup(plan); return; }
    finish(plan, false);
  }

  function onCancel() {
    ask('Отменить черновик? В сверку ничего не добавится.', () => {
      setDup(null);
      setDraft(null);
      setMsg({ kind: 'info', text: 'Черновик отменён — сверка не изменилась.' });
    });
  }

  const draftOpen = !!draft;
  const flagged = draft ? draft.rows.filter(r => (r.flags.includes('qty') && rowQty(r.qty) === null) || (r.flags.includes('name') && !r.nameTouched)).length : 0;
  const noQty = draft ? draft.rows.filter(r => r.name.trim() && rowQty(r.qty) === null).length : 0;

  return (
    <View style={s.wrap} testID="ocr-panel">
      <Text style={s.sub}>Разбор скрина заказа → позиции для сверки</Text>
      <Notice kind="info" text={OCR_WHERE} testID="ocr-where" />
      {OCR_SUPPORTED ? (offline ? <Text style={s.ready} testID="ocr-offline">{OCR_READY}</Text> : <Muted>{OCR_FIRST}</Muted>) : null}
      {OCR_SUPPORTED && !draftOpen ? (
        <>
          {orders.map(p => (
            <Button
              key={p.id}
              title={run?.photoId === p.id ? 'Идёт распознавание…' : `🔎  Разобрать: ${p.sample ? 'пример' : p.name}`}
              kind="secondary"
              disabled={busy}
              onPress={() => void start(p)}
              testID={`ocr-start-${p.id}`}
            />
          ))}
          <Button title={sampleBusy ? 'Добавляю пример…' : '🧪  Попробовать разбор на примере'} kind="secondary" disabled={busy} onPress={() => void trySample()} testID="ocr-sample" />
          <Muted>Пример — вымышленный скрин заказа: он добавится в объект один раз, с пометкой «ПРИМЕР» (настоящим заказом не считается), его можно удалить.</Muted>
        </>
      ) : null}

      {run ? (
        <View style={s.progress} testID="ocr-progress">
          <Text style={s.progressText} testID="ocr-progress-text">
            {run.stage === 'load' ? `Загружаю модуль распознавания… ${run.pct}%` : `Распознаю… ${run.pct}%`}
          </Text>
          <ProgressBar value={run.pct} max={100} label="Распознавание скрина" />
          <Muted>{run.stage === 'load' ? 'Первый раз — дольше: модуль скачивается с сайта «Формана». Скрин остаётся на телефоне.' : 'Текст читается на этом телефоне.'}</Muted>
          <Button title="Остановить" kind="secondary" onPress={stop} testID="ocr-stop" />
        </View>
      ) : null}

      {msg ? <Notice kind={msg.kind} text={msg.text} testID="ocr-msg" /> : null}

      {draft ? (
        <View style={s.draft} testID="ocr-draft">
          <Text style={s.draftTitle}>Черновик со скрина — проверьте каждую строку</Text>
          <Text style={s.stat} testID="ocr-stats">
            {`Найдено позиций: ${draft.rows.length} · проверить: ${flagged} · строк пропущено: ${draft.dropped.length} · распознано за ${sec(draft.ms)}${draft.sample ? ' · ПРИМЕР (вымышленный)' : ''}`}
          </Text>
          <Notice kind="info" text="Сверка пока не изменилась. Поправьте строки, удалите лишние, допишите недостающие — и нажмите «Подтвердить»." />
          {draft.rows.length === 0 ? (
            <Notice kind="warn" text="Позиции с количеством на скрине не найдены (другой формат или нечёткий скрин). Ничего не угадываю: добавьте строки вручную ниже или в «3. Сверка»." testID="ocr-empty" />
          ) : null}
          <Collapsible title="Скрин рядом — посмотреть" testID="ocr-preview">
            <Preview id={draft.photoId} />
          </Collapsible>
          {draft.rows.map((r, k) => {
            const qtyWarn = r.flags.includes('qty') && rowQty(r.qty) === null;
            const nameWarn = r.flags.includes('name') && !r.nameTouched;
            const warn = qtyWarn || nameWarn;
            return (
              <View key={r.key} style={[s.row, warn && s.rowWarn]} testID={`ocr-row-${k}`}>
                {warn ? (
                  <Text style={s.flag} testID={`ocr-flag-${k}`}>
                    {`⚠ ${[qtyWarn ? FLAG_TEXT.qty : '', nameWarn ? FLAG_TEXT.name : ''].filter(Boolean).join(', ')}`}
                  </Text>
                ) : null}
                <Field label="Название" value={r.name} multiline numberOfLines={2} style={[ui.input, s.nameInput]} onChangeText={x => patchRow(k, { name: x.replace(/\n/g, ' '), nameTouched: true })} testID={`ocr-name-${k}`} />
                <View style={s.cells}>
                  <View style={s.cell}>
                    <Field label="Кол-во" value={r.qty} keyboardType="numeric" placeholder={qtyWarn ? 'впишите' : ''} onChangeText={x => patchRow(k, { qty: x })} testID={`ocr-qty-${k}`} />
                  </View>
                  <View style={s.cell}>
                    <Field label="Ед." value={r.unit} onChangeText={x => patchRow(k, { unit: x })} testID={`ocr-unit-${k}`} />
                  </View>
                </View>
                {r.raw ? <Muted>{`Распознано: «${r.raw}»${qtyWarn ? ' — цифру количества не угадываю, посмотрите скрин' : ''}`}</Muted> : <Muted>Добавлено вручную</Muted>}
                {r.note && qtyWarn ? <Text style={s.note} testID={`ocr-note-${k}`}>{`Почему: ${r.note}`}</Text> : null}
                <Button title="Удалить строку" kind="secondary" onPress={() => setDraft(d => (d ? { ...d, rows: d.rows.filter((_, n) => n !== k) } : d))} testID={`ocr-del-${k}`} />
              </View>
            );
          })}
          <Button
            title={draft.rows.length >= DRAFT_MAX ? `Не больше ${DRAFT_MAX} строк` : '+ Добавить строку вручную'}
            kind="secondary"
            disabled={draft.rows.length >= DRAFT_MAX}
            onPress={() => setDraft(d => (d ? { ...d, rows: [...d.rows, { key: newId('dm'), name: '', qty: '', unit: 'шт.', flags: [], raw: '', confidence: 100 }] } : d))}
            testID="ocr-add-row"
          />
          {draft.dropped.length ? (
            <Collapsible title={`Пропущенные строки скрина (${draft.dropped.length}): итоги, цены, адреса, без количества`} testID="ocr-dropped">
              {draft.dropped.map((d, k) => <Muted key={k}>{`«${d.raw}» — ${d.why}`}</Muted>)}
            </Collapsible>
          ) : null}
          {noQty ? <Notice kind="warn" text={`Без количества: ${noQty}. Впишите количество или удалите строку. Можно добавить и без количества — впишете потом в сверке.`} testID="ocr-noqty" /> : null}
          {dup ? (
            <View style={s.dup} testID="ocr-dup">
              <Text style={s.dupText}>
                {[
                  dup.dupExisting.length ? `Уже есть в сверке: ${dup.dupExisting.map(r => r.name.trim()).join('; ')}.` : '',
                  dup.dupInDraft.length ? `Дважды в черновике: ${dup.dupInDraft.map(r => r.name.trim()).join('; ')}.` : '',
                  'Добавить повторы ещё раз?',
                ].filter(Boolean).join(' ')}
              </Text>
              <Button title={`Без повторов — добавить ${dup.add.length}`} onPress={() => finish(dup, false)} testID="ocr-dup-skip" />
              <Button title="Добавить всё, и повторы тоже" kind="secondary" onPress={() => finish(dup, true)} testID="ocr-dup-all" />
              <Button title="Назад к черновику" kind="secondary" onPress={() => setDup(null)} testID="ocr-dup-back" />
            </View>
          ) : (
            <>
              <Button title="✓  Подтвердить и добавить в сверку" onPress={onConfirmPress} testID="ocr-confirm" />
              <Button title="Отмена" kind="secondary" onPress={onCancel} testID="ocr-cancel" />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm, marginTop: space.sm },
  sub: { fontSize: font.body, fontWeight: '800', color: colors.text },
  progress: { gap: space.sm, backgroundColor: colors.infoBg, borderRadius: radius.sm, padding: space.md },
  progressText: { fontSize: font.large, fontWeight: '800', color: colors.infoText },
  draft: { gap: space.sm, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, padding: space.sm, backgroundColor: colors.bg },
  draftTitle: { fontSize: font.large, fontWeight: '800', color: colors.text },
  stat: { fontSize: font.small, fontWeight: '700', color: colors.text },
  preview: { width: '100%', height: 460, backgroundColor: colors.card },
  row: { gap: space.xs, padding: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  rowWarn: { backgroundColor: colors.warnBg, borderColor: colors.warnText, borderWidth: 3 },
  flag: { fontSize: font.body, fontWeight: '800', color: colors.warnText },
  nameInput: { minHeight: 84, textAlignVertical: 'top', paddingTop: space.sm },
  cells: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
  dup: { gap: space.sm, backgroundColor: colors.warnBg, borderRadius: radius.sm, padding: space.md },
  dupText: { fontSize: font.body, fontWeight: '700', color: colors.warnText },
  note: { fontSize: font.small, fontWeight: '700', color: colors.warnText },
  ready: { fontSize: font.small, fontWeight: '700', color: colors.okText },
});

