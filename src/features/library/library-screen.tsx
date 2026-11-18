// Вкладка «Установки»: библиотека пошаговых сценариев установок.
// Список сгруппирован по типам работ; нажатие открывает сценарий (этапы, стопы, чек-лист).
// Сценарий открывается внутри вкладки (без отдельного маршрута); «Назад» на Android возвращает к списку.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Muted, Notice, Screen } from '@/components/ui';
import { useSyncStatus } from '@/lib/sync';
import { colors, font, radius, space, TAP_MIN, ui } from '@/lib/theme';

import { countDone } from './checklist';
import { StatusBadge } from './components';
import { CLUSTERS, getScenarios } from './content';
import { loadAllProgress } from './progress';
import { ScenarioView } from './scenario-view';
import { lt } from './strings';
import type { Scenario } from './types';

export default function LibraryScreen() {
  const scenarios = getScenarios();
  const [openId, setOpenId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, string[]>>({});
  const team = useSyncStatus().team?.space ?? '';

  // Отметки чек-листов этого устройства — для строки «Отмечено N из M» в списке
  useEffect(() => {
    if (openId) return;
    let alive = true;
    loadAllProgress().then(p => { if (alive) setProgress(p); });
    return () => { alive = false; };
  }, [openId, team]);

  // Android: системная кнопка «Назад» закрывает сценарий (только пока вкладка на экране)
  useFocusEffect(
    useCallback(() => {
      if (!openId || Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => { setOpenId(null); return true; });
      return () => sub.remove();
    }, [openId]),
  );

  const current = openId ? scenarios.find(s => s.id === openId) : undefined;
  if (current) return <ScenarioView key={current.id} scenario={current} onBack={() => setOpenId(null)} />;

  const drafts = scenarios.filter(s => s.status === 'черновик ИИ').length;
  return (
    <Screen title={lt('title')}>
      <Body>{lt('intro')}</Body>
      <Notice kind="warn" text={lt('disclaimer')} />
      <Muted>{lt('count', { n: scenarios.length, d: drafts })}</Muted>

      {CLUSTERS.map(c => {
        const list = scenarios.filter(s => s.cluster === c.id);
        if (!list.length) return null;
        return (
          <View key={c.id} style={{ gap: space.sm }}>
            <View style={s.clusterHead}>
              <Text style={ui.h2} accessibilityRole="header">{c.title}</Text>
              <Muted>{c.hint}</Muted>
            </View>
            {list.map(sc => <ScenarioItem key={sc.id} scenario={sc} done={progress[sc.id]} onPress={() => setOpenId(sc.id)} />)}
          </View>
        );
      })}
    </Screen>
  );
}

function ScenarioItem({ scenario, done, onPress }: { scenario: Scenario; done?: string[]; onPress: () => void }) {
  const holds = scenario.phases.reduce((n, p) => n + p.holdPoints.length, 0);
  const pr = done?.length ? countDone(scenario, done) : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={lt('open', { title: `${scenario.id}. ${scenario.title}` })}
      testID={`lib-item-${scenario.id}`}
      style={({ pressed }) => [s.item, pressed && { opacity: 0.75 }]}>
      <View style={s.itemTop}>
        <Text style={s.code}>{scenario.id}</Text>
        <StatusBadge status={scenario.status} />
      </View>
      <Text style={s.itemTitle}>{scenario.title}</Text>
      <Muted>{lt('meta', { p: scenario.phases.length, h: holds })}</Muted>
      {pr && pr.done > 0 ? <Text style={s.progress}>{lt('progress', pr)}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  clusterHead: { gap: 2, paddingTop: space.sm },
  item: {
    minHeight: TAP_MIN,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  code: { fontSize: font.small, fontWeight: '900', color: colors.primary, letterSpacing: 0.5 },
  itemTitle: { fontSize: font.body, fontWeight: '800', color: colors.text, lineHeight: font.body * 1.3 },
  progress: { fontSize: font.small, fontWeight: '800', color: colors.okText },
});
