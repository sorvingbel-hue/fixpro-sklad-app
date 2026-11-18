// Простые общие элементы интерфейса: экран, карточка, кнопка, поле ввода, строка-сообщение.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, font, MAX_WIDTH, radius, space, TAP_MIN, ui } from '@/lib/theme';

// Экран вкладки: заголовок сверху, прокрутка, колонка не шире MAX_WIDTH
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.column}>
          <Text style={ui.h1} accessibilityRole="header">{title}</Text>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={ui.card}>
      {title ? <Text style={ui.h2} accessibilityRole="header">{title}</Text> : null}
      {children}
    </View>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={ui.body}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={ui.muted}>{children}</Text>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  testID?: string;
};

// Большая кнопка (высота ≥ TAP_MIN)
export function Button({ title, onPress, kind = 'primary', disabled, testID }: ButtonProps) {
  const primary = kind === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        primary ? s.btnPrimary : s.btnSecondary,
        disabled && s.btnDisabled,
        pressed && !disabled && s.pressed,
      ]}>
      <Text style={[s.btnText, { color: primary ? colors.onPrimary : colors.primary }, disabled && { color: colors.bg }]}>
        {title}
      </Text>
    </Pressable>
  );
}

// Поле ввода с подписью сверху
export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[ui.input, props.multiline && s.multiline]}
        {...props}
      />
    </View>
  );
}

// Строка-сообщение: ok — зелёная, warn — оранжевая, info — синяя
export function Notice({ kind = 'info', text, testID }: { kind?: 'ok' | 'warn' | 'info'; text: string; testID?: string }) {
  const c = kind === 'ok' ? [colors.okBg, colors.okText] : kind === 'warn' ? [colors.warnBg, colors.warnText] : [colors.infoBg, colors.infoText];
  return (
    <View style={[s.notice, { backgroundColor: c[0] }]} accessibilityLiveRegion="polite" testID={testID}>
      <Text style={[s.noticeText, { color: c[1] }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.md, paddingBottom: space.xl },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.md },
  btn: {
    minHeight: TAP_MIN,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnSecondary: { backgroundColor: colors.bg, borderColor: colors.primary },
  btnDisabled: { backgroundColor: colors.disabled, borderColor: colors.disabled },
  btnText: { fontSize: font.body, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.75 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.text },
  multiline: { minHeight: 120, textAlignVertical: 'top', paddingTop: space.sm },
  notice: { borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 48, justifyContent: 'center' },
  noticeText: { fontSize: font.small, fontWeight: '700', lineHeight: font.small * 1.35 },
});
