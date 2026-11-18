// Мелкие элементы экрана «Смена»: текст с **жирным**, подписи, выбор варианта, галочка,
// раскрывающийся блок, полоса прогресса, ссылка, переключатель разделов.
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { colors, font, radius, space, TAP_MIN, ui } from '@/lib/theme';

import { openLink } from './share';

// Текст, где **так** выделено жирным
export function Rich({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <Text style={style ?? ui.body}>
      {parts.map((p, i) => (i % 2 ? <Text key={i} style={s.bold}>{p}</Text> : p))}
    </Text>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={ui.muted}>{children}</Text>;
}

// Список вариантов «выбери один». Порядок задаёт вызывающий (варианты перемешаны)
export function RadioList({
  options, value, onChange, disabled, label, testIDPrefix,
}: {
  options: { id: string; text: string }[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  label: string;
  testIDPrefix: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space.sm }}>
      {options.map(o => {
        const on = value === o.id;
        return (
          <Pressable
            key={o.id}
            testID={`${testIDPrefix}-${o.id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => [s.option, on && s.optionOn, disabled && on && s.optionDone, pressed && s.pressed]}>
            <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
            <Text style={[s.optionText, disabled && !on && { color: colors.muted }]}>{o.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [s.check, pressed && s.pressed]}>
      <View style={[s.box, checked && s.boxOn]}>{checked ? <Text style={s.tick}>✓</Text> : null}</View>
      <Text style={s.optionText}>{label}</Text>
    </Pressable>
  );
}

// Блок с заголовком-кнопкой: нажал — раскрылся
export function Collapsible({ title, open: initial = false, children, testID }: { title: string; open?: boolean; children: ReactNode; testID?: string }) {
  const [open, setOpen] = useState(initial);
  return (
    <View style={s.coll}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [s.collHead, pressed && s.pressed]}>
        <Text style={s.collArrow}>{open ? '▾' : '▸'}</Text>
        <Text style={s.collTitle}>{title}</Text>
      </Pressable>
      {open ? <View style={s.collBody}>{children}</View> : null}
    </View>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <View
      style={s.bar}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: value }}>
      <View style={[s.barFill, { width: `${pct}%` }]} />
    </View>
  );
}

export function LinkButton({ name, url }: { name: string; url: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => void openLink(url)} style={({ pressed }) => [s.link, pressed && s.pressed]}>
      <Text style={s.linkText}>{name} ↗</Text>
    </Pressable>
  );
}

// Переключатель разделов внутри вкладки
export function Segments<K extends string>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={s.seg}>
      {items.map(it => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            testID={`seg-${it.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.key)}
            style={({ pressed }) => [s.segItem, on && s.segOn, pressed && s.pressed]}>
            <Text style={[s.segText, on && { color: colors.onPrimary }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bold: { fontWeight: '800' },
  eyebrow: { fontSize: 15, fontWeight: '800', color: colors.muted, letterSpacing: 0.4 },
  pressed: { opacity: 0.75 },
  option: {
    minHeight: TAP_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.infoBg },
  optionDone: { borderColor: colors.okText, backgroundColor: colors.okBg },
  optionText: { flex: 1, fontSize: font.body, lineHeight: font.body * 1.35, color: colors.text },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary },
  check: { minHeight: TAP_MIN, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  box: { width: 30, height: 30, borderRadius: 6, borderWidth: 2.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  boxOn: { backgroundColor: colors.primary },
  tick: { color: colors.onPrimary, fontSize: 20, fontWeight: '900', lineHeight: 24 },
  coll: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.bg, overflow: 'hidden' },
  collHead: { minHeight: TAP_MIN, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  collArrow: { fontSize: font.body, color: colors.primary, fontWeight: '800', width: 18 },
  collTitle: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text, lineHeight: font.body * 1.3 },
  collBody: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  bar: { height: 14, borderRadius: 7, backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.primary },
  link: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: font.small, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  seg: { flexDirection: 'row', gap: space.xs },
  segItem: {
    flex: 1,
    minHeight: TAP_MIN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  segOn: { backgroundColor: colors.primary },
  segText: { fontSize: font.small, fontWeight: '800', color: colors.primary, textAlign: 'center' },
});
