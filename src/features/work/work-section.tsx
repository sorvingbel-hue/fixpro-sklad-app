// Раздел «Работа» во вкладке «Смена»: рабочий режим из веб-пилота dot v0.3 внутри «Формана».
// Сверка трака → вопросы → этапы → бригада → заметки → отчёт. Сохраняется сам (через ~0,7 с
// после правки): сначала на устройство, затем в базу команды. Логика — в ./work-model.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { getDoc, saveDoc, useSyncStatus } from '@/lib/sync';
import { colors, font, space } from '@/lib/theme';

import { Checkbox, Collapsible, Segments } from '../training/parts';
import { exportText } from '../training/share';
import { V03_COL, V03_JOB, type V03Item, type V03Team, type WorkV03Doc } from './import-v03';
import {
  addTeam, buildWorkReport, normalizeWork, removeTeam, seedWork, setCheck, setItem, setQuestion, setTeam,
  summarize, TEAM_MAX, verdict,
} from './work-model';

type SaveState = 'idle' | 'saving' | 'local' | 'cloud' | 'fail';
const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Сохраняю…',
  local: 'Сохранено на этом устройстве',
  cloud: 'Сохранено и отправлено команде',
  fail: 'Не удалось сохранить — записи остаются на экране, попробуйте ещё раз',
};

function confirmAction(text: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(text)) onYes();
    return;
  }
  Alert.alert(text, undefined, [{ text: 'Отмена', style: 'cancel' }, { text: 'Да', style: 'destructive', onPress: onYes }]);
}

export function WorkSection() {
  const status = useSyncStatus();
  const team = status.team?.space ?? '';
  const [doc, setDoc] = useState<WorkV03Doc | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = useRef<WorkV03Doc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Загрузка при открытии и при смене команды
  useEffect(() => {
    let alive = true;
    dirty.current = false;
    getDoc<WorkV03Doc>(V03_COL, V03_JOB).then(d => {
      if (!alive || dirty.current) return;
      const next = normalizeWork(d) ?? seedWork();
      latest.current = next;
      setDoc(next);
    }).catch(() => {
      if (!alive) return;
      const next = seedWork();
      latest.current = next;
      setDoc(next);
    });
    return () => { alive = false; };
  }, [team]);

  const flush = useCallback(async () => {
    timer.current = null;
    const d = latest.current;
    if (!d) return;
    setSave('saving');
    try {
      const r = await saveDoc(V03_COL, d.job, d);
      setSave(!r.ok ? 'fail' : r.synced ? 'cloud' : 'local');
    } catch {
      setSave('fail');
    }
  }, []);

  // Сохранить незаписанное при уходе с экрана
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); void flush(); }
  }, [flush]);

  const update = useCallback((fn: (d: WorkV03Doc) => WorkV03Doc) => {
    const cur = latest.current;
    if (!cur) return;
    const next = { ...fn(cur), updated: new Date().toISOString() };
    latest.current = next;
    dirty.current = true;
    setDoc(next);
    setReportMsg(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  if (!doc) return <Muted>Загружаю смену…</Muted>;

  const sum = summarize(doc);
  const web = Platform.OS === 'web';

  async function onReport() {
    const d = latest.current;
    if (!d) return;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const ok = await exportText(buildWorkReport(d, now), `smena-${d.job}-${day}.txt`, `Отчёт смены ${d.job}`);
    setReportMsg(ok ? (web ? { ok: true, text: 'Отчёт скачан файлом .txt' } : null) : { ok: false, text: 'Не удалось сформировать отчёт' });
  }

  function onNewShift() {
    confirmAction('Начать новую смену? Текущие записи будут заменены шаблоном. Сначала сохраните отчёт.', () => update(() => seedWork()));
  }

  return (
    <View style={s.wrap} testID="work-section">
      <Card title={`Смена ${doc.job}`}>
        <Muted>{doc.source === 'dot-pilot-0.3' ? 'Перенесена из веб-пилота v0.3.' : 'Пробная смена: данные вымышленные, замените своими.'}</Muted>
        <Text style={s.sum}>{`Позиции: ${sum.ok} сверено, ${sum.bad} проблем из ${sum.items} · Вопросы открыты: ${sum.questionsOpen} · Этапы: ${sum.checksDone}/${sum.checksTotal}${sum.teamBlocked ? ` · Стоп в бригаде: ${sum.teamBlocked}` : ''}`}</Text>
        {save !== 'idle' ? <Notice kind={save === 'fail' ? 'warn' : save === 'saving' ? 'info' : 'ok'} text={SAVE_TEXT[save]} testID="work-save" /> : null}
      </Card>

      <Text style={s.h}>1. Сверка трака</Text>
      {doc.items.map(i => <ItemCard key={i.id} item={i} onChange={patch => update(d => setItem(d, i.id, patch))} />)}

      <Text style={s.h}>2. Вопросы до работы</Text>
      {doc.questions.map(q => (
        <Card key={q.id}>
          <Text style={s.title}>{q.text}</Text>
          <Field label="Ответ и откуда он получен" value={q.answer} multiline onChangeText={v => update(d => setQuestion(d, q.id, { answer: v }))} />
          <Checkbox
            label="Уточнено мной; ответ записан"
            checked={q.resolved}
            onChange={v => update(d => setQuestion(d, q.id, { resolved: v && !!q.answer.trim() }))}
            testID={`work-q-${q.id}`}
          />
          {!q.answer.trim() ? <Muted>Отметить «уточнено» можно после того, как записан ответ.</Muted> : null}
        </Card>
      ))}

      <Text style={s.h}>3. Этапы</Text>
      {doc.phases.map(p => (
        <Collapsible key={p.id} title={`${p.title} · ${p.checks.filter(c => doc.checks[c[0]]).length}/${p.checks.length}`} testID={`work-phase-${p.id}`}>
          {p.checks.map(([id, text]) => (
            <Checkbox key={id} label={text} checked={!!doc.checks[id]} onChange={v => update(d => setCheck(d, id, v))} testID={`work-check-${id}`} />
          ))}
        </Collapsible>
      ))}

      <Text style={s.h}>4. Бригада и передача готовности</Text>
      {doc.team.length === 0 ? <Muted>Назначений пока нет.</Muted> : null}
      {doc.team.map((t, k) => (
        <TeamCard
          key={k}
          row={t}
          onChange={patch => update(d => setTeam(d, k, patch))}
          onRemove={() => confirmAction('Удалить это назначение?', () => update(d => removeTeam(d, k)))}
        />
      ))}
      <Button
        title={doc.team.length >= TEAM_MAX ? `Не больше ${TEAM_MAX} назначений` : 'Добавить назначение'}
        kind="secondary"
        disabled={doc.team.length >= TEAM_MAX}
        onPress={() => update(addTeam)}
        testID="work-add-team"
      />

      <Text style={s.h}>5. Заметки</Text>
      <Field label="Заметки смены" value={doc.notes} multiline onChangeText={v => update(d => ({ ...d, notes: v }))} />

      <Button title={web ? 'Скачать отчёт смены (.txt)' : 'Отправить отчёт смены'} onPress={onReport} testID="work-report" />
      <Muted>Отчёт отражает ваши отметки на момент формирования. Это не независимый допуск к запуску.</Muted>
      {reportMsg ? <Notice kind={reportMsg.ok ? 'ok' : 'warn'} text={reportMsg.text} /> : null}
      <Button title="Начать новую смену" kind="secondary" onPress={onNewShift} testID="work-new" />
    </View>
  );
}

function ItemCard({ item, onChange }: { item: V03Item; onChange: (p: Partial<V03Item>) => void }) {
  const v = verdict(item);
  const req = item.required === null || item.required === '' ? '?' : String(item.required);
  return (
    <Card>
      <Text style={s.title}>{item.name}</Text>
      <Muted>{`Требуется: ${req} ${item.unit}. ${item.hint}`}</Muted>
      <View style={s.row}>
        <View style={s.cell}>
          <Field label="Заказано" value={item.ordered === null ? '' : String(item.ordered)} keyboardType="numeric" onChangeText={x => onChange({ ordered: x })} />
        </View>
        <View style={s.cell}>
          <Field label="В траке" value={item.actual === null ? '' : String(item.actual)} keyboardType="numeric" onChangeText={x => onChange({ actual: x })} />
        </View>
      </View>
      <Segments<V03Item['status']>
        items={[{ key: 'present', label: 'Есть' }, { key: 'missing', label: 'Нет' }, { key: 'unknown', label: 'Не проверял' }]}
        value={item.status}
        onChange={k => onChange({ status: k })}
      />
      <Field label="Где лежит" value={item.location} onChangeText={x => onChange({ location: x })} />
      <Field label="Замечание" value={item.note} multiline onChangeText={x => onChange({ note: x })} />
      <Notice kind={v.kind === 'ok' ? 'ok' : v.kind === 'bad' ? 'warn' : 'info'} text={v.text} testID={`work-verdict-${item.id}`} />
    </Card>
  );
}

function TeamCard({ row, onChange, onRemove }: { row: V03Team; onChange: (p: Partial<V03Team>) => void; onRemove: () => void }) {
  return (
    <Card>
      <Field label="Роль / исполнитель" value={row.role} onChangeText={x => onChange({ role: x })} />
      <Field label="Задача и критерий готовности" value={row.task} multiline onChangeText={x => onChange({ task: x })} />
      <Segments<V03Team['status']>
        items={[{ key: 'open', label: 'В работе' }, { key: 'blocked', label: 'Стоп' }, { key: 'done', label: 'Готово' }]}
        value={row.status}
        onChange={k => onChange({ status: k })}
      />
      <Field label="Проблема → следующий шаг → кто решает → до какого этапа" value={row.next} multiline onChangeText={x => onChange({ next: x })} />
      <Button title="Удалить назначение" kind="secondary" onPress={onRemove} />
    </Card>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.md },
  h: { fontSize: font.large, fontWeight: '800', color: colors.text, marginTop: space.sm },
  title: { fontSize: font.body, fontWeight: '700', color: colors.text },
  sum: { fontSize: font.small, color: colors.text, lineHeight: font.small * 1.4 },
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
});
