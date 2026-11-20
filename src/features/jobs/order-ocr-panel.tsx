// «Разобрать» скрин заказа: распознавание на телефоне → один черновик рядом с исходным скрином → бригадир правит
// только спорные строки (флаги и повторы — первыми, раскрыты; уверенные — свёрнутым списком «ещё N строк») →
// «Подтвердить и добавить в сверку». До подтверждения сверка не меняется. Помеченные строки — оранжевые «проверь».
// Повтор (уже есть в сверке): «оставить» (по умолчанию) / «заменить количество» / «добавить отдельно» — молча не задваиваем.
// Ручной ввод в «3. Сверка» остаётся как был; распознавание — только помощник.
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space, ui } from '@/lib/theme';

import { Collapsible, ProgressBar } from '../training/parts';
import { newId, type JobPhoto } from './jobs-model';
import {
  cancelOcr, keepOcrOffline, OCR_FIRST, OCR_MANUAL, OCR_READY, OCR_SUPPORTED, OCR_WHERE, ocrOfflineReady, recognizeOrder, type OcrStage,
} from './order-ocr';
import {
  DRAFT_MAX, findExisting, FLAG_TEXT, nameKey, orphanNumbers, parseOrderLines, planConfirm, rowQty, toRows, type DraftRow, type Dropped, type DupChoice,
  type ExistingItem,
} from './order-parse';
import { photoBlob, photoUrl } from './photo-store';

function ask(text: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(text)) onYes();
    return;
  }
  Alert.alert(text, undefined, [{ text: 'Нет', style: 'cancel' }, { text: 'Да', style: 'destructive', onPress: onYes }]);
}

// grp — где строка в черновике (решается один раз, при разборе, чтобы строки не прыгали во время правки):
// top — спорная (флаг или повтор): первой и раскрыта; rest — уверенная: в свёрнутом списке; manual — добавлена вручную
type Row = DraftRow & { nameTouched?: boolean; grp: 'top' | 'rest' | 'manual' };
type Draft = {
  photoId: string; photoName: string; sample: boolean; w: number; h: number;
  rows: Row[]; dropped: Dropped[]; ms: number; loadMs: number; lines: number;
};
type Msg = { kind: 'ok' | 'warn' | 'info'; text: string };
type OrderRow = { name: string; qty: number | null; unit: string };

type Props = {
  orders: JobPhoto[];
  items: ExistingItem[]; // позиции, которые уже в сверке (повторы: оставить / заменить количество / добавить отдельно)
  addSample: () => Promise<{ ok: true; photo: JobPhoto } | { ok: false; reason: string }>;
  // add — новые позиции; replace — «заменить количество» у позиций сверки; sample — строки с вымышленного примера
  onConfirm: (p: { add: OrderRow[]; replace: { id: string; qty: number }[] }, sample: boolean) => { added: number; replaced: number; overLimit: number };
  onDraft?: (open: boolean) => void; // открыт / закрыт неподтверждённый черновик (экран спросит перед уходом)
};

const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
const show = (n: number | null | undefined) => (n === null || n === undefined ? '?' : String(n));
// 1 строка, 2 строки, 5 строк
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const strok = (n: number) => `${n} ${plural(n, 'строка', 'строки', 'строк')}`;

// Исходный скрин над черновиком: миниатюра → нажать → крупно во всю ширину (длинный скрин — прокруткой страницы)
function SourceShot({ id, w, h, zoom, onZoom }: { id: string; w: number; h: number; zoom: boolean; onZoom: (z: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    photoUrl(id, 'ocr').then(u => { if (alive) { setUrl(u); setMissing(!u); } });
    return () => { alive = false; };
  }, [id]);
  if (!url) return <Muted>{missing ? 'Исходный скрин не найден в этом браузере.' : 'Загружаю скрин…'}</Muted>;
  const ratio = w > 0 && h > 0 ? w / h : 0.5;
  return zoom ? (
    <View style={s.zoomWrap} testID="ocr-zoom">
      <Image source={{ uri: url }} style={[s.zoomImg, { aspectRatio: ratio }]} resizeMode="contain" accessibilityLabel="Исходный скрин заказа крупно" />
      <Button title="Свернуть скрин" kind="secondary" onPress={() => onZoom(false)} testID="ocr-zoom-close" />
    </View>
  ) : (
    <Pressable onPress={() => onZoom(true)} accessibilityRole="button" accessibilityLabel="Исходный скрин: нажмите, чтобы увеличить" style={({ pressed }) => [s.src, pressed && { opacity: 0.7 }]} testID="ocr-source">
      <Image source={{ uri: url }} style={s.srcImg} resizeMode="cover" />
      <View style={s.srcText}>
        <Text style={s.srcTitle}>Исходный скрин</Text>
        <Text style={s.srcHint}>🔍 Нажмите — откроется крупно, сверьте спорные строки</Text>
      </View>
    </Pressable>
  );
}

export function OrderOcrPanel({ orders, items, addSample, onConfirm, onDraft }: Props) {
  const [run, setRun] = useState<{ photoId: string; stage: OcrStage; pct: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [choice, setChoice] = useState<Record<string, DupChoice>>({}); // повторы: выбор по строке, по умолчанию «оставить»
  const [moreOpen, setMoreOpen] = useState(false); // уверенные строки раскрыты
  const [zoom, setZoom] = useState(false);
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
      // спорные — с флагом, уже есть в сверке или второй раз на этом скрине: первыми и раскрыты
      const seen = new Set<string>();
      const rows: Row[] = toRows(parsed.items, k => `${base}-${k}`).map(x => {
        const k = nameKey(x.name);
        const top = x.flags.length > 0 || !!findExisting(x.name, items) || (!!k && seen.has(k));
        seen.add(k);
        return { ...x, grp: top ? 'top' as const : 'rest' as const };
      });
      setChoice({});
      setMoreOpen(false);
      setZoom(false);
      setDraft({
        photoId: p.id, photoName: p.name, sample: !!p.sample, w: p.w, h: p.h,
        rows: [...rows.filter(x => x.grp === 'top'), ...rows.filter(x => x.grp === 'rest')],
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

  function onConfirmPress() {
    if (!draft) return;
    const plan = planConfirm(draft.rows, items, choice);
    const noName = plan.empty.filter(r => r.raw || r.qty.trim()).length; // название стёрто — не добавлена
    if (!plan.add.length && !plan.replace.length) {
      if (plan.keep.length || plan.dupInDraft.length) {
        setDraft(null);
        setMsg({ kind: 'ok', text: `Сверка не изменилась: все строки со скрина уже есть в сверке — оставлены как есть (${plan.keep.length + plan.dupInDraft.length}).` });
      } else {
        setMsg({ kind: 'warn', text: 'Добавлять нечего: в черновике нет строк с названием. Впишите название или нажмите «Отмена».' });
      }
      return;
    }
    const res = onConfirm({
      add: plan.add.map(r => ({ name: r.name.trim(), qty: rowQty(r.qty), unit: r.unit.trim() || 'шт.' })),
      replace: plan.replace.map(x => ({ id: x.id, qty: x.qty })),
    }, draft.sample);
    const noQty = plan.noQty.length;
    setDraft(null);
    setMsg({
      kind: res.overLimit || noName ? 'warn' : 'ok',
      text: [
        `Добавлено в сверку: ${res.added} (заказано = кол-во со скрина, источник — ${draft.sample ? 'ПРИМЕР скрина, вымышленный' : 'скрин заказа'}).`,
        res.replaced ? `Заменено количество: ${res.replaced}.` : '',
        plan.keep.length ? `Уже были в сверке — оставлены как есть: ${plan.keep.length}.` : '',
        plan.dupInDraft.length ? `Повторы на скрине не добавлены: ${plan.dupInDraft.length}.` : '',
        noQty ? `Без количества: ${noQty} — впишите в сверке.` : '',
        noName ? `Строки без названия не добавлены: ${noName}.` : '',
        res.overLimit ? `Не поместилось (в сверке не больше 40 позиций): ${res.overLimit}.` : '',
        'Теперь впишите «В траке» у каждой позиции в «3. Сверка».',
      ].filter(Boolean).join(' '),
    });
  }

  function onCancel() {
    ask('Отменить черновик? В сверку ничего не добавится.', () => {
      setDraft(null);
      setMsg({ kind: 'info', text: 'Черновик отменён — сверка не изменилась.' });
    });
  }

  const draftOpen = !!draft;
  const plan = draft ? planConfirm(draft.rows, items, choice) : null;
  const flagged = draft ? draft.rows.filter(r => (r.flags.includes('qty') && rowQty(r.qty) === null) || (r.flags.includes('name') && !r.nameTouched)).length : 0;

  // Повторы по каждой строке черновика (живые: правка названия или сверки сразу видна)
  const dupInfo = (rows: Row[]) => {
    const seen = new Set<string>();
    return rows.map(r => {
      const k = nameKey(r.name);
      const ex = findExisting(r.name, items);
      const twice = !ex && !!k && seen.has(k);
      if (k) seen.add(k);
      return { ex, twice };
    });
  };

  function editor(r: Row, k: number, d: { ex: ExistingItem | null; twice: boolean }, hidden: boolean) {
    const qtyWarn = r.flags.includes('qty') && rowQty(r.qty) === null;
    const nameWarn = r.flags.includes('name') && !r.nameTouched;
    const warn = qtyWarn || nameWarn;
    const c = choice[r.key] ?? 'keep';
    const q = rowQty(r.qty);
    const pick = (x: DupChoice) => setChoice(m => ({ ...m, [r.key]: x }));
    const mark = (x: DupChoice) => (c === x ? '●  ' : '○  ');
    return (
      <View key={r.key} style={[s.row, warn && s.rowWarn, !warn && (d.ex || d.twice) && s.rowDup, hidden && s.hidden]} testID={`ocr-row-${k}`}>
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
        {d.ex ? (
          <View style={s.dup} testID={`ocr-dup-${k}`}>
            <Text style={s.dupText} testID={`ocr-dupinfo-${k}`}>
              {`Уже есть в сверке: «${d.ex.name}» — заказано ${show(d.ex.qty)}${d.ex.actual !== null && d.ex.actual !== undefined ? `, в траке ${d.ex.actual}` : ''}. Что сделать?`}
            </Text>
            <Button title={`${mark('keep')}Оставить как есть`} kind={c === 'keep' ? 'primary' : 'secondary'} onPress={() => pick('keep')} testID={`ocr-dupkeep-${k}`} />
            <Button
              title={q === null ? 'Заменить количество — сначала впишите кол-во' : `${mark('replace')}Заменить количество: ${show(d.ex.qty)} → ${q}`}
              kind={c === 'replace' && q !== null ? 'primary' : 'secondary'}
              disabled={q === null}
              onPress={() => pick('replace')}
              testID={`ocr-duprepl-${k}`}
            />
            <Button title={`${mark('add')}Добавить отдельной позицией`} kind={c === 'add' ? 'primary' : 'secondary'} onPress={() => pick('add')} testID={`ocr-dupadd-${k}`} />
          </View>
        ) : d.twice ? (
          <View style={s.dup} testID={`ocr-dup-${k}`}>
            <Text style={s.dupText} testID={`ocr-dupinfo-${k}`}>Такая строка уже есть выше в этом черновике. Что сделать?</Text>
            <Button title={`${mark('keep')}Не добавлять второй раз`} kind={c !== 'add' ? 'primary' : 'secondary'} onPress={() => pick('keep')} testID={`ocr-dupkeep-${k}`} />
            <Button title={`${mark('add')}Добавить отдельной позицией`} kind={c === 'add' ? 'primary' : 'secondary'} onPress={() => pick('add')} testID={`ocr-dupadd-${k}`} />
          </View>
        ) : null}
        <Button title="Удалить строку" kind="secondary" onPress={() => setDraft(x => (x ? { ...x, rows: x.rows.filter((_, n) => n !== k) } : x))} testID={`ocr-del-${k}`} />
      </View>
    );
  }

  const dups = draft ? dupInfo(draft.rows) : [];
  const idx = draft ? draft.rows.map((r, k) => ({ r, k })) : [];
  const top = idx.filter(x => x.r.grp === 'top');
  const rest = idx.filter(x => x.r.grp === 'rest');
  const manual = idx.filter(x => x.r.grp === 'manual');
  const inSverka = dups.filter(x => x.ex).length;

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

      {draft && plan ? (
        <View style={s.draft} testID="ocr-draft">
          <Text style={s.draftTitle}>Черновик со скрина — проверьте спорные строки</Text>
          <Text style={s.stat} testID="ocr-stats">
            {`Найдено позиций: ${draft.rows.length} · проверить: ${flagged}${inSverka ? ` · уже в сверке: ${inSverka}` : ''} · строк пропущено: ${draft.dropped.length} · распознано за ${sec(draft.ms)}${draft.sample ? ' · ПРИМЕР (вымышленный)' : ''}`}
          </Text>
          <SourceShot id={draft.photoId} w={draft.w} h={draft.h} zoom={zoom} onZoom={setZoom} />
          <Notice kind="info" text="Сверка пока не изменилась. Поправьте спорные строки, при желании — остальные, и нажмите «Подтвердить»." />
          {orphanNumbers(draft.dropped) >= 2 ? (
            <Notice
              kind="warn"
              text={`Чисел отдельно от названий: ${orphanNumbers(draft.dropped)} — похоже, это фото экрана под углом: строки распались, эти количества не взяты. Сверьте по картинке и допишите недостающие строки вручную — или сделайте скриншот вместо фото.`}
              testID="ocr-orphans"
            />
          ) : null}
          {draft.rows.length === 0 ? (
            <Notice kind="warn" text="Позиции с количеством на скрине не найдены (другой формат или нечёткий скрин). Ничего не угадываю: добавьте строки вручную ниже или в «3. Сверка»." testID="ocr-empty" />
          ) : null}
          {top.length ? (
            <Text style={s.group} testID="ocr-top-title">{`⚠ Спорные строки — проверьте (${top.length})`}</Text>
          ) : rest.length ? (
            <Notice kind="ok" text="Спорных строк нет: всё прочитано уверенно. Всё равно сверьте глазами по скрину." testID="ocr-top-none" />
          ) : null}
          {top.map(({ r, k }) => editor(r, k, dups[k], false))}
          {rest.length ? (
            <View style={s.more} testID="ocr-rest">
              <Pressable
                onPress={() => setMoreOpen(o => !o)}
                accessibilityRole="button"
                accessibilityState={{ expanded: moreOpen }}
                style={({ pressed }) => [s.moreHead, pressed && { opacity: 0.7 }]}
                testID="ocr-more"
              >
                <Text style={s.moreTitle}>{moreOpen ? `▾  Ещё ${strok(rest.length)} без вопросов — свернуть` : `▸  Ещё ${strok(rest.length)} без вопросов — открыть и поправить`}</Text>
              </Pressable>
              {!moreOpen ? rest.map(({ r, k }) => (
                <Text key={r.key} style={s.line} testID={`ocr-line-${k}`}>{`• ${r.name.trim() || '(без названия)'} — ${r.qty.trim() || '?'} ${r.unit}`}</Text>
              )) : null}
              {rest.map(({ r, k }) => editor(r, k, dups[k], !moreOpen))}
            </View>
          ) : null}
          {manual.map(({ r, k }) => editor(r, k, dups[k], false))}
          <Button
            title={draft.rows.length >= DRAFT_MAX ? `Не больше ${DRAFT_MAX} строк` : '+ Добавить строку вручную'}
            kind="secondary"
            disabled={draft.rows.length >= DRAFT_MAX}
            onPress={() => setDraft(d => (d ? { ...d, rows: [...d.rows, { key: newId('dm'), name: '', qty: '', unit: 'шт.', flags: [], raw: '', confidence: 100, grp: 'manual' }] } : d))}
            testID="ocr-add-row"
          />
          {draft.dropped.length ? (
            <Collapsible title={`Пропущенные строки скрина (${draft.dropped.length}): итоги, цены, адреса, без количества`} testID="ocr-dropped">
              {draft.dropped.map((d, k) => <Muted key={k}>{`«${d.raw}» — ${d.why}`}</Muted>)}
            </Collapsible>
          ) : null}
          {plan.noQty.length ? <Notice kind="warn" text={`Без количества: ${plan.noQty.length}. Впишите количество или удалите строку. Можно добавить и без количества — впишете потом в сверке.`} testID="ocr-noqty" /> : null}
          <Text style={s.stat} testID="ocr-plan">
            {`При «Подтвердить»: добавится ${plan.add.length}${plan.replace.length ? `, заменится количество у ${plan.replace.length}` : ''}${plan.keep.length ? `, останутся как есть ${plan.keep.length} (уже в сверке)` : ''}${plan.dupInDraft.length ? `, повторы на скрине ${plan.dupInDraft.length} — не добавятся` : ''}.`}
          </Text>
          <Button title="✓  Подтвердить и добавить в сверку" onPress={onConfirmPress} testID="ocr-confirm" />
          <Button title="Отмена" kind="secondary" onPress={onCancel} testID="ocr-cancel" />
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
  group: { fontSize: font.body, fontWeight: '800', color: colors.warnText, marginTop: space.xs },
  src: { flexDirection: 'row', gap: space.md, alignItems: 'center', minHeight: 120, padding: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  srcImg: { width: 90, height: 120, borderRadius: radius.sm, backgroundColor: colors.bg },
  srcText: { flex: 1, gap: space.xs },
  srcTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  srcHint: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  zoomWrap: { gap: space.sm },
  zoomImg: { width: '100%', backgroundColor: colors.card, borderRadius: radius.sm },
  row: { gap: space.xs, padding: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  rowWarn: { backgroundColor: colors.warnBg, borderColor: colors.warnText, borderWidth: 3 },
  rowDup: { borderColor: colors.infoText, borderWidth: 3 },
  hidden: { display: 'none' },
  flag: { fontSize: font.body, fontWeight: '800', color: colors.warnText },
  nameInput: { minHeight: 84, textAlignVertical: 'top', paddingTop: space.sm },
  cells: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
  dup: { gap: space.sm, backgroundColor: colors.infoBg, borderRadius: radius.sm, padding: space.sm },
  dupText: { fontSize: font.body, fontWeight: '700', color: colors.infoText },
  more: { gap: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, padding: space.sm, backgroundColor: colors.card },
  moreHead: { minHeight: 56, justifyContent: 'center' },
  moreTitle: { fontSize: font.body, fontWeight: '800', color: colors.primary },
  line: { fontSize: font.small, fontWeight: '600', color: colors.text, lineHeight: font.small * 1.35 },
  note: { fontSize: font.small, fontWeight: '700', color: colors.warnText },
  ready: { fontSize: font.small, fontWeight: '700', color: colors.okText },
});
