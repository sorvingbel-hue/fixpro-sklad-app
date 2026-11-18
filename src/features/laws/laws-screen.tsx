// Вкладка «Законы»: правила Калифорнии для HVAC-монтажа по этапам работы.
// Данные — content/laws.json (собрано из карты кодов v1, 18.11.2026). Поиск, фильтр по этапу, режим подготовки к C-20.
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Muted, Notice, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';
import { colors, font, radius, space, TAP_MIN, ui } from '@/lib/theme';

import data from '../../../content/laws.json';

type Rule = {
  id: string; stage: string; topic: string; req: string; citation: string; edition: string;
  when: string; url: string; checked: string; seen: boolean; exam: boolean; note?: string;
};

const RULES = (data as { cards: Rule[] }).cards;
const STAGES = [
  'дорога и парковка', 'приезд и объект', 'безопасность', 'монтаж', 'хладагент', 'электрика',
  'газ и дымоудаление', 'тесты и пуск', 'документы, permit и сдача', 'клиент', 'бизнес и лицензия',
];

function openSource(url: string) {
  if (!url) return;
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else WebBrowser.openBrowserAsync(url);
}

export default function LawsScreen() {
  const [stage, setStage] = useState<string>('');
  const [query, setQuery] = useState('');
  const [exam, setExam] = useState(false);
  const [open, setOpen] = useState<string>('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RULES.filter((r) =>
      (!stage || r.stage === stage) &&
      (!exam || r.exam) &&
      (!q || `${r.topic} ${r.req} ${r.citation}`.toLowerCase().includes(q)));
  }, [stage, query, exam]);

  return (
    <Screen title={t('laws.title')}>
      <Notice kind="warn" text={t('laws.disclaimer')} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Поиск: парковка, permit, R-454B…"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Поиск по правилам"
        style={ui.input}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        <Chip label="Все этапы" active={!stage} onPress={() => setStage('')} />
        {STAGES.map((st) => (
          <Chip key={st} label={st} active={stage === st} onPress={() => setStage(stage === st ? '' : st)} />
        ))}
      </ScrollView>
      <Chip label={exam ? '✓ Режим подготовки к C-20' : 'Режим подготовки к C-20'} active={exam} onPress={() => setExam(!exam)} />
      <Muted>{`Показано ${list.length} из ${RULES.length} · проверено 18.11.2026`}</Muted>
      {list.map((r) => {
        const isOpen = open === r.id;
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityState={{ expanded: isOpen }}
            onPress={() => setOpen(isOpen ? '' : r.id)}
            style={s.card}>
            <Text style={s.stage}>{r.stage}</Text>
            <Text style={s.topic}>{r.topic}</Text>
            <Text style={s.req} numberOfLines={isOpen ? undefined : 3}>{r.req}</Text>
            {isOpen ? (
              <View style={{ gap: space.xs }}>
                <Text style={s.meta}>{`Где: ${r.citation} (${r.edition})`}</Text>
                <Text style={s.meta}>{`Когда: ${r.when}`}</Text>
                <Text style={[s.meta, { color: r.seen ? colors.okText : colors.warnText }]}>
                  {r.seen ? 'Раздел прочитан в первоисточнике' : 'Раздел не проверен по первоисточнику'}
                </Text>
                {r.note ? <Notice kind="warn" text={`Поправка проверки: ${r.note}`} /> : null}
                <Pressable accessibilityRole="link" onPress={() => openSource(r.url)} style={s.link}>
                  <Text style={s.linkText}>{`Открыть источник · ${r.checked}`}</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: TAP_MIN, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.primary, backgroundColor: colors.bg, justifyContent: 'center', alignSelf: 'flex-start',
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, gap: space.xs, borderWidth: 1, borderColor: colors.border },
  stage: { fontSize: 14, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  topic: { fontSize: font.body, fontWeight: '700', color: colors.text },
  req: { fontSize: font.small, color: colors.text, lineHeight: font.small * 1.35 },
  meta: { fontSize: 15, color: colors.muted, lineHeight: 20 },
  link: { minHeight: TAP_MIN, justifyContent: 'center' },
  linkText: { fontSize: font.small, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
});
