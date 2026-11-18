// Вкладка «Законы»: правила Калифорнии для HVAC (наполнение — следующий этап).
import { Body, Notice, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';

export default function LawsScreen() {
  return (
    <Screen title={t('laws.title')}>
      <Body>{t('laws.intro')}</Body>
      <Notice kind="warn" text={t('laws.disclaimer')} />
    </Screen>
  );
}
