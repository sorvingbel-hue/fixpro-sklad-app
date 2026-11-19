// Полоса «Есть обновление» поверх экрана (веб-версия с service worker). Нажатие — включить новую версию.
// Заодно запускает регистрацию service worker (только веб и только сборка для сайта, см. lib/sw-update.ts).
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { applyUpdate, startServiceWorker, useUpdateState } from '@/lib/sw-update';
import { colors, font, MAX_WIDTH, radius, space, TAP_MIN } from '@/lib/theme';

export function UpdateBanner() {
  const state = useUpdateState();
  const insets = useSafeAreaInsets();
  useEffect(() => { startServiceWorker(); }, []);
  if (state !== 'ready') return null;
  return (
    <Pressable
      onPress={applyUpdate}
      accessibilityRole="button"
      accessibilityLabel="Есть обновление — нажмите, чтобы обновить"
      testID="sw-update"
      style={({ pressed }) => [s.bar, { top: insets.top + space.sm }, pressed && s.pressed]}>
      <Text style={s.text}>Есть обновление — нажмите, чтобы обновить</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    alignSelf: 'center',
    maxWidth: MAX_WIDTH,
    minHeight: TAP_MIN,
    zIndex: 1000,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  pressed: { opacity: 0.8 },
  text: { color: colors.onPrimary, fontSize: font.body, fontWeight: '800', textAlign: 'center' },
});
