// Проверка синхронизации на настоящей базе Supabase.
// Использует тот же код, что и приложение: src/lib/sync-core.ts (Node 22 запускает .ts сам).
// Тест создаёт ВРЕМЕННУЮ команду со случайным ID и кодом, работает только в ней
// и в конце стирает её (space_wipe). Команду «demo» не трогает. Код временной команды не печатается.
//
// Запуск: npm run test:sync   (адрес и ключ берутся из .env)
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSyncClient, parseTeamCode } from '../src/lib/sync-core.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- настройки из .env ----------
function readEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* нет .env — возьмём из окружения */ }
  return env;
}
const env = readEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_KEY;
if (!URL || !KEY) {
  console.error('Нет EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY (см. .env.example)');
  process.exit(1);
}

// ---------- помощники ----------
// Хранилище в памяти вместо AsyncStorage
function memoryKV() {
  const m = new Map();
  return {
    getItem: async k => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, v); },
    removeItem: async k => { m.delete(k); },
  };
}
// Прямой вызов функции базы (для создания/стирания временной команды и сверки)
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
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', 't').slice(0, 15);
const team = { space: `test-${stamp}-forman-${randomBytes(4).toString('hex')}`, code: randomBytes(24).toString('base64url') };
assert.ok(team.space.startsWith('test-') && team.space !== 'demo');

let online = true; // выключатель «связи» для одного из клиентов
const flakyFetch = (...a) => (online ? fetch(...a) : Promise.reject(new TypeError('Network request failed')));

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ok  ' + name); }
  catch (e) { results.push(['FAIL', name]); console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e)); }
}

// ---------- тест ----------
console.log('Временная команда: ' + team.space);
let created = false;
try {
  const c = await rpc('space_create', { p_space: team.space, p_code: team.code, p_name: 'Форман: временный тест' });
  assert.equal(c.status, 200, 'space_create -> ' + c.status + ' ' + JSON.stringify(c.body));
  created = true;

  const A = createSyncClient({ url: URL, key: KEY, storage: memoryKV(), fetchFn: flakyFetch });
  const B = createSyncClient({ url: URL, key: KEY, storage: memoryKV() }); // «второе устройство»

  await step('parseTeamCode понимает ссылку, «s=&k=» и «ID код»', () => {
    assert.deepEqual(parseTeamCode('https://x.io/app/#s=abc-1&k=Secret_123'), { space: 'abc-1', code: 'Secret_123' });
    assert.deepEqual(parseTeamCode('#k=K2&s=s2'), { space: 's2', code: 'K2' });
    assert.deepEqual(parseTeamCode('  team-7   CODE7 '), { space: 'team-7', code: 'CODE7' });
    assert.equal(parseTeamCode('просто текст без кода'), null);
  });

  await step('без команды: статус off, saveDoc хранит локально', async () => {
    await A.init();
    assert.equal(A.getStatus().state, 'off');
    const r = await A.saveDoc('notes', 'before', { text: 'до подключения' });
    assert.deepEqual(r, { ok: true, synced: false });
    assert.equal((await A.getDoc('notes', 'before')).text, 'до подключения');
    assert.equal(A.getStatus().pending, 1);
  });

  await step('неверный код: connectTeam -> denied, ничего не ломается', async () => {
    const r = await A.connectTeam(team.space, team.code + 'x');
    assert.deepEqual(r, { ok: false, reason: 'denied' });
    assert.equal(A.getStatus().team, null);
  });

  await step('connectTeam (space_info) подключает и отправляет накопленное', async () => {
    const r = await A.connectTeam(team.space, team.code);
    assert.deepEqual(r, { ok: true, name: 'Форман: временный тест' });
    assert.equal(await A.pushPending(), 0);
    assert.equal(A.getStatus().state, 'ok');
    const raw = await rpc('doc_get', { p_space: team.space, p_code: team.code, p_col: 'fm_notes', p_id: 'before' });
    assert.deepEqual(raw.body, { text: 'до подключения' });
  });

  await step('saveDoc -> в базе (коллекция с префиксом fm_), getDoc и listDocs', async () => {
    const r = await A.saveDoc('notes', 'shift-1', { text: 'Объект: Mission Valley', n: 3, tags: ['ac', 'duct'] });
    assert.deepEqual(r, { ok: true, synced: true });
    assert.deepEqual(await A.getDoc('notes', 'shift-1'), { text: 'Объект: Mission Valley', n: 3, tags: ['ac', 'duct'] });
    const list = await A.listDocs('notes');
    assert.deepEqual(list.map(d => d.id), ['before', 'shift-1']);
    assert.ok(list.every(d => typeof d.updatedAt === 'string'));
    const raw = await rpc('doc_list', { p_space: team.space, p_code: team.code, p_col: 'fm_notes' });
    assert.deepEqual(raw.body.map(d => d.id).sort(), ['before', 'shift-1']);
  });

  await step('второе устройство той же команды видит данные из базы', async () => {
    assert.equal((await B.connectTeam(team.space, team.code)).ok, true);
    assert.deepEqual((await B.listDocs('notes')).map(d => d.id), ['before', 'shift-1']);
    assert.equal((await B.getDoc('notes', 'shift-1')).text, 'Объект: Mission Valley');
  });

  await step('нет связи: saveDoc не бросает, хранит локально, статус offline/pending', async () => {
    online = false;
    const r = await A.saveDoc('notes', 'offline-1', { text: 'без связи' });
    assert.deepEqual(r, { ok: true, synced: false });
    assert.equal(A.getStatus().state, 'offline');
    assert.equal(A.getStatus().pending, 1);
    assert.equal((await A.getDoc('notes', 'offline-1')).text, 'без связи');      // локальная копия
    assert.ok((await A.listDocs('notes')).some(d => d.id === 'offline-1'));
    assert.equal(await B.getDoc('notes', 'offline-1'), null);                     // в базе ещё нет
  });

  await step('связь вернулась: pushPending отправляет, второе устройство видит', async () => {
    online = true;
    assert.equal(await A.pushPending(), 0);
    assert.equal(A.getStatus().state, 'ok');
    assert.equal((await B.getDoc('notes', 'offline-1')).text, 'без связи');
  });

  await step('правка с другого устройства приходит в getDoc/listDocs', async () => {
    assert.equal((await B.saveDoc('notes', 'shift-1', { text: 'изменено на B' })).synced, true);
    assert.equal((await A.getDoc('notes', 'shift-1')).text, 'изменено на B');
    assert.equal((await A.listDocs('notes')).find(d => d.id === 'shift-1').data.text, 'изменено на B');
  });

  await step('deleteDoc удаляет в базе; другое устройство это видит', async () => {
    assert.deepEqual(await A.deleteDoc('notes', 'before'), { ok: true, synced: true });
    assert.equal(await A.getDoc('notes', 'before'), null);
    assert.deepEqual((await B.listDocs('notes')).map(d => d.id), ['offline-1', 'shift-1']);
  });

  await step('неверные входные данные не бросают ошибку', async () => {
    assert.deepEqual(await A.saveDoc('bad/col', 'x', { a: 1 }), { ok: false, synced: false });
    assert.deepEqual(await A.saveDoc('notes', 'a/b', { a: 1 }), { ok: false, synced: false });
    assert.deepEqual(await A.saveDoc('notes', 'x', [1, 2]), { ok: false, synced: false });
    assert.equal(await A.getDoc('notes', ''), null);
    assert.deepEqual(await A.listDocs('bad col'), []);
  });

  await step('disconnectTeam: команда забыта, данные на устройстве остались', async () => {
    await A.disconnectTeam();
    assert.equal(A.getStatus().state, 'off');
    assert.equal((await A.getDoc('notes', 'shift-1')).text, 'изменено на B');
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
