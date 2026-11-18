// «Заметка смены» — общая для команды (коллекция shift, в базе fm_shift, документ note).
// На телефоне и в веб-версии одной команды она одна и та же.
import { useEffect, useRef, useState } from 'react';

import { Button, Card, Field, Muted, Notice } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getDoc, saveDoc, useSyncStatus } from '@/lib/sync';

const COL = 'shift';
const ID = 'note';
type Note = { text: string };

export function ShiftNote() {
  const status = useSyncStatus();
  const team = status.team?.space ?? '';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const edited = useRef(false); // пользователь начал печатать — загруженный текст его не затирает
  const loadedTeam = useRef<string | null>(null);

  // Загрузить заметку при открытии и при смене команды
  useEffect(() => {
    let alive = true;
    if (loadedTeam.current !== null && loadedTeam.current !== team) edited.current = false; // другая команда — её заметка
    loadedTeam.current = team;
    getDoc<Note>(COL, ID).then(d => {
      if (alive && !edited.current) setText(typeof d?.text === 'string' ? d.text : '');
    });
    return () => { alive = false; };
  }, [team]);

  async function onSave() {
    setBusy(true);
    const r = await saveDoc(COL, ID, { text });
    setBusy(false);
    if (!r.ok) setMsg({ kind: 'warn', text: t('training.saveFail') });
    else setMsg({ kind: 'ok', text: r.synced ? t('training.savedCloud') : t('training.savedLocal') });
  }

  return (
    <Card title={t('training.noteTitle')}>
      <Muted>{t('training.noteHint')}</Muted>
      <Field
        label={t('training.noteTitle')}
        value={text}
        onChangeText={v => { edited.current = true; setText(v); setMsg(null); }}
        placeholder={t('training.notePlaceholder')}
        multiline
        testID="shift-note"
      />
      <Button title={t('training.save')} onPress={onSave} disabled={busy} testID="shift-save" />
      {msg ? <Notice kind={msg.kind} text={msg.text} testID="shift-msg" /> : null}
    </Card>
  );
}
