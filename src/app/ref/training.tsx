// «Обучение» (из «Ещё»): Решения · Практика · Справка. Экран поверх вкладок, со стрелкой «назад».
import { Stack } from 'expo-router';

import TrainingScreen from '@/features/training/training-screen';

export default function LearnRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Обучение', headerBackTitle: 'Ещё' }} />
      <TrainingScreen mode="learn" />
    </>
  );
}
