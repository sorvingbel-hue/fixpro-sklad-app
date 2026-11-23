// «Фото по шагам» (М3): 8 шагов монтажа, у каждого — «📷 Снять» и миниатюры. Одно нажатие — фото в этот шаг.
// Пустые шаги видны в «Сдать», но ничего не блокируют.
import { StyleSheet, Text, View } from 'react-native';

import { Button, Muted } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import { PHOTO_STEPS, stepPhotos, type Job, type JobPhoto, type PhotoKind } from './jobs-model';
import { PhotoGrid } from './photo-grid';

type Props = {
  job: Job;
  busy: boolean;
  onShoot: (step: string) => void;
  onDelete: (p: JobPhoto) => void;
  onKind: (p: JobPhoto, k: PhotoKind) => void;
};

export function StepsSection({ job, busy, onShoot, onDelete, onKind }: Props) {
  return (
    <View style={s.wrap} testID="steps">
      {PHOTO_STEPS.map((st, k) => {
        const ph = stepPhotos(job, st.id);
        return (
          <View key={st.id} style={[s.step, ph.length ? s.stepDone : null]} testID={`step-${st.id}`}>
            <Text style={s.title}>{`${ph.length ? '✓' : `${k + 1}.`} ${st.ru}${ph.length ? ` · ${ph.length}` : ''}`}</Text>
            <Muted>{st.hint}</Muted>
            <Button title={ph.length ? '📷  Ещё фото' : '📷  Снять'} kind={ph.length ? 'secondary' : 'primary'} onPress={() => onShoot(st.id)} disabled={busy} testID={`shoot-${st.id}`} />
            {ph.length ? <PhotoGrid photos={ph} onDelete={onDelete} onKind={onKind} empty="" /> : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  step: { gap: space.xs, padding: space.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg },
  stepDone: { borderColor: colors.okText, backgroundColor: colors.okBg },
  title: { fontSize: font.body, fontWeight: '800', color: colors.text },
});
