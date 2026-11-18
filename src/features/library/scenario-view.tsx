// Экран одного сценария: этапы (раскрываются), точки остановки, режим «Чек-лист»,
// частые ошибки, вопросы для диктовки, заметки и источники.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SyncBadge } from '@/components/sync-badge';
import { Body, Button, Card, Field, Muted, Notice, Screen } from '@/components/ui';
import { useSyncStatus } from '@/lib/sync';
import { colors, font, radius, space, TAP_MIN, ui } from '@/lib/theme';

import { countDone, phaseItems } from './checklist';
import { PhaseSection, RefText, SourceRow, StatusBadge } from './components';
import { CLUSTERS } from './content';
import { addNote, deleteNote, loadNotes, type LibraryNote } from './notes';
import { loadProgress, saveProgress } from './progress';
import { formatDate, formatDateTime, lt } from './strings';
import type { Scenario } from './types';

type Mode = 'read' | 'check';

export function ScenarioView({ scenario, onBack }: { scenario: Scenario; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('read');
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const cluster = CLUSTERS.find(c => c.id === scenario.cluster);

  // ----- отметки чек-листа -----
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const doneRef = useRef(done);
  const touched = useRef(false); // уже отмечали — загрузка из базы не затирает отметки
  const [saveFail, setSaveFail] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const team = useSyncStatus().team?.space ?? '';

  useEffect(() => {
    let alive = true;
    loadProgress(scenario.id).then(keys => {
      if (!alive || touched.current) return;
      const next = new Set(keys);
      doneRef.current = next;
      setDone(next);
    });
    return () => { alive = false; };
  }, [scenario.id, team]);

  async function store(next: Set<string>) {
    touched.current = true;
    doneRef.current = next;
    setDone(next);
    const r = await saveProgress(scenario.id, Array.from(next));
    setSaveFail(!r.ok);
  }

  function toggleItem(key: string) {
    const next = new Set(doneRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setConfirmReset(false);
    void store(next);
  }

  function reset() {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    void store(new Set());
  }

  // Чек-лист открывается на первом этапе, где ещё есть неотмеченные пункты
  function switchMode(m: Mode) {
    setMode(m);
    if (m === 'check') {
      const first = scenario.phases.findIndex(p => phaseItems(p).some(i => !doneRef.current.has(i.key)));
      if (first >= 0) setOpen(prev => new Set(prev).add(first));
    }
  }

  const togglePhase = (i: number) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  const allOpen = open.size === scenario.phases.length;
  const progress = countDone(scenario, done);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Screen title={`${scenario.id}. ${scenario.title}`}>
      <Button title={lt('back')} kind="secondary" onPress={onBack} testID="lib-back" />

      <View style={s.metaRow}>
        <StatusBadge status={scenario.status} />
        {cluster ? <Muted>{cluster.title}</Muted> : null}
      </View>
      {scenario.status === 'черновик ИИ' ? (
        <View style={{ gap: space.xs }}>
          <Notice kind="warn" text={lt('draftBanner')} testID="lib-draft-banner" />
          <Muted>{lt('draftHint', { date: formatDate(scenario.updated) })}</Muted>
        </View>
      ) : null}
      <Body>{scenario.summary}</Body>

      {/* Переключатель режима */}
      <View style={s.segment} accessibilityRole="tablist">
        {(['read', 'check'] as const).map(m => (
          <Pressable
            key={m}
            onPress={() => switchMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            testID={`lib-mode-${m}`}
            style={({ pressed }) => [s.segBtn, mode === m && s.segOn, pressed && { opacity: 0.75 }]}>
            <Text style={[s.segText, mode === m && s.segTextOn]}>{lt(m === 'read' ? 'mode.read' : 'mode.check')}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'check' ? (
        <Card>
          <Text style={ui.h2} testID="lib-progress">{lt('progress', { done: progress.done, total: progress.total })}</Text>
          <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
          {progress.total > 0 && progress.done === progress.total ? <Notice kind="ok" text={lt('check.allDone')} /> : null}
          <Muted>{lt('check.hint')}</Muted>
          {saveFail ? <Notice kind="warn" text={lt('check.saveFail')} /> : null}
          <SyncBadge />
          <Button
            title={confirmReset ? lt('check.resetConfirm') : lt('check.reset')}
            kind="secondary"
            onPress={reset}
            disabled={progress.done === 0 && !confirmReset}
            testID="lib-reset"
          />
        </Card>
      ) : null}

      <Button
        title={allOpen ? lt('collapseAll') : lt('expandAll')}
        kind="secondary"
        onPress={() => setOpen(allOpen ? new Set() : new Set(scenario.phases.map((_, i) => i)))}
        testID="lib-expand"
      />

      {scenario.phases.map((p, i) => (
        <PhaseSection
          key={p.name}
          index={i}
          phase={p}
          open={open.has(i)}
          onToggle={() => togglePhase(i)}
          checklist={mode === 'check'}
          done={done}
          onToggleItem={toggleItem}
        />
      ))}

      {scenario.commonMistakes.length ? (
        <Card title={lt('mistakes')}>
          {scenario.commonMistakes.map((m, i) => <RefText key={i} text={'• ' + m} />)}
        </Card>
      ) : null}

      {scenario.askGeorgy.length ? (
        <Card title={lt('ask')}>
          {scenario.askGeorgy.map((q, i) => <RefText key={i} text={'• ' + q} />)}
        </Card>
      ) : null}

      <NotesCard scenarioId={scenario.id} />

      <SourcesCard scenario={scenario} />

      <Button title={lt('back')} kind="secondary" onPress={onBack} />
    </Screen>
  );
}

// ----- заметки (только текст, только на этом устройстве) -----

function NotesCard({ scenarioId }: { scenarioId: string }) {
  const [notes, setNotes] = useState<LibraryNote[]>([]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadNotes(scenarioId).then(list => { if (alive) setNotes(list); });
    return () => { alive = false; };
  }, [scenarioId]);

  async function save() {
    const next = await addNote(scenarioId, text);
    if (!next) { setMsg({ kind: 'warn', text: lt('notes.fail') }); return; }
    setNotes(next);
    setText('');
    setAdding(false);
    setMsg({ kind: 'ok', text: lt('notes.saved') });
  }

  async function remove(id: string) {
    if (confirmId !== id) { setConfirmId(id); return; }
    setConfirmId(null);
    const next = await deleteNote(scenarioId, id);
    if (next) setNotes(next);
  }

  return (
    <Card title={lt('notes')}>
      {adding ? (
        <>
          <Muted>{lt('notes.hint')}</Muted>
          <Field
            label={lt('notes.label')}
            value={text}
            onChangeText={v => { setText(v); setMsg(null); }}
            placeholder={lt('notes.placeholder')}
            multiline
            autoFocus
            testID="lib-note-input"
          />
          <Button title={lt('notes.save')} onPress={save} disabled={!text.trim()} testID="lib-note-save" />
          <Button title={lt('notes.cancel')} kind="secondary" onPress={() => { setAdding(false); setText(''); }} />
        </>
      ) : (
        <Button title={lt('notes.add')} kind="secondary" onPress={() => { setAdding(true); setMsg(null); }} testID="lib-note-add" />
      )}
      {msg ? <Notice kind={msg.kind} text={msg.text} testID="lib-note-msg" /> : null}
      {notes.length === 0 && !adding ? <Muted>{lt('notes.empty')}</Muted> : null}
      {notes.map(n => (
        <View key={n.id} style={s.note}>
          <Muted>{formatDateTime(n.at)}</Muted>
          <Body>{n.text}</Body>
          <Pressable
            onPress={() => void remove(n.id)}
            accessibilityRole="button"
            style={({ pressed }) => [s.noteDel, pressed && { opacity: 0.7 }]}>
            <Text style={s.noteDelText}>{confirmId === n.id ? lt('notes.deleteConfirm') : lt('notes.delete')}</Text>
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

// ----- источники -----

function SourcesCard({ scenario }: { scenario: Scenario }) {
  const [fail, setFail] = useState(false);
  if (!scenario.sources.length) return null;
  return (
    <Card title={lt('sources')}>
      <Muted>{lt('sources.hint')}</Muted>
      {fail ? <Notice kind="warn" text={lt('source.openFail')} /> : null}
      {scenario.sources.map(src => <SourceRow key={src.id} source={src} onFail={() => setFail(true)} />)}
    </Card>
  );
}

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  segment: { flexDirection: 'row', borderWidth: 2, borderColor: colors.primary, borderRadius: radius.sm, overflow: 'hidden' },
  segBtn: { flex: 1, minHeight: TAP_MIN, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  segOn: { backgroundColor: colors.primary },
  segText: { fontSize: font.body, fontWeight: '800', color: colors.primary },
  segTextOn: { color: colors.onPrimary },
  bar: { height: 14, borderRadius: 7, backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.okText },
  note: { gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.disabled },
  noteDel: { alignSelf: 'flex-start', minHeight: TAP_MIN, justifyContent: 'center', paddingHorizontal: space.sm },
  noteDelText: { fontSize: font.small, fontWeight: '800', color: colors.warnText, textDecorationLine: 'underline' },
});
