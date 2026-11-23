// Вкладка «Смена»: объекты смены (раздел «Объекты», ../jobs — начать/продолжить, фото, сверка, этапы, итог),
// и общая «Заметка смены» команды. Тексты — в ./content (по языкам), логика — в ./logic.ts.
import { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncBadge } from '@/components/sync-badge';
import { getLanguage, t } from '@/lib/i18n';
import { colors, font, MAX_WIDTH, radius, space, ui } from '@/lib/theme';

import { fill, getTrainingContent } from './content';
import { LessonSection } from './lesson-section';
import { buildReport, fileDate } from './logic';
import { Eyebrow, Segments, Small } from './parts';
import { PracticeSection } from './practice-section';
import { useTrainingProgress } from './progress-store';
import { ReferenceSection } from './reference-section';
import { exportText } from './share';
import { JobsSection } from '../jobs/jobs-section';
import { useRevealScroll } from './use-reveal';

type Seg = 'work' | 'steps' | 'practice' | 'ref';

// mode 'work' — вкладка «Работы»: только объекты (рабочая версия, без обучалки).
// mode 'learn' — «Обучение» из «Ещё»: Решения · Практика · Справка (код обучалки не тронут, просто убран с главного экрана).
export default function TrainingScreen({ mode = 'work' }: { mode?: 'work' | 'learn' }) {
  const c = getTrainingContent(getLanguage());
  const { progress, loaded, saveState, save } = useTrainingProgress(c.lessons);
  const { viewport, scroll, content, reveal } = useRevealScroll();
  const [seg, setSeg] = useState<Seg>(mode === 'work' ? 'work' : 'steps');
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const segRef = useRef<ViewInstance>(null);

  const web = Platform.OS === 'web';
  const reportLabel = web ? c.ui.reportWeb : c.ui.reportNative;
  const finishReportLabel = web ? c.finish.reportWeb : c.finish.reportNative;

  async function onReport() {
    const now = new Date();
    const ok = await exportText(buildReport(progress, c, now), fill(c.report.fileName, { date: fileDate(now) }), c.report.shareTitle);
    setReportMsg(ok ? (web ? { ok: true, text: c.ui.reportDone } : null) : { ok: false, text: c.ui.reportFail });
  }

  // Открыли объект или вернулись к списку — к началу экрана (иначе остаётся прокрутка длинного списка)
  function toTop() {
    const go = () => scroll.current?.scrollTo({ y: 0, animated: false });
    go();
    setTimeout(go, 120);
    setTimeout(go, 450);
  }

  function onSeg(k: Seg) {
    setSeg(k);
    setReportMsg(null);
    // начало раздела — к верху экрана, если переключатель уже уехал вверх
    setTimeout(() => void reveal(segRef.current, null, 'top'), 80);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View ref={viewport} collapsable={false} style={s.viewport}>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled">
          <View ref={content} collapsable={false} style={s.scroll}>
            <View style={s.column}>
              <Text style={ui.h1} accessibilityRole="header">{mode === 'work' ? t('tab.work') : t('learn.title')}</Text>

              {seg !== 'work' ? <View style={s.hero}>
                <Eyebrow>{c.header.eyebrow}</Eyebrow>
                <Text style={s.heroTitle}>{c.header.title}</Text>
                <Text style={ui.body}>{c.header.lead}</Text>
                <View style={s.pills}>
                  {c.header.pills.map(p => <Text key={p} style={s.pill}>{p}</Text>)}
                </View>
              </View> : null}

              {mode === 'learn' ? <View ref={segRef} collapsable={false}>
                <Segments<Seg>
                  items={[
                    { key: 'steps', label: c.ui.segSteps },
                    { key: 'practice', label: c.ui.segPractice },
                    { key: 'ref', label: c.ui.segRef },
                  ]}
                  value={seg}
                  onChange={onSeg}
                />
              </View> : null}

              {seg === 'work' ? <JobsSection onTop={toTop} /> : null}
              {!loaded && seg !== 'work' ? <Small>{c.ui.loading}</Small> : null}
              {loaded && seg === 'steps' ? (
                <LessonSection
                  c={c}
                  progress={progress}
                  saveState={saveState}
                  save={save}
                  reveal={reveal}
                  onReport={onReport}
                  reportLabel={reportLabel}
                  finishReportLabel={finishReportLabel}
                  reportMsg={reportMsg}
                />
              ) : null}
              {loaded && seg === 'practice' ? <PracticeSection c={c} progress={progress} save={save} reveal={reveal} /> : null}
              {seg === 'ref' ? <ReferenceSection c={c} onReport={onReport} reportLabel={reportLabel} reportMsg={reportMsg} /> : null}

              <SyncBadge />
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  viewport: { flex: 1 },
  scroll: { padding: space.md, paddingBottom: space.xl },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.md },
  hero: { gap: space.sm },
  heroTitle: { fontSize: font.large, fontWeight: '800', color: colors.text, lineHeight: font.large * 1.25 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    fontSize: font.small,
    fontWeight: '700',
    color: colors.infoText,
    backgroundColor: colors.infoBg,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
});
