// Раздел «Практика»: три короткие практики (количество, hold point, сообщение офису).
import { useRef, useState } from 'react';
import { Text, View, type ViewInstance } from 'react-native';

import { Button, Field, Notice } from '@/components/ui';
import { space, ui } from '@/lib/theme';

import { fill, type ChoiceCase, type TrainingContent } from './content';
import { countPractice, resetPractice, setPractice, shuffled, stockFeedback, type Progress } from './logic';
import { Checkbox, Collapsible, Eyebrow, LinkButton, RadioList, Rich, Small } from './parts';
import type { RevealMode } from './use-reveal';

type Reveal = (top: ViewInstance | null, bottom: ViewInstance | null, mode: RevealMode) => Promise<void>;
type Fb = { ok: boolean; text: string } | null;
type CaseKey = 'hold' | 'report';

const later = (fn: () => void) => { setTimeout(fn, 80); };
const order = (cs: ChoiceCase) => shuffled(cs.options.map(o => o.id));

export function PracticeSection({ c, progress, save, reveal }: { c: TrainingContent; progress: Progress; save: (p: Progress) => Promise<void>; reveal: Reveal }) {
  const pc = c.practice;
  const [value, setValue] = useState('');
  const [seen, setSeen] = useState(false);
  const [stockFb, setStockFb] = useState<Fb>(null);
  const [choice, setChoice] = useState<Record<CaseKey, string | null>>({ hold: null, report: null });
  const [fb, setFb] = useState<Record<CaseKey, Fb>>({ hold: null, report: null });
  // варианты перемешиваются при открытии раздела и после «Повторить»
  const [orders, setOrders] = useState<Record<CaseKey, string[]>>(() => ({ hold: order(pc.hold), report: order(pc.report) }));
  const stockRef = useRef<ViewInstance>(null);
  const holdRef = useRef<ViewInstance>(null);
  const reportRef = useRef<ViewInstance>(null);
  const refs = { hold: holdRef, report: reportRef };

  function checkStock() {
    const r = stockFeedback(value, seen, pc.stock);
    setStockFb(r);
    void save(setPractice(progress, 'stock', r.ok));
    later(() => void reveal(stockRef.current, stockRef.current, 'span'));
  }

  function checkCase(key: CaseKey) {
    const cs = pc[key];
    const ch = choice[key];
    if (!ch) {
      setFb(f => ({ ...f, [key]: { ok: false, text: pc.chooseFirst } }));
    } else {
      const ok = ch === cs.correct;
      setFb(f => ({ ...f, [key]: { ok, text: ok ? cs.good : cs.bad } }));
      void save(setPractice(progress, key, ok));
    }
    later(() => void reveal(refs[key].current, refs[key].current, 'span'));
  }

  function resetAll() {
    setValue('');
    setSeen(false);
    setStockFb(null);
    setChoice({ hold: null, report: null });
    setFb({ hold: null, report: null });
    setOrders({ hold: order(pc.hold), report: order(pc.report) });
    void save(resetPractice(progress));
  }

  const renderCase = (key: CaseKey) => {
    const cs = pc[key];
    const opts = orders[key].map(id => cs.options.find(o => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
    const f = fb[key];
    return (
      <Collapsible title={cs.title} testID={`practice-${key}-toggle`}>
        <Text style={ui.body}>{cs.text}</Text>
        <Text style={[ui.body, { fontWeight: '800' }]}>{cs.question}</Text>
        <RadioList
          options={opts}
          value={choice[key]}
          onChange={id => { setChoice(x => ({ ...x, [key]: id })); setFb(x => ({ ...x, [key]: null })); }}
          label={cs.question}
          testIDPrefix={`${key}-opt`}
        />
        <Button title={cs.check} onPress={() => checkCase(key)} testID={`${key}-check`} />
        <View ref={refs[key]} collapsable={false}>
          {f ? <Notice kind={f.ok ? 'ok' : 'warn'} text={f.text} testID={`${key}-feedback`} /> : null}
        </View>
        {cs.link ? <LinkButton name={cs.link.name} url={cs.link.url} /> : null}
      </Collapsible>
    );
  };

  return (
    <View style={[ui.card, { gap: space.md }]}>
      <Eyebrow>{pc.eyebrow}</Eyebrow>
      <Text style={ui.h2} accessibilityRole="header">{pc.title}</Text>
      <Text style={ui.body}>{pc.intro}</Text>
      <Text style={[ui.body, { fontWeight: '800' }]} accessibilityLiveRegion="polite" testID="practice-progress">
        {fill(pc.progress, { n: countPractice(progress) })}
      </Text>

      <Collapsible title={pc.stock.title} open testID="practice-stock-toggle">
        <Rich text={pc.stock.text} />
        <Field
          label={pc.stock.inputLabel}
          value={value}
          onChangeText={v => { setValue(v); setStockFb(null); }}
          placeholder={pc.stock.placeholder}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={4}
          testID="stock-input"
        />
        <Checkbox label={pc.stock.confirm} checked={seen} onChange={v => { setSeen(v); setStockFb(null); }} testID="stock-confirm" />
        <Button title={pc.stock.check} onPress={checkStock} testID="stock-check" />
        <View ref={stockRef} collapsable={false}>
          {stockFb ? <Notice kind={stockFb.ok ? 'ok' : 'warn'} text={stockFb.text} testID="stock-feedback" /> : null}
        </View>
      </Collapsible>

      {renderCase('hold')}
      {renderCase('report')}

      <Button title={pc.reset} kind="secondary" onPress={resetAll} testID="practice-reset" />
      <Small>{pc.note}</Small>
    </View>
  );
}
