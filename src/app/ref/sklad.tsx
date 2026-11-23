// «Склад» (из «Ещё»): экран поверх вкладок, со стрелкой «назад». Сам экран — @/features/sklad/sklad-screen.
import { Stack } from 'expo-router';

import Screen from '@/features/sklad/sklad-screen';

export default function RefRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Склад', headerBackTitle: 'Ещё' }} />
      <Screen />
    </>
  );
}
