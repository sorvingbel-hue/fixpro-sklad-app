// Вкладка «Ещё»: код команды, язык, о приложении.
import Constants from 'expo-constants';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SyncBadge } from '@/components/sync-badge';
import { Body, Button, Card, Field, Muted, Notice, Screen } from '@/components/ui';
import { getLanguage, LANGUAGES, setLanguage, t, type I18nKey } from '@/lib/i18n';
import { connectTeam, disconnectTeam, parseTeamCode, useSyncStatus } from '@/lib/sync';
import { colors, font, radius, space, TAP_MIN } from '@/lib/theme';

export default function MoreScreen() {
  return (
    <Screen title={t('more.title')}>
      <TeamCard />
      <LanguageCard />
      <AboutCard />
    </Screen>
  );
}

// ---------- Команда ----------
function TeamCard() {
  const status = useSyncStatus();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'info'; key: I18nKey } | null>(null);

  async function onConnect() {
    const tc = parseTeamCode(input);
    if (!tc) { setMsg({ kind: 'warn', key: 'team.bad' }); return; }
    setBusy(true);
    setMsg({ kind: 'info', key: 'team.checking' });
    const r = await connectTeam(tc.space, tc.code);
    setBusy(false);
    if (r.ok) { setInput(''); setMsg({ kind: 'ok', key: 'team.done' }); }
    else setMsg({ kind: 'warn', key: r.reason === 'invalid' ? 'team.bad' : (('team.' + r.reason) as I18nKey) });
  }

  async function onDisconnect() {
    await disconnectTeam();
    setMsg({ kind: 'info', key: 'team.off' });
  }

  const team = status.team;
  return (
    <Card title={t('team.title')}>
      {team ? (
        <>
          <Body>{t('team.connected', { name: team.name || team.space })}</Body>
          <Muted>{t('team.id', { space: team.space })}</Muted>
          <Button title={t('team.disconnect')} kind="secondary" onPress={onDisconnect} testID="team-disconnect" />
        </>
      ) : (
        <>
          <Field
            label={t('team.label')}
            value={input}
            onChangeText={v => { setInput(v); setMsg(null); }}
            placeholder={t('team.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={onConnect}
            testID="team-input"
          />
          <Muted>{t('team.hint')}</Muted>
          <Button title={t('team.connect')} onPress={onConnect} disabled={busy || !input.trim()} testID="team-connect" />
          <Muted>{t('team.local')}</Muted>
        </>
      )}
      {msg ? <Notice kind={msg.kind} text={t(msg.key)} testID="team-msg" /> : null}
      <SyncBadge />
    </Card>
  );
}

// ---------- Язык (пока активен только русский) ----------
function LanguageCard() {
  const [lang, setLang] = useState(getLanguage());
  return (
    <Card title={t('lang.title')}>
      <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
        {LANGUAGES.map(l => {
          const selected = l.code === lang;
          return (
            <Pressable
              key={l.code}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: !l.enabled }}
              disabled={!l.enabled}
              onPress={() => { if (setLanguage(l.code)) setLang(l.code); }}
              style={[s.lang, selected && s.langOn, !l.enabled && s.langOff]}>
              <Text style={[s.langText, selected && { color: colors.onPrimary }]}>
                {selected ? '● ' : '○ '}
                {l.label}
                {l.enabled ? '' : ` — ${t('lang.soon')}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

// ---------- О приложении ----------
function AboutCard() {
  const version = Constants.expoConfig?.version ?? '';
  return (
    <Card title={t('about.title')}>
      <Body>{t('about.text')}</Body>
      <Notice kind="warn" text={t('about.disclaimer')} />
      <Muted>{t('about.version', { v: version })}</Muted>
    </Card>
  );
}

const s = StyleSheet.create({
  lang: {
    minHeight: TAP_MIN,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  langOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  langOff: { borderStyle: 'dashed', opacity: 0.7 },
  langText: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
