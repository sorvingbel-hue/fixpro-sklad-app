// «Законы Калифорнии» (из «Ещё»): экран поверх вкладок, со стрелкой «назад». Сам экран — @/features/laws/laws-screen.
import { Stack } from 'expo-router';

import Screen from '@/features/laws/laws-screen';

export default function RefRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Законы Калифорнии', headerBackTitle: 'Ещё' }} />
      <Screen />
    </>
  );
}
