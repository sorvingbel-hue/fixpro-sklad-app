// Раздел «Решения»: учебная смена из 10 шагов, итог, сброс.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance, type ViewInstance } from 'react-native';

import { Button, Notice } from '@/components/ui';
import { colors, font, radius, space, TAP_MIN, ui } from '@/lib/theme';

import { fill, type Lesson, type TrainingContent } from './content';
import {
  answerStep, countFirst, countPassed, goStep, isLocked, resetScenario, shuffled, type Progress,
} from './logic';
import { Collapsible, Eyebrow, LinkButton, ProgressBar, RadioList, Rich, Small } from './parts';
import type { SaveState } from './progress-store';
import type { RevealMode } from './use-reveal';

type Reveal = (top: ViewInstance | null, bottom: ViewInstance | null, mode: RevealMode) => Promise<void>;
type Props = {
  c: TrainingContent;
  progress: Progress;
  saveState: SaveState | null;
  save: (p: Progress) => Promise<void>;
  reveal: Reveal;
  onReport: () => void;
  reportLabel: string;
  finishReportLabel: string;
  reportMsg: { ok: boolean; text: string } | null;
};

// Состояние открытого шага: выбранный вариант, показан ли разбор, порядок вариантов
type Visit = { selected: string | null; feedback: boolean; order: string[] };
function makeVisit(p: Progress, lessons: Lesson[], i: number): Visit {
  const ans = p.answers[i];
  return { selected: ans, feedback: ans !== null, order: shuffled(lessons[i].options.map(o => o.id)) };
}

// Показать блок после того, как экран перерисовался
const later = (fn: () => void) => { setTimeout(fn, 80); };

export function LessonSection({ c, progress, saveState, save, reveal, onReport, reportLabel, finishReportLabel, reportMsg }: Props) {
  const lessons = c.lessons;
  const total = lessons.length;
  const index = progress.index;
  const l = lessons[index];
  const correct = progress.passed[index];
  const done = countPassed(progress);

  const [visit, setVisit] = useState<Visit>(() => makeVisit(progress, lessons, index));
  const [confirm, setConfirm] = useState(false);

  const stripRef = useRef<ViewInstance>(null);
  const feedbackRef = useRef<ViewInstance>(null);
  const actionsRef = useRef<ViewInstance>(null);
  const finishRef = useRef<ViewInstance>(null);
  const confirmRef = useRef<ViewInstance>(null);

  function go(i: number) {
    const next = goStep(progress, i);
    void save(next);
    setVisit(makeVisit(next, lessons, i)); // каждое открытие шага — новый порядок вариантов
    later(() => void reveal(stripRef.current, null, 'top'));
  }

  function onCheck() {
    if (visit.selected === null) return;
    void save(answerStep(progress, lessons, index, visit.selected));
    setVisit(v => ({ ...v, feedback: true }));
    // разбор и кнопка «Следующий шаг» должны быть видны
    later(() => void reveal(feedbackRef.current, actionsRef.current, 'span'));
  }

  function onNext() {
    if (index < total - 1) go(index + 1);
    else later(() => void reveal(finishRef.current, null, 'top'));
  }

  function onReset() {
    const fresh = resetScenario(progress, total);
    void save(fresh);
    setVisit(makeVisit(fresh, lessons, 0));
    setConfirm(false);
    later(() => void reveal(stripRef.current, null, 'top'));
  }

  function askReset() {
    setConfirm(true);
    later(() => void reveal(confirmRef.current, confirmRef.current, 'span'));
  }

  const options = visit.order
    .map(id => l.options.find(o => o.id === id))
    .filter((o): o is NonNullable<typeof o> => !!o);
  const chosen = l.options.find(o => o.id === visit.selected);
  const firstTry = countFirst(progress);
  const review = lessons.filter((_, i) => progress.first[i] === false).map(x => x.short);

  return (
    <>
      <View style={ui.card}>
        <Eyebrow>{c.scenario.eyebrow}</Eyebrow>
        <Text style={ui.h2} accessibilityRole="header">{c.scenario.title}</Text>
        <Text style={ui.body}>{c.scenario.text}</Text>
        <Small>{c.scenario.small}</Small>
      </View>

      <Collapsible title={c.safety.title} testID="safety-toggle">
        {c.safety.paragraphs.map((p, i) => <Text key={i} style={ui.body}>{p}</Text>)}
      </Collapsible>

      <View style={{ gap: space.xs }}>
        <View style={s.topline}>
          <Text style={s.progressText} testID="lesson-progress">{fill(c.ui.progress, { done, total })}</Text>
          {saveState ? <Text style={s.saveText} accessibilityLiveRegion="polite" testID="lesson-save">{c.ui.save[saveState]}</Text> : null}
        </View>
        <ProgressBar value={done} max={total} label={fill(c.ui.progress, { done, total })} />
      </View>

      <View ref={stripRef} collapsable={false}>
        <StepStrip lessons={lessons} progress={progress} onGo={go} lockedHint={c.ui.stepLocked} />
      </View>

      <View style={ui.card} testID="lesson-card">
        <Eyebrow>{fill(c.ui.stepEyebrow, { tag: l.tag, n: index + 1 })}</Eyebrow>
        <Text style={ui.h2} accessibilityRole="header" testID="lesson-title">{l.title}</Text>
        <View style={s.scene}><Text style={ui.body}>{l.scene}</Text></View>
        <Text style={s.question}>{l.question}</Text>
        <RadioList
          options={options}
          value={visit.selected}
          onChange={id => setVisit(v => ({ ...v, selected: id, feedback: false }))}
          disabled={correct}
          label={l.question}
          testIDPrefix="opt"
        />

        {visit.feedback && chosen ? (
          <View ref={feedbackRef} collapsable={false} style={[s.feedback, correct ? s.fbOk : s.fbBad]} testID="lesson-feedback" accessibilityLiveRegion="polite">
            <Text style={[s.fbTitle, { color: correct ? colors.okText : colors.warnText }]}>{correct ? c.ui.feedbackOk : c.ui.feedbackBad}</Text>
            <Text style={ui.body}>{correct ? l.why : chosen.wrong ?? ''}</Text>
            {correct ? <Rich text={`**${c.ui.remember}** ${l.take}`} /> : <Small>{c.ui.tryOther}</Small>}
            {l.sources.map(k => <LinkButton key={k} name={c.sources[k].name} url={c.sources[k].url} />)}
          </View>
        ) : null}

        <View ref={actionsRef} collapsable={false} style={s.actions}>
          {correct ? (
            <Button title={index === total - 1 ? c.ui.toFinish : c.ui.next} onPress={onNext} testID="lesson-next" />
          ) : (
            <Button title={c.ui.check} onPress={onCheck} disabled={visit.selected === null || visit.feedback} testID="lesson-check" />
          )}
          <Button title={c.ui.prev} kind="secondary" onPress={() => go(index - 1)} disabled={index === 0} testID="lesson-prev" />
        </View>
        <Small>{c.ui.notPermit}</Small>
      </View>

      {done === total ? (
        <View ref={finishRef} collapsable={false} style={[ui.card, s.finish]} testID="finish-card">
          <Eyebrow>{c.finish.eyebrow}</Eyebrow>
          <Text style={ui.h2} accessibilityRole="header">{c.finish.title}</Text>
          <Text style={ui.body}>{c.finish.text}</Text>
          <View style={s.grid}>
            <View style={s.gridItem}><Text style={s.big}>{done} / {total}</Text><Small>{c.finish.done}</Small></View>
            <View style={s.gridItem}><Text style={s.big}>{firstTry} / {total}</Text><Small>{c.finish.firstTry}</Small></View>
          </View>
          <Text style={ui.body}>{review.length ? fill(c.finish.review, { list: review.join(' · ') }) : c.finish.allFirst}</Text>
          <Rich text={c.finish.practice} />
          <Button title={c.finish.reviewAll} kind="secondary" onPress={() => go(0)} testID="finish-review" />
          <Button title={finishReportLabel} kind="secondary" onPress={onReport} testID="finish-report" />
        </View>
      ) : null}

      <View style={s.footer}>
        <Small>{c.footer.privacy}</Small>
        <Button title={reportLabel} kind="secondary" onPress={onReport} testID="lesson-report" />
        {reportMsg ? <Notice kind={reportMsg.ok ? 'ok' : 'warn'} text={reportMsg.text} /> : null}
        <Button title={c.footer.restart} kind="secondary" onPress={askReset} testID="lesson-restart" />
        {confirm ? (
          <View ref={confirmRef} collapsable={false} style={s.confirm} testID="reset-confirm">
            <Text style={[ui.body, { color: colors.warnText, fontWeight: '700' }]}>{c.footer.confirm}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onReset}
              testID="reset-yes"
              style={({ pressed }) => [s.danger, pressed && { opacity: 0.75 }]}>
              <Text style={s.dangerText}>{c.footer.yes}</Text>
            </Pressable>
            <Button title={c.footer.no} kind="secondary" onPress={() => setConfirm(false)} testID="reset-no" />
          </View>
        ) : null}
      </View>
    </>
  );
}

// Полоса шагов: прокручивается так, чтобы открытый шаг был по центру
function StepStrip({ lessons, progress, onGo, lockedHint }: { lessons: Lesson[]; progress: Progress; onGo: (i: number) => void; lockedHint: string }) {
  const sv = useRef<ScrollViewInstance>(null);
  const pos = useRef<Record<number, { x: number; w: number }>>({});
  const width = useRef(0);
  const active = progress.index;

  const center = useCallback((animated: boolean) => {
    const p = pos.current[active];
    if (!p || !sv.current || !width.current) return;
    sv.current.scrollTo({ x: Math.max(0, p.x - (width.current - p.w) / 2), animated });
  }, [active]);

  useEffect(() => { center(true); }, [center]);

  return (
    <ScrollView
      ref={sv}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={e => { width.current = e.nativeEvent.layout.width; center(false); }}
      contentContainerStyle={s.strip}
      testID="step-strip">
      {lessons.map((x, i) => {
        const current = i === active;
        const passed = progress.passed[i];
        const locked = isLocked(progress, i);
        return (
          <Pressable
            key={x.id}
            testID={`step-${i + 1}`}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}. ${x.short}${locked ? '. ' + lockedHint : ''}`}
            accessibilityState={{ selected: current, disabled: locked }}
            disabled={locked}
            onPress={() => onGo(i)}
            onLayout={e => {
              pos.current[i] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
              if (i === active) center(false);
            }}
            style={({ pressed }) => [s.chip, passed && s.chipPassed, current && s.chipCurrent, locked && s.chipLocked, pressed && { opacity: 0.75 }]}>
            <View style={[s.num, passed && s.numPassed, current && s.numCurrent]}>
              <Text style={[s.numText, current && { color: colors.primary }, passed && !current && { color: colors.onPrimary }]}>{passed ? '✓' : i + 1}</Text>
            </View>
            <Text style={[s.chipText, current && { color: colors.onPrimary }, locked && { color: colors.muted }]} numberOfLines={2}>{x.short}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  topline: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
  progressText: { fontSize: font.small, fontWeight: '800', color: colors.text },
  saveText: { fontSize: font.small, color: colors.muted },
  strip: { gap: space.sm, paddingVertical: space.xs, paddingHorizontal: 2 },
  chip: {
    minHeight: TAP_MIN,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  chipCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipPassed: { borderColor: colors.okText, backgroundColor: colors.okBg },
  chipLocked: { borderColor: colors.disabled, backgroundColor: colors.card },
  chipText: { fontSize: font.small, fontWeight: '700', color: colors.text, flexShrink: 1 },
  num: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  numCurrent: { borderColor: colors.onPrimary, backgroundColor: colors.onPrimary },
  numPassed: { borderColor: colors.okText, backgroundColor: colors.okText },
  numText: { fontSize: 15, fontWeight: '900', color: colors.primary },
  scene: { backgroundColor: colors.bg, borderLeftWidth: 5, borderLeftColor: colors.primary, borderRadius: radius.sm, padding: space.md },
  question: { fontSize: font.body, fontWeight: '800', color: colors.text, lineHeight: font.body * 1.35, marginTop: space.xs },
  feedback: { borderRadius: radius.sm, padding: space.md, gap: space.sm, borderWidth: 2 },
  fbOk: { backgroundColor: colors.okBg, borderColor: colors.okText },
  fbBad: { backgroundColor: colors.warnBg, borderColor: colors.warnText },
  fbTitle: { fontSize: font.body, fontWeight: '800' },
  actions: { gap: space.sm, marginTop: space.xs },
  finish: { borderColor: colors.okText, borderWidth: 2 },
  grid: { flexDirection: 'row', gap: space.sm },
  gridItem: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.md, gap: space.xs },
  big: { fontSize: font.title, fontWeight: '800', color: colors.text },
  footer: { gap: space.sm, paddingTop: space.sm },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.warnText, backgroundColor: colors.warnBg },
  danger: { minHeight: TAP_MIN, borderRadius: radius.sm, backgroundColor: colors.warnText, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  dangerText: { color: colors.onPrimary, fontSize: font.body, fontWeight: '800' },
});
