// Карточка «Копия и второй телефон» в списке объектов (М7): сохранить копию файлом / загрузить копию,
// дата последней копии и напоминание «Сделайте копию», если копии нет или она старше 3 дней.
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button, Card, Muted, Notice } from '@/components/ui';
import { colors, font } from '@/lib/theme';

import { backupAgeDays, backupAgeText, needsBackup, plural, realJobs } from './backup-model';
import {
  BACKUP_SUPPORTED, canShareBackup, chooseBackupFile, downloadBackup, lastBackup, markBackup, mb, prepareBackup, restoreBackup,
  shareBackup, type PreparedBackup,
} from './backup-store';
import type { Job } from './jobs-model';
import { requestPersist } from './photo-store';

export type BackupMsg = { ok: boolean; text: string } | null;

type Props = {
  jobs: Job[];
  onRestored: (added: number) => void | Promise<void>;
  // сообщение хранит список объектов: после загрузки в пустой список карточка переезжает под объекты
  msg: BackupMsg;
  setMsg: (m: BackupMsg) => void;
};

export function BackupCard({ jobs, onRestored, msg, setMsg }: Props) {
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'load' | null>(null);
  const [ready, setReady] = useState<PreparedBackup | null>(null);

  useEffect(() => { void lastBackup().then(setLast); }, []);

  if (!BACKUP_SUPPORTED) {
    return (
      <Card title="Копия и второй телефон">
        <Notice kind="info" text="Копия файлом пока работает в веб-версии «Формана» (по ссылке в Safari или Chrome)." />
      </Card>
    );
  }

  const real = realJobs(jobs).length;
  const stale = needsBackup(jobs, last);
  const age = backupAgeDays(last);
  const what = (p: PreparedBackup) =>
    `${p.jobs} ${plural(p.jobs, ['объект', 'объекта', 'объектов'])}, ${p.photos} фото, ${mb(p.bytes)}${p.missing ? `; фото, которых уже нет в браузере: ${p.missing}` : ''}`;

  async function done(p: PreparedBackup, how: string) {
    setLast(await markBackup());
    setReady(null);
    void requestPersist();
    setMsg({ ok: true, text: `${how}: ${what(p)}. Файл: ${p.name}. Сохраните его в «Файлы» или отправьте себе в WhatsApp.` });
  }

  async function onSave() {
    setMsg(null);
    setReady(null);
    setBusy('save');
    try {
      const p = await prepareBackup();
      if ('error' in p) { setMsg({ ok: false, text: p.error }); return; }
      if (canShareBackup(p)) {
        setReady(p);
        setMsg({ ok: true, text: `Копия готова: ${what(p)}. Нажмите «Отправить копию» — AirDrop, WhatsApp или «Сохранить в Файлы».` });
        return;
      }
      if (downloadBackup(p)) await done(p, 'Копия скачана');
      else setMsg({ ok: false, text: 'Не удалось скачать файл. Попробуйте в Safari или Chrome.' });
    } finally {
      setBusy(null);
    }
  }

  // «Поделиться» — сразу в нажатии, без ожиданий перед вызовом (Safari иначе не откроет меню)
  function onShare() {
    const p = ready;
    if (!p) return;
    void shareBackup(p).then(async r => {
      if (r === 'ok') await done(p, 'Копия отправлена');
      else if (r === 'fail') setMsg({ ok: false, text: 'Отправить не получилось. Нажмите «Скачать файл».' });
    });
  }

  function onDownload() {
    const p = ready;
    if (!p) return;
    if (downloadBackup(p)) void done(p, 'Копия скачана');
    else setMsg({ ok: false, text: 'Не удалось скачать файл.' });
  }

  function onLoad() {
    setMsg(null);
    const pending = chooseBackupFile(); // первым действием в нажатии — иначе Safari не откроет выбор файла
    pending.then(async f => {
      if (!f) return;
      setBusy('load');
      const r = await restoreBackup(f);
      if (!r.ok) { setMsg({ ok: false, text: r.text }); return; }
      setMsg({ ok: true, text: [r.text, ...r.notes].join('\n') });
      // телефон был пустой — теперь на нём ровно то, что в файле копии: копия есть, напоминать не о чем
      const made = Date.parse(r.createdAt);
      if (r.wasEmpty && r.added && !Number.isNaN(made)) setLast(await markBackup(new Date(Math.min(made, Date.now()))));
      if (r.added) void requestPersist();
      await onRestored(r.added);
    }).finally(() => setBusy(null));
  }

  return (
    <Card title="Копия и второй телефон">
      {stale ? (
        <Notice
          kind="warn"
          text={age === null
            ? 'Сделайте копию. Копии ещё нет: если телефон потеряется или браузер сотрёт данные, объекты и фото пропадут.'
            : `Сделайте копию. Последней копии ${age} ${plural(age, ['день', 'дня', 'дней'])} — сохраните свежую.`}
          testID="backup-warn"
        />
      ) : null}
      <Text style={s.body}>
        {real
          ? 'Копия — один файл со всеми объектами, сверкой и фото. Сохраните его в «Файлы» или отправьте себе в WhatsApp. На втором телефоне откройте «Форман» и нажмите «Загрузить копию».'
          : 'Есть копия с другого телефона? Нажмите «Загрузить копию» и выберите файл .forman.json.'}
      </Text>
      {real ? <Muted>{backupAgeText(last)}</Muted> : null}
      {real ? (
        ready ? (
          <>
            <Button title="📤  Отправить копию (AirDrop, WhatsApp, Файлы)" onPress={onShare} testID="backup-share" />
            <Button title="Скачать файл" kind="secondary" onPress={onDownload} testID="backup-download" />
          </>
        ) : (
          <Button title="💾  Сохранить копию (файл)" onPress={() => void onSave()} disabled={!!busy} testID="backup-save" />
        )
      ) : null}
      <Button title="📂  Загрузить копию" kind="secondary" onPress={onLoad} disabled={!!busy} testID="backup-load" />
      {busy ? <Notice kind="info" text={busy === 'save' ? 'Собираю копию с фото…' : 'Загружаю копию…'} /> : null}
      {msg ? <Notice kind={msg.ok ? 'ok' : 'warn'} text={msg.text} testID="backup-msg" /> : null}
      <Muted>Загрузка ничего не стирает: новые объекты добавятся, одинаковые не задвоятся, из двух версий объекта останется более свежая.</Muted>
    </Card>
  );
}

const s = StyleSheet.create({
  body: { fontSize: font.body, color: colors.text, lineHeight: font.body * 1.4 },
});
