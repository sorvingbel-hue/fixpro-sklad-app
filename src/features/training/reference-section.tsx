// Раздел «Справка»: словарь, карманная схема с отчётом, планы и источники.
import { StyleSheet, Text, View } from 'react-native';

import { Button, Notice } from '@/components/ui';
import { colors, font, radius, space, ui } from '@/lib/theme';

import type { TrainingContent } from './content';
import { Eyebrow, LinkButton, Small } from './parts';

type Props = {
  c: TrainingContent;
  onReport: () => void;
  reportLabel: string;
  reportMsg: { ok: boolean; text: string } | null;
};

export function ReferenceSection({ c, onReport, reportLabel, reportMsg }: Props) {
  return (
    <>
      <View style={ui.card} testID="glossary">
        <Text style={ui.h2} accessibilityRole="header">{c.glossary.title}</Text>
        {c.glossary.items.map(g => (
          <View key={g.term} style={s.term}>
            <Text style={s.termName}>{g.term}</Text>
            <Text style={ui.body}>{g.def}</Text>
          </View>
        ))}
      </View>

      <View style={ui.card}>
        <Eyebrow>{c.pocket.eyebrow}</Eyebrow>
        <Text style={ui.h2} accessibilityRole="header">{c.pocket.title}</Text>
        {c.pocket.items.map((it, i) => (
          <View key={i} style={s.row}>
            <Text style={s.num}>{i + 1}.</Text>
            <Text style={[ui.body, { flex: 1 }]}><Text style={{ fontWeight: '800' }}>{it.lead}</Text> {it.text}</Text>
          </View>
        ))}
        <Small>{c.pocket.note}</Small>
        <Button title={reportLabel} onPress={onReport} testID="pocket-report" />
        {reportMsg ? <Notice kind={reportMsg.ok ? 'ok' : 'warn'} text={reportMsg.text} /> : null}
      </View>

      <View style={ui.card}>
        <Eyebrow>{c.roadmap.eyebrow}</Eyebrow>
        <Text style={ui.h2} accessibilityRole="header">{c.roadmap.title}</Text>
        {c.roadmap.items.map(it => (
          <View key={it.when} style={s.road}>
            <Text style={s.termName}>{it.when}</Text>
            <Text style={ui.body}>{it.what}</Text>
          </View>
        ))}
        <Small>{c.roadmap.note}</Small>
      </View>

      <View style={ui.card}>
        <Text style={ui.h2} accessibilityRole="header">{c.sourcesSection.title}</Text>
        <Small>{c.sourcesSection.checked}</Small>
        {c.sourcesSection.items.map(it => (
          <View key={it.url} style={s.source}>
            <LinkButton name={it.name} url={it.url} />
            <Small>{it.note}</Small>
          </View>
        ))}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  term: { gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  termName: { fontSize: font.body, fontWeight: '800', color: colors.primary },
  row: { flexDirection: 'row', gap: space.sm },
  num: { fontSize: font.body, fontWeight: '800', color: colors.text, lineHeight: font.body * 1.4, minWidth: 24 },
  road: { gap: 2, backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.md },
  source: { gap: 2 },
});
