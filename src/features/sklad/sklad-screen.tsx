// Вкладка «Склад»: открывает существующий веб-склад FixPro.
// Веб — в новой вкладке браузера; телефон — во встроенном браузере (expo-web-browser).
// Если команда подключена, склад открывается сразу на ней (#s=…&k=…; эта часть адреса на сервер не уходит).
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform } from 'react-native';

import { Body, Button, Muted, Notice, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';
import { teamFragment, useSyncStatus } from '@/lib/sync';

export const SKLAD_URL = 'https://sorvingbel-hue.github.io/fixpro-sklad-app/';

export default function SkladScreen() {
  const status = useSyncStatus();
  const [failed, setFailed] = useState(false);

  async function open() {
    setFailed(false);
    const url = SKLAD_URL + teamFragment();
    try {
      if (Platform.OS === 'web') {
        window.open(url, '_blank', 'noopener'); // по нажатию — браузер не блокирует
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch {
      setFailed(true);
    }
  }

  const team = status.team;
  return (
    <Screen title={t('sklad.title')}>
      <Body>{t('sklad.intro')}</Body>
      <Button title={t('sklad.open')} onPress={open} testID="sklad-open" />
      <Muted>{team ? t('sklad.team', { name: team.name || team.space }) : t('sklad.noTeam')}</Muted>
      {failed ? <Notice kind="warn" text={t('sklad.openFail')} /> : null}
    </Screen>
  );
}
