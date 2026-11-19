// Корневой макет: запускает синхронизацию и показывает вкладки (группа (tabs)).
// Веб-версия с сайта: service worker для открытия без сети и полоса «Есть обновление» (UpdateBanner).
// Стек нужен, чтобы позже открывать экраны поверх вкладок (урок, карточка установки).
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { UpdateBanner } from '@/components/update-banner';
import { startSync } from '@/lib/sync';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  useEffect(() => { startSync(); }, []);
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      <UpdateBanner />
    </>
  );
}
