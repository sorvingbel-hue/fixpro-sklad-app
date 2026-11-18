// Оформление: крупный шрифт, высокий контраст (читается на солнце), большие кнопки.
// Тема всегда светлая: на улице тёмная тема читается хуже.
import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#FFFFFF',
  card: '#F1F3F2',
  text: '#0B0F0E',        // почти чёрный: контраст с белым ~19:1
  muted: '#33403C',       // вторичный текст, контраст ~11:1
  border: '#55625E',
  primary: '#0A4A9E',     // кнопки и активная вкладка, белый текст на нём ~9:1
  onPrimary: '#FFFFFF',
  okBg: '#DDF2E3',
  okText: '#0B4F26',
  warnBg: '#FFE7D6',
  warnText: '#7A2600',
  infoBg: '#E3ECF8',
  infoText: '#0A3A7A',
  disabled: '#8C9894',
} as const;

// Размеры шрифта (pt). Основной текст 20 — читается на вытянутой руке.
export const font = {
  small: 17,
  body: 20,
  large: 24,
  title: 30,
  tab: 12,
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 14 } as const;

// Минимальный размер кнопки/зоны нажатия (рекомендация ≥ 48)
export const TAP_MIN = 56;
// Ширина колонки текста на широком экране (веб, планшет)
export const MAX_WIDTH = 720;

// Общие стили, которыми пользуются экраны и компоненты
export const ui = StyleSheet.create({
  h1: { fontSize: font.title, fontWeight: '800', color: colors.text, lineHeight: font.title * 1.2 },
  h2: { fontSize: font.large, fontWeight: '700', color: colors.text, lineHeight: font.large * 1.25 },
  body: { fontSize: font.body, color: colors.text, lineHeight: font.body * 1.4 },
  muted: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  input: {
    minHeight: TAP_MIN,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.text,
  },
});
