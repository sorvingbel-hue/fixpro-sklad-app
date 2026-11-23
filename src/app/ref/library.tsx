// «Библиотека установок» (из «Ещё»): экран поверх вкладок, со стрелкой «назад». Сам экран — @/features/library/library-screen.
import { Stack } from 'expo-router';

import Screen from '@/features/library/library-screen';

export default function RefRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Библиотека установок', headerBackTitle: 'Ещё' }} />
      <Screen />
    </>
  );
}
