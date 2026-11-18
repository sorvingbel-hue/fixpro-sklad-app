// Вкладка «Установки»: библиотека типовых установок (наполнение — следующий этап).
import { Body, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';

export default function LibraryScreen() {
  return (
    <Screen title={t('library.title')}>
      <Body>{t('library.intro')}</Body>
    </Screen>
  );
}
