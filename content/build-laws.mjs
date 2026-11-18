// Сборка content/laws.json из итоговой карты исследования «Законы Калифорнии» (CA_CODES_MAP_v*.md).
// Запуск: node content/build-laws.mjs <путь к CA_CODES_MAP_v1.md>
// Берутся карточки раздела «3. Карточки по этапам работы» со ссылкой на закон («Где: …») и на источник,
// а также раздел «4. Подготовка к лицензии C-20» (устройство экзаменов и вопросы для самопроверки).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Этапы работы — в том же порядке, что в приложении (src/features/laws/types.ts)
const STAGES = [
  'дорога и парковка', 'приезд и объект', 'безопасность', 'монтаж', 'хладагент', 'электрика',
  'газ и дымоудаление', 'тесты и пуск', 'документы, permit и сдача', 'клиент', 'бизнес и лицензия',
];

// Редакция по виду документа в ссылке (таблица «Какие коды действуют» в карте кодов)
const EDITIONS = [
  [/\bCMC\b/, 'CMC 2025, действует с 01.01.2026'],
  [/\bCPC\b/, 'CPC 2025, действует с 01.01.2026'],
  [/\bCEC 2025\b|\bNEC 2023\b/, 'CEC 2025 (NEC 2023 + поправки CA), с 01.01.2026'],
  [/Energy Code|Part 1 §10-|\bJA2\b|\bRA3/, 'Energy Code 2025, для заявок на permit с 01.01.2026'],
  [/\bCRC\b/, 'CRC 2025, с 01.01.2026'],
  [/CALGreen/, 'CALGreen 2025, с 01.01.2026'],
  [/B&P|16 CCR/, 'CSLB Law Book 2026'],
  [/13A-1/, 'форма CSLB 13A-1, rev. 01/2026'],
  [/Fast Facts/, 'CSLB Fast Facts 2023'],
  [/Get Licensed|CSLB Fees|страница CSLB/, 'сайт CSLB на 18.11.2026'],
  [/(^|[^\d])8 CCR/, 'Cal/OSHA Title 8: копия DIR на 18.11.2026'],
  [/40 CFR/, 'eCFR на 16.11.2026'],
  [/49 CFR/, 'eCFR, версия с 03.09.2026'],
  [/17 CCR §95/, 'CARB HFC: Final Regulation Order 2020'],
  [/13 CCR/, 'CARB 13 CCR §2485: в силе с 01.04.2022'],
  [/\bCVC\b|Civil Code|Penal Code|Labor Code|\bHSC\b|\bPRC\b/, 'закон штата CA: текст на 18.11.2026'],
  [/SDMC/, 'San Diego Municipal Code: PDF глав 2020–2026'],
  [/IB 103/, 'IB 103 города San Diego, May 2026'],
  [/IB 718/, 'IB 718 города San Diego'],
  [/County Code|PDS 110/, 'округ San Diego: PDS 110 rev. 01/01/2026'],
  [/PDS 136/, 'округ San Diego: PDS 136 rev. 08/22/2025'],
  [/страница DSD|Simple Permits|Traffic Control/, 'сайт DSD города San Diego на 18.11.2026'],
];

// Что входит в программу экзаменов CSLB (C-20: коды Title 24 и Cal/OSHA; Law & Business: B&P, 16 CCR,
// lien, трудовое право). EPA 608 (40 CFR 82 Subpart F) — отдельный сертификат, но есть в вопросах для самопроверки.
const EXAM = /B&P|16 CCR|13A-1|Get Licensed|CSLB Fees|Fast Facts|страница CSLB|Labor Code|Civil Code §8\d{3}|(^|[^\d])8 CCR|\bCMC\b|\bCPC\b|CEC 2025|NEC 2023|Energy Code|Part 1 §10-|\bCRC\b|CALGreen|40 CFR §82\.1[5-6]\d/;

const CYR = 'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya';
const TR = Object.fromEntries(CYR.split(' ').map(p => p.split(':')));

function slug(s) {
  const lat = [...s.toLowerCase()].map(ch => TR[ch] ?? ch).join('');
  return lat.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

const isoDate = d => d.replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, '$3-$2-$1');
const noDot = s => s.trim().replace(/\.$/, '').trim();

function editionOf(citation) {
  const parts = [];
  for (const [re, text] of EDITIONS) if (re.test(citation) && !parts.includes(text)) parts.push(text);
  // Уточнения в скобках из ссылки («PDF 7-2026», «изм. 1992»), кроме голого года
  for (const m of citation.matchAll(/ \(([^()]*\d[^()]*)\)/g)) if (!/^\d{4}$/.test(m[1].trim())) parts.push(m[1].trim());
  return parts.join('; ');
}

// Строка карточки: - **Тема.** Требование. Где: ссылка. Когда: условие. [ссылка](url) · ДД.ММ.ГГГГ · [метки]
const CARD = /^- \*\*(.+?)\*\*\s*(.*?)\s+Где:\s+(.*?)\s+Когда:\s+(.*?)\s+\[ссылка\]\((https?:\/\/[^\s)]+)\)\s*·\s*(\d{2}\.\d{2}\.\d{4})\s*·\s*(.*)$/;

export function parseMap(md) {
  const cards = [];
  const skipped = [];
  const exam = { overview: '', guides: [], questionsNote: '', questions: [] };
  const ids = new Set();
  let section = '';
  let stage = null;

  for (const line of md.split(/\r?\n/)) {
    const h2 = line.match(/^## (\d+)\./);
    if (h2) { section = h2[1]; stage = null; continue; }
    const h3 = line.match(/^### 3\.\d+\s+(.+)$/);
    if (h3) {
      stage = STAGES.find(s => s === h3[1].trim().toLowerCase()) ?? null;
      if (!stage) throw new Error('Неизвестный этап: ' + h3[1]);
      continue;
    }

    if (section === '3' && stage && line.startsWith('- **')) {
      const m = line.match(CARD);
      if (!m) { skipped.push(line.slice(0, 80) + ' — не разобрана'); continue; }
      let [, topic, requirement, citation, when, url, date, tail] = m;
      topic = noDot(topic);
      // «**Тема** (уточнение). Текст» — уточнение относится к теме
      const extra = requirement.match(/^(\([^()]*\))\.\s*(.*)$/);
      if (extra) { topic += ' ' + extra[1]; requirement = extra[2]; }
      citation = noDot(citation);
      if (!citation || citation === '—') { skipped.push(topic + ' — нет ссылки на закон'); continue; }
      const labels = [...tail.matchAll(/\[([^\]]+)\]/g)].map(x => x[1].trim());
      const verified = labels.some(l => l.startsWith('проверено цитатой'))
        && !labels.some(l => /раздел не проверен|не удалось проверить/.test(l));
      let id = slug(topic) || 'card';
      for (let n = 2; ids.has(id); n++) id = slug(topic) + '-' + n;
      ids.add(id);
      cards.push({
        id, stage, topic,
        requirementRu: requirement.trim(),
        citation,
        edition: editionOf(citation),
        appliesWhen: noDot(when),
        sourceUrl: url,
        checked: isoDate(date),
        verified,
        examRelevant: EXAM.test(citation),
        labels,
      });
      continue;
    }

    if (section === '4') {
      const bold = line.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      if (bold) {
        const title = noDot(bold[1]);
        const link = bold[2].match(/\[study guide\]\((https?:\/\/[^\s)]+)\)/);
        const text = bold[2].replace(/\[study guide\]\([^)]*\)/, '').replace(/\s*\[[^\]]+\]/g, '').trim();
        if (title.startsWith('Как устроены')) exam.overview = text;
        else if (title.startsWith('15 вопросов') || title.includes('самопровер')) exam.questionsNote = text;
        else if (link) exam.guides.push({ title, text, url: link[1] });
        continue;
      }
      const q = line.match(/^\d+\.\s+(.+?\?)\s+—\s+(.+)$/);
      if (q) exam.questions.push({ q: q[1].trim(), a: q[2].trim() });
    }
  }
  return { cards, exam, skipped };
}

// Запуск из командной строки
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = process.argv[2];
  if (!src) {
    console.error('Укажите путь к карте кодов: node content/build-laws.mjs CA_CODES_MAP_v1.md');
    process.exit(1);
  }
  const { cards, exam, skipped } = parseMap(readFileSync(src, 'utf8'));
  const checked = cards.map(c => c.checked).sort();
  const out = {
    version: 1,
    source: basename(src),
    checkedFrom: checked[0] ?? null,
    checkedTo: checked[checked.length - 1] ?? null,
    stages: STAGES,
    cards,
    exam,
  };
  const dest = join(dirname(fileURLToPath(import.meta.url)), 'laws.json');
  writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
  const perStage = STAGES.map(s => `${s}: ${cards.filter(c => c.stage === s).length}`).join('; ');
  console.log(`Карточек: ${cards.length} (проверено: ${cards.filter(c => c.verified).length}, для C-20: ${cards.filter(c => c.examRelevant).length})`);
  console.log(perStage);
  console.log(`Экзамен: справок ${exam.guides.length}, вопросов ${exam.questions.length}`);
  if (skipped.length) console.log('Пропущено:\n  ' + skipped.join('\n  '));
  console.log('Записано: ' + dest);
}
