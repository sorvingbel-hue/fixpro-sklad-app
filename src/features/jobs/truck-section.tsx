// «Трак» (М2): «Всё загружено» одной кнопкой, дальше отмечать только то, чего нет.
// Позиция — одна строка: название, сколько нужно, «Есть / Нет». Подробности (заказано, в траке, где лежит,
// замечание) — по нажатию «Подробно», это прежняя карточка сверки (ItemCard).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { colors, font, radius, space, TAP_MIN } from '@/lib/theme';

import { Collapsible } from '../training/parts';
import type { V03Item, WorkV03Doc } from '../work/import-v03';
import { addItem, ITEMS_MAX, markAllLoaded, quantity, removeItem, setItem, setLoaded, verdict } from '../work/work-model';
import { ItemCard } from '../work/work-section';
import { newId } from './jobs-model';

type Props = {
  work: WorkV03Doc;
  update: (fn: (d: WorkV03Doc) => WorkV03Doc) => void;
  confirm: (text: string, onYes: () => void) => void;
};

const need = (i: V03Item) => {
  const q = quantity(i.required);
  return q === null ? '' : `${q} ${i.unit.replace(/\.$/, '')}`;
};

export function TruckSection({ work, update, confirm }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({ name: '', qty: '', unit: 'шт.' });
  const unchecked = work.items.filter(i => i.status === 'unknown').length;
  const missing = work.items.filter(i => verdict(i).kind === 'bad');

  return (
    <View style={s.wrap} testID="truck">
      {work.items.length === 0 ? (
        <Notice kind="info" text="Список пуст. «Разобрать» скрин заказа выше или добавьте позиции вручную ниже." />
      ) : (
        <>
          {unchecked ? (
            <Button
              title={`✓  Всё загружено (${unchecked})`}
              onPress={() => update(markAllLoaded)}
              testID="truck-all"
            />
          ) : null}
          <Muted>
            {unchecked
              ? 'Нажмите, когда трак собран. Потом отметьте «Нет» только у того, чего не хватает.'
              : missing.length ? `Не хватает: ${missing.length}. Это уйдёт в отчёт офису.` : 'Всё отмечено. Недостачи нет.'}
          </Muted>
          {work.items.map(i => {
            const v = verdict(i);
            const st = i.status;
            return (
              <View key={i.id} style={[s.row, v.kind === 'bad' ? s.rowBad : st === 'present' ? s.rowOk : null]} testID={`truck-row-${i.id}`}>
                <Pressable style={s.name} onPress={() => setOpen(open === i.id ? null : i.id)} accessibilityRole="button" accessibilityLabel={`Подробно: ${i.name}`}>
                  <Text style={s.nameText} numberOfLines={3}>{i.name}</Text>
                  <Text style={s.meta}>{[need(i), v.kind === 'bad' ? v.text : '', open === i.id ? '▴ скрыть' : '▾ подробно'].filter(Boolean).join(' · ')}</Text>
                </Pressable>
                <View style={s.btns}>
                  <Pressable
                    onPress={() => update(d => setLoaded(d, i.id, true))}
                    style={[s.btn, st === 'present' ? s.btnOn : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: st === 'present' }}
                    testID={`truck-yes-${i.id}`}>
                    <Text style={[s.btnText, st === 'present' ? s.btnTextOn : null]}>Есть</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => update(d => setLoaded(d, i.id, false))}
                    style={[s.btn, st === 'missing' ? s.btnBad : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: st === 'missing' }}
                    testID={`truck-no-${i.id}`}>
                    <Text style={[s.btnText, st === 'missing' ? s.btnTextOn : null]}>Нет</Text>
                  </Pressable>
                </View>
                {open === i.id ? (
                  <View style={s.detail}>
                    <ItemCard item={i} onChange={patch => update(d => setItem(d, i.id, patch))} />
                    <Button title="Убрать позицию" kind="secondary" onPress={() => confirm(`Убрать «${i.name}» из списка?`, () => update(d => removeItem(d, i.id)))} testID={`item-remove-${i.id}`} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      )}
      <Collapsible title="Добавить позицию вручную" open={work.items.length === 0} testID="truck-add">
        <Card>
          <Field label="Что (оборудование или материал)" value={newItem.name} onChangeText={x => setNewItem(n => ({ ...n, name: x }))} testID="item-new-name" />
          <View style={s.pair}>
            <View style={s.cell}><Field label="Нужно, кол-во" value={newItem.qty} keyboardType="numeric" onChangeText={x => setNewItem(n => ({ ...n, qty: x }))} testID="item-new-qty" /></View>
            <View style={s.cell}><Field label="Ед." value={newItem.unit} onChangeText={x => setNewItem(n => ({ ...n, unit: x }))} /></View>
          </View>
          <Button
            title={work.items.length >= ITEMS_MAX ? `Не больше ${ITEMS_MAX} позиций` : 'Добавить'}
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
      </Collapsible>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg },
  rowOk: { borderColor: colors.okText, backgroundColor: colors.okBg },
  rowBad: { borderColor: colors.warnText, backgroundColor: colors.warnBg },
  name: { flex: 1, minWidth: 160, minHeight: TAP_MIN, justifyContent: 'center' },
  nameText: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  btns: { flexDirection: 'row', gap: space.xs },
  btn: { minHeight: TAP_MIN, minWidth: 72, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  btnOn: { backgroundColor: colors.okText, borderColor: colors.okText },
  btnBad: { backgroundColor: colors.warnText, borderColor: colors.warnText },
  btnText: { fontSize: font.body, fontWeight: '800', color: colors.primary },
  btnTextOn: { color: colors.onPrimary },
  detail: { width: '100%', gap: space.xs },
  pair: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
});
