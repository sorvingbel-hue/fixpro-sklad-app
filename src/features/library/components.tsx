// Элементы вкладки «Установки»: значок статуса, текст со ссылками, этап (раскрывается),
// строка чек-листа, строка источника.
import * as WebBrowser from 'expo-web-browser';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, space, TAP_MIN, ui } from '@/lib/theme';

import { phaseItems } from './checklist';
import { plainText, sourceKind, splitRefs } from './refs';
import { formatDate, lt, statusLabel } from './strings';
import type { CheckItem, Phase, ScenarioStatus, Source } from './types';

// Открыть ссылку: в браузере — новая вкладка, на телефоне — встроенный браузер
export async function openLink(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
    else await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    return false;
  }
}

// ---------- значок статуса ----------

const STATUS_COLORS: Record<ScenarioStatus, [string, string]> = {
  'черновик ИИ': [colors.warnBg, colors.warnText],
  'надиктовано Георгием': [colors.infoBg, colors.infoText],
  'проверено': [colors.okBg, colors.okText],
};

export function StatusBadge({ status }: { status: ScenarioStatus }) {
  const [bg, fg] = STATUS_COLORS[status];
  return (
    <View style={[s.badge, { backgroundColor: bg, borderColor: fg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{statusLabel(status)}</Text>
    </View>
  );
}

// ---------- текст со ссылками [Н15] и пометками [не проверено] ----------

type RefTextProps = { text: string; style?: object; linked?: boolean };

// linked — ссылки нажимаются (в режиме чек-листа строку целиком занимает отметка, поэтому выключено)
export function RefText({ text, style, linked = true }: RefTextProps) {
  return (
    <Text style={[ui.body, style]}>
      {splitRefs(text).map((p, i, all) => {
        if (p.type === 'text') return p.value;
        // пробел между словом и скобкой или между двумя ссылками [Н1] [Н2]; не подчёркивается
        const prev = all[i - 1];
        const gap = prev && !(prev.type === 'text' && /\s$/.test(prev.value)) ? ' ' : '';
        if (p.type === 'tag') return <Text key={i}>{gap}<Text style={s.tag}>{'[' + p.value + ']'}</Text></Text>;
        return (
          <Text key={i}>
            {gap}
            <Text
              style={[s.ref, linked && s.refLink]}
              onPress={linked ? () => void openLink(p.source.url) : undefined}
              accessibilityRole={linked ? 'link' : undefined}
              accessibilityLabel={p.source.title}>
              {'[' + p.source.id + ']'}
            </Text>
          </Text>
        );
      })}
    </Text>
  );
}

// ---------- этап ----------

type PhaseProps = {
  index: number;
  phase: Phase;
  open: boolean;
  onToggle: () => void;
  checklist: boolean;            // режим «Чек-лист»
  done: Set<string>;
  onToggleItem: (key: string) => void;
};

export function PhaseSection({ index, phase, open, onToggle, checklist, done, onToggleItem }: PhaseProps) {
  const items = phaseItems(phase);
  const doneCount = items.filter(i => done.has(i.key)).length;
  const complete = items.length > 0 && doneCount === items.length;
  const counts = checklist
    ? lt('phase.progress', { done: doneCount, total: items.length })
    : lt('phase.counts', { s: phase.steps.length, h: phase.holdPoints.length, f: phase.photos.length });

  return (
    <View style={[s.phase, checklist && complete && s.phaseDone]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={`lib-phase-${index}`}
        style={({ pressed }) => [s.phaseHead, pressed && s.pressed]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.phaseTitle}>{`${index + 1}. ${phase.name}`}</Text>
          <Text style={[ui.muted, checklist && complete && { color: colors.okText, fontWeight: '700' }]}>
            {checklist && complete ? '✓ ' + counts : counts}
          </Text>
        </View>
        <Text style={s.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>

      {open ? (
        <View style={s.phaseBody}>
          {checklist
            ? items.map(it => <CheckRow key={it.key} item={it} checked={done.has(it.key)} onPress={() => onToggleItem(it.key)} />)
            : <PhaseRead phase={phase} />}
        </View>
      ) : null}
    </View>
  );
}

// Этап в режиме «Описание»: стопы, нумерованные шаги, что сфотографировать
function PhaseRead({ phase }: { phase: Phase }) {
  return (
    <View style={{ gap: space.sm }}>
      {phase.holdPoints.map((h, i) => <HoldPoint key={'h' + i} text={h} />)}
      {phase.steps.map((st, i) => (
        <View key={'s' + i} style={s.stepRow}>
          <Text style={s.stepNum}>{i + 1}.</Text>
          <View style={{ flex: 1 }}><RefText text={st} /></View>
        </View>
      ))}
      {phase.photos.length ? (
        <View style={s.photos}>
          <Text style={s.photosTitle}>{lt('photos')}</Text>
          {phase.photos.map((p, i) => <RefText key={'f' + i} text={'• ' + p} style={s.photoText} />)}
        </View>
      ) : null}
    </View>
  );
}

// Точка остановки: заметная оранжевая плашка
export function HoldPoint({ text }: { text: string }) {
  return (
    <View style={s.hold} accessibilityLabel={lt('hold') + ': ' + plainText(text)}>
      <Text style={s.holdLabel}>{lt('hold')}</Text>
      <RefText text={text} style={s.holdText} />
    </View>
  );
}

// ---------- строка чек-листа ----------

function CheckRow({ item, checked, onPress }: { item: CheckItem; checked: boolean; onPress: () => void }) {
  const hold = item.kind === 'hold';
  const prefix = hold ? lt('hold') + ': ' : item.kind === 'photo' ? lt('photo') + ': ' : '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={prefix + plainText(item.text)}
      testID={`lib-check-${item.key}`}
      style={({ pressed }) => [s.checkRow, hold && s.checkHold, checked && s.checkRowDone, pressed && s.pressed]}>
      <View style={[s.box, checked && s.boxOn]}>
        {checked ? <Text style={s.boxMark}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[ui.body, checked && { color: colors.muted }]}>
          {prefix ? <Text style={hold ? s.holdInline : s.photoInline}>{prefix}</Text> : null}
          <RefText text={item.text} linked={false} style={checked ? { color: colors.muted } : undefined} />
        </Text>
      </View>
    </Pressable>
  );
}

// ---------- источник ----------

const KIND_KEY = { norm: 'kind.norm', manual: 'kind.manual', ref: 'kind.ref', practice: 'kind.practice' } as const;

export function SourceRow({ source, onFail }: { source: Source; onFail: () => void }) {
  const kind = lt(KIND_KEY[sourceKind(source.id)]);
  const urls = [source.url, ...(source.alsoUrls ?? [])];
  return (
    <View style={s.source}>
      {urls.map((u, i) => (
        <Pressable
          key={u}
          onPress={async () => { if (!(await openLink(u))) onFail(); }}
          accessibilityRole="link"
          testID={i === 0 ? `lib-src-${source.id}` : undefined}
          style={({ pressed }) => [s.sourceLink, pressed && s.pressed]}>
          {i === 0 ? (
            <Text style={ui.body}>
              <Text style={s.sourceId}>{source.id}</Text>
              {' · ' + kind + ' · ' + source.title}
            </Text>
          ) : null}
          <Text style={s.sourceUrl} numberOfLines={1}>{hostOf(u)}</Text>
        </Pressable>
      ))}
      <Text style={[ui.muted, !source.checked && { color: colors.warnText }]}>
        {source.checked ? lt('source.checked', { date: formatDate(source.checked) }) : lt('source.unchecked')}
      </Text>
    </View>
  );
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/i);
  if (!m) return url;
  const path = (m[2] || '').replace(/\/$/, '');
  return m[1].replace(/^www\./i, '') + (path.length > 40 ? path.slice(0, 40) + '…' : path);
}

const s = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: font.small - 2, fontWeight: '800' },

  ref: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  refLink: { color: colors.primary, textDecorationLine: 'underline' },
  tag: { fontSize: font.small, color: colors.warnText, fontWeight: '700' },

  phase: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bg, overflow: 'hidden' },
  phaseDone: { borderColor: colors.okText },
  phaseHead: {
    minHeight: TAP_MIN + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.card,
  },
  phaseTitle: { fontSize: font.body, fontWeight: '800', color: colors.text, lineHeight: font.body * 1.3 },
  chevron: { fontSize: font.large, color: colors.primary, fontWeight: '800', width: 28, textAlign: 'center' },
  phaseBody: { padding: space.md, gap: space.sm, borderTopWidth: 1.5, borderTopColor: colors.border },
  pressed: { opacity: 0.7 },

  stepRow: { flexDirection: 'row', gap: space.sm },
  stepNum: { fontSize: font.body, fontWeight: '800', color: colors.muted, minWidth: 28, lineHeight: font.body * 1.4 },

  photos: { gap: space.xs, paddingTop: space.xs },
  photosTitle: { fontSize: font.small, fontWeight: '800', color: colors.infoText },
  photoText: { fontSize: font.small + 1, lineHeight: (font.small + 1) * 1.4 },

  hold: {
    backgroundColor: colors.warnBg,
    borderLeftWidth: 6,
    borderLeftColor: colors.warnText,
    borderRadius: radius.sm,
    padding: space.sm,
    paddingLeft: space.md,
    gap: 2,
  },
  holdLabel: { fontSize: font.small, fontWeight: '900', color: colors.warnText, letterSpacing: 1 },
  holdText: { color: colors.text, fontWeight: '600' },
  holdInline: { color: colors.warnText, fontWeight: '900' },
  photoInline: { color: colors.infoText, fontWeight: '800' },

  checkRow: {
    minHeight: TAP_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  checkHold: { backgroundColor: colors.warnBg, borderColor: colors.warnText, borderLeftWidth: 6 },
  checkRowDone: { backgroundColor: colors.okBg, borderColor: colors.okText },
  box: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: colors.primary,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.okText, borderColor: colors.okText },
  boxMark: { color: colors.onPrimary, fontSize: 22, fontWeight: '900', lineHeight: 26 },

  source: { gap: 2, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: colors.disabled },
  sourceLink: { minHeight: TAP_MIN, justifyContent: 'center', paddingVertical: space.xs },
  sourceId: { fontWeight: '800', color: colors.primary },
  sourceUrl: { fontSize: font.small, color: colors.primary, textDecorationLine: 'underline' },
});
