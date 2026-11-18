// Строка статуса синхронизации: где сейчас данные и всё ли отправлено.
import { t, type I18nKey } from '@/lib/i18n';
import { useSyncStatus, type SyncState } from '@/lib/sync';

import { Notice } from './ui';

const KIND: Record<SyncState, 'ok' | 'warn' | 'info'> = {
  ok: 'ok',
  syncing: 'info',
  off: 'info',
  noconfig: 'warn',
  pending: 'warn',
  offline: 'warn',
  denied: 'warn',
  error: 'warn',
};

export function SyncBadge() {
  const st = useSyncStatus();
  const text = t(('sync.' + st.state) as I18nKey, { n: st.pending });
  return <Notice kind={KIND[st.state]} text={text} testID="sync-status" />;
}
