// Проверка совместимости: JSON из веб-пилота dot «Форман · единый модуль 0.3» → «Форман».
// Данные ВЫМЫШЛЕННЫЕ (сняты с пилота кнопкой «Показать текущий JSON»).
//
// 1) Правила проверки совпадают с valid() пилота (если задан PILOT_APP_JS — путь к app.js пилота).
// 2) Невалидный и слишком большой JSON отклоняется без исключений и ничего не сохраняет.
// 3) Импорт во ВРЕМЕННУЮ команду Supabase: space_create → importV03 (sync-core: doc_set) →
//    doc_get / doc_list → сравнение поле за полем → space_wipe. Команду «demo» не трогает.
//
// Запуск: npm run test:import-v03
//   V03_JSON=<файл>     — JSON из пилота (по умолчанию tests/fixtures/pilot-v03-demo.json)
//   PILOT_APP_JS=<файл> — app.js пилота для сверки правил с оригинальной valid()
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { createSyncClient } from '../src/lib/sync-core.ts';
import { checkV03, importV03, V03_LIMITS, V03_REMOTE_COL, validV03 } from '../src/features/work/import-v03.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* нет .env */ }
  return env;
}
const env = readEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_KEY;
if (!URL || !KEY) { console.error('Нет EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY (см. .env.example)'); process.exit(1); }

const jsonPath = env.V03_JSON || join(root, 'tests/fixtures/pilot-v03-demo.json');
const TEXT = readFileSync(jsonPath, 'utf8');
const SRC = JSON.parse(TEXT);

function memoryKV() {
  const m = new Map();
  return {
    map: m,
    getItem: async k => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, v); },
    removeItem: async k => { m.delete(k); },
  };
}
async function rpc(name, args) {
  const r = await fetch(URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ok  ' + name); }
  catch (e) { results.push(['FAIL', name]); console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e)); }
}
const clone = v => JSON.parse(JSON.stringify(v));

// Сравнение поле за полем: возвращает число сравненных полей и список расхождений
function compareFields(src, doc) {
  let n = 0;
  const diff = [];
  const eq = (path, a, b) => { n++; if (!Object.is(a, b)) diff.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
  for (const f of ['schema', 'job', 'updated', 'notes']) eq(f, src[f], doc[f]);
  eq('items.length', src.items.length, doc.items.length);
  src.items.forEach((it, k) => { for (const f of Object.keys(it)) eq(`items[${k}].${f}`, it[f], doc.items[k]?.[f]); });
  eq('questions.length', src.questions.length, doc.questions.length);
  src.questions.forEach((q, k) => { for (const f of Object.keys(q)) eq(`questions[${k}].${f}`, q[f], doc.questions[k]?.[f]); });
  const team = src.team || [];
  eq('team.length', team.length, doc.team.length);
  team.forEach((t, k) => { for (const f of Object.keys(t)) eq(`team[${k}].${f}`, t[f], doc.team[k]?.[f]); });
  eq('checks.keys', Object.keys(src.checks).length, Object.keys(doc.checks).length);
  for (const k of Object.keys(src.checks)) eq(`checks.${k}`, src.checks[k], doc.checks[k]);
  eq('phases', JSON.stringify(src.phases), JSON.stringify(doc.phases));
  return { n, diff };
}

console.log('JSON пилота: ' + jsonPath + ` (${TEXT.length} символов)`);

// ---------- 1. правила = valid() пилота ----------
await step('правила совпадают с valid() пилота на 22 вариантах JSON', async () => {
  const cases = [];
  const mut = (name, fn) => { const s = clone(SRC); const r = fn(s); cases.push([name, r === undefined ? s : r]); };
  mut('исходный', () => undefined);
  mut('job DEMO-02', s => { s.job = 'DEMO-02'; });
  mut('schema 2', s => { s.schema = 2; });
  mut('4 вопроса', s => { s.questions.pop(); });
  mut('вопрос уточнён без ответа', s => { s.questions[0].resolved = true; s.questions[0].answer = '  '; });
  mut('вопрос q9 вместо q1', s => { s.questions[0].id = 'q9'; });
  mut('9 назначений', s => { s.team = Array.from({ length: 9 }, () => ({ role: 'r', task: 't', next: 'n', status: 'open' })); });
  mut('назначение status=x', s => { s.team[0].status = 'x'; });
  mut('team = null', s => { s.team = null; });
  mut('без team', s => { delete s.team; });
  mut('201 позиция', s => { s.items = Array.from({ length: 201 }, (_, k) => ({ ...s.items[0], id: 'i' + k })); });
  mut('повтор id позиции', s => { s.items[1].id = s.items[0].id; });
  mut('required = true', s => { s.items[0].required = true; });
  mut('status = ok', s => { s.items[0].status = 'ok'; });
  mut('нет location', s => { delete s.items[0].location; });
  mut('checks — массив', s => { s.checks = []; });
  mut('checks со строкой', s => { s.checks = { scope: 'yes' }; });
  mut('нет notes', s => { delete s.notes; });
  mut('null', () => null);
  mut('массив', () => []);
  mut('строка', () => 'DEMO-01');
  mut('число', () => 42);
  let pilotValid = null;
  if (env.PILOT_APP_JS) {
    // app.js пилота экспортирует valid() через module.exports, если нет document. Запускаем в отдельном контексте.
    const ctx = { module: { exports: {} } };
    vm.runInNewContext(readFileSync(env.PILOT_APP_JS, 'utf8'), ctx, { timeout: 2000 });
    pilotValid = ctx.module.exports.valid;
    assert.equal(typeof pilotValid, 'function', 'в app.js нет valid()');
  }
  for (const [name, s] of cases) {
    const mine = validV03(s);
    if (pilotValid) assert.equal(mine, pilotValid(s), `расхождение с пилотом: «${name}»`);
    assert.equal(mine, name === 'исходный' || name === 'team = null' || name === 'без team', `«${name}»`);
  }
  console.log(`       ${cases.length} вариантов; сверка с оригинальной valid(): ${pilotValid ? 'да' : 'нет (PILOT_APP_JS не задан)'}`);
});

// ---------- 2. предпросмотр ----------
await step('предпросмотр: числа совпадают с исходным JSON', async () => {
  const c = checkV03(TEXT);
  assert.ok(c.ok, JSON.stringify(c));
  const p = c.preview;
  assert.equal(p.items, SRC.items.length);
  assert.equal(p.questions, SRC.questions.length);
  assert.equal(p.answered, SRC.questions.filter(q => q.answer.trim()).length);
  assert.equal(p.team, (SRC.team || []).length);
  assert.deepEqual(p.ignoredKeys, []);
  console.log(`       позиций ${p.items} (заполнено ${p.itemsFilled}), вопросов ${p.questions} (с ответом ${p.answered}), ролей ${p.team}, ${p.docBytes} байт`);
});

// ---------- 3. отказ без падения ----------
await step('невалидный и слишком большой JSON отклоняется без исключений и не сохраняется', async () => {
  let saves = 0;
  const spy = async () => { saves++; return { ok: true, synced: false }; };
  const big = clone(SRC);
  big.notes = 'x'.repeat(V03_LIMITS.notes + 1);           // проходит valid() пилота, но больше лимита заметок
  const longField = clone(SRC);
  longField.items[0].note = 'я'.repeat(V03_LIMITS.str + 1);
  const proto = TEXT.replace('"checks": {}', '"checks": {"__proto__": true}');
  const cases = [
    ['', 'empty'], ['   ', 'empty'], [null, 'empty'], ['не json', 'not_json'], ['{"schema":1,', 'not_json'],
    ['x'.repeat(V03_LIMITS.jsonChars + 1), 'too_big'], [' '.repeat(V03_LIMITS.jsonChars) + TEXT, 'too_big'],
    ['null', 'invalid'], ['[]', 'invalid'], ['"DEMO-01"', 'invalid'], ['42', 'invalid'], ['{}', 'invalid'],
    [TEXT.replace('"DEMO-01"', '"DEMO-02"'), 'invalid'],
    [JSON.stringify(big), 'limits'], [JSON.stringify(longField), 'limits'],
  ];
  if (proto !== TEXT) cases.push([proto, 'limits']);
  for (const [input, reason] of cases) {
    const t0 = Date.now();
    const r = await importV03(input, spy); // не должно бросить
    assert.equal(r.ok, false, `ожидался отказ (${reason})`);
    assert.equal(r.reason, reason, `причина для ${String(input).slice(0, 30)}…`);
    assert.ok(typeof r.message === 'string' && r.message.length > 0);
    assert.ok(Date.now() - t0 < 2000, 'проверка заняла слишком долго');
  }
  assert.equal(saves, 0, 'при отказе ничего не сохраняется');
  console.log(`       ${cases.length} плохих входов отклонены, сохранений 0`);
});

// ---------- 4. перенос во временную команду ----------
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', 't').slice(0, 15);
const team = { space: `test-${stamp}-forman-v03-${randomBytes(4).toString('hex')}`, code: randomBytes(24).toString('base64url') };
assert.ok(team.space.startsWith('test-') && team.space !== 'demo');
console.log('Временная команда: ' + team.space);
let created = false;
try {
  const c = await rpc('space_create', { p_space: team.space, p_code: team.code, p_name: 'Форман: тест импорта v0.3' });
  assert.equal(c.status, 200, 'space_create -> ' + c.status + ' ' + JSON.stringify(c.body));
  created = true;
  const kv = memoryKV();
  const A = createSyncClient({ url: URL, key: KEY, storage: kv, colPrefix: 'fm_' });
  await A.init();

  await step('importV03 → устройство и база (doc_set), synced', async () => {
    assert.deepEqual(await A.connectTeam(team.space, team.code), { ok: true, name: 'Форман: тест импорта v0.3' });
    const r = await importV03(TEXT, A.saveDoc);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.synced, true);
    assert.equal(A.getStatus().pending, 0);
  });

  await step(`doc_get ${V03_REMOTE_COL}/DEMO-01: поле за полем = JSON пилота`, async () => {
    const raw = await rpc('doc_get', { p_space: team.space, p_code: team.code, p_col: V03_REMOTE_COL, p_id: SRC.job });
    assert.equal(raw.status, 200, JSON.stringify(raw.body));
    const doc = raw.body;
    assert.equal(doc.kind, 'forman-work-v03');
    assert.equal(doc.photosIncluded, false);
    const { n, diff } = compareFields(SRC, doc);
    assert.deepEqual(diff, []);
    // и наоборот: документ из базы снова проходит valid() пилота (можно вернуть в пилот)
    const back = { schema: doc.schema, job: doc.job, updated: doc.updated, items: doc.items, questions: doc.questions, phases: doc.phases, checks: doc.checks, notes: doc.notes, team: doc.team };
    assert.equal(validV03(back), true);
    console.log(`       сравнено полей: ${n}, расхождений: ${diff.length}`);
  });

  await step('локальная копия на устройстве = JSON пилота', async () => {
    const local = JSON.parse(kv.map.get('fm.col.work_v03'))[SRC.job].d;
    const { n, diff } = compareFields(SRC, local);
    assert.deepEqual(diff, []);
    console.log(`       сравнено полей: ${n}, расхождений: ${diff.length}`);
  });

  await step('повторный импорт заменяет запись, а не дублирует (doc_list)', async () => {
    const r = await importV03(TEXT, A.saveDoc);
    assert.ok(r.ok && r.synced);
    const list = await rpc('doc_list', { p_space: team.space, p_code: team.code, p_col: V03_REMOTE_COL });
    assert.equal(list.status, 200);
    const ids = (Array.isArray(list.body) ? list.body : []).map(d => d.id ?? d.doc_id);
    assert.deepEqual(ids, [SRC.job]);
  });
} finally {
  if (created) {
    const w = await rpc('space_wipe', { p_space: team.space, p_code: team.code });
    const gone = await rpc('space_info', { p_space: team.space, p_code: team.code });
    console.log(`space_wipe -> ${w.status}, удалено документов: ${JSON.stringify(w.body)}; space_info после -> ${gone.status}`);
    if (w.status !== 200 || gone.status !== 403) results.push(['FAIL', 'стирание временной команды']);
  }
}

const failed = results.filter(r => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} проверок пройдено`);
process.exit(failed ? 1 : 0);
