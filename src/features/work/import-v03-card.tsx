// Карточка во вкладке «Ещё»: ТЕСТОВЫЙ импорт смены из веб-пилота dot v0.3.
// Вставить JSON → «Проверить» (предпросмотр) → «Импортировать» (через sync.ts).
import { useState } from 'react';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { t } from '@/lib/i18n';

import { checkV03, importV03, V03_LIMITS, type V03Check } from './import-v03';

export function ImportV03Card() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [check, setCheck] = useState<V03Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  function close() {
    setOpen(false); setText(''); setCheck(null); setResult(null);
  }

  async function onImport() {
    setBusy(true);
    const r = await importV03(text);
    setBusy(false);
    if (r.ok) {
      setResult({ kind: 'ok', text: t(r.synced ? 'v03.done.synced' : 'v03.done.local') });
      setText(''); setCheck(null);
    } else {
      setResult({ kind: 'warn', text: [r.message, ...r.problems].join('\n• ') });
    }
  }

  if (!open) {
    return (
      <Card title={t('v03.title')}>
        <Button title={t('v03.open')} kind="secondary" onPress={() => setOpen(true)} testID="v03-open" />
      </Card>
    );
  }

  const p = check?.ok ? check.preview : null;
  return (
    <Card title={t('v03.title')}>
      <Muted>{t('v03.hint')}</Muted>
      <Field
        label={t('v03.label')}
        value={text}
        onChangeText={v => {
          setResult(null);
          // слишком большой текст не держим в поле (тяжело для телефона) — сразу отказ
          if (v.length > V03_LIMITS.jsonChars) { setText(''); setCheck(checkV03(v)); return; }
          setText(v); setCheck(null);
        }}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        testID="v03-json"
      />
      <Button title={t('v03.check')} onPress={() => { setResult(null); setCheck(checkV03(text)); }} disabled={!text.trim() || busy} testID="v03-check" />
      {check && !check.ok ? <Notice kind="warn" text={[check.message, ...check.problems].join('\n• ')} testID="v03-error" /> : null}
      {p ? (
        <>
          <Notice
            kind="info"
            text={t('v03.preview', {
              job: p.job, items: p.items, filled: p.itemsFilled, questions: p.questions,
              answered: p.answered, team: p.team, updated: p.updated ?? '—',
            })}
            testID="v03-preview"
          />
          {p.ignoredKeys.length ? <Muted>{t('v03.ignored', { keys: p.ignoredKeys.join(', ') })}</Muted> : null}
          <Notice kind="warn" text={t('v03.photos')} />
          <Muted>{t('v03.replace')}</Muted>
          <Button title={t('v03.import')} onPress={onImport} disabled={busy} testID="v03-import" />
        </>
      ) : null}
      {result ? <Notice kind={result.kind} text={result.text} testID="v03-result" /> : null}
      <Button title={t('v03.close')} kind="secondary" onPress={close} testID="v03-close" />
    </Card>
  );
}
