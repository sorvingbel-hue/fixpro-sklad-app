// Проверка собранной веб-версии в jsdom (без настоящего браузера): вкладки, пример объекта, «Всё загружено»,
// фото по шагам (без выбора файла), «Сюрприз», язык отчёта, переходы из «Ещё».
// Запуск: npm run web:export, затем в папке с jsdom@25 и fake-indexeddb@6: node tests/smoke-web.mjs <путь к dist>.
// Выбор фото и меню «Поделиться» здесь не проверяются — только на телефоне.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import 'fake-indexeddb/auto';

const root = process.argv[2];
const base = '/fixpro-sklad-app/forman';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(base)) { res.writeHead(404); return res.end(); }
  u = u.slice(base.length) || '/';
  let f = path.join(root, u);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, r));
const port = srv.address().port;
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(String(e.message || e)));
vc.on('error', e => errors.push(String(e)));
const dom = await JSDOM.fromURL(`http://localhost:${port}${base}/`, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.indexedDB = globalThis.indexedDB; w.IDBKeyRange = globalThis.IDBKeyRange;
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.scrollTo = () => {};
    w.confirm = () => true;
  },
});
const w = dom.window, doc = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, what, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } throw new Error('timeout: ' + what + '\n' + doc.body.textContent.slice(0, 1500)); };
const byId = id => doc.querySelector(`[data-testid="${id}"]`);
const text = () => doc.body.textContent;
const click = el => { el.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true })); el.click(); };
const typeIn = (el, v) => {
  const input = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el : el.querySelector('input,textarea');
  const proto = input.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, v);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

try {
  await until(() => text().includes('Работы'), 'app renders');
  const tabs = [...doc.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim());
  ok(tabs.length === 2 && tabs[0].includes('Работы') && tabs[1].includes('Ещё'), `bottom tabs = ${JSON.stringify(tabs)}`);
  ok(!text().includes('Практика'), 'no training segments on main screen');

  // demo job: has truck items
  click(await until(() => [...doc.querySelectorAll('[role="button"]')].find(b => b.textContent.includes('Посмотреть пример')), 'demo button'));
  await until(() => byId('job-screen'), 'job screen');
  ok(!!byId('truck-all'), '«Всё загружено» button shown');
  ok(text().includes('4. Фото по шагам · 0/8'), 'photo steps 0/8');
  ok(!!byId('shoot-disconnect'), 'step «Disconnect» has shoot button');
  ok(!text().includes('5. Этапы'), 'old checkbox stages removed');
  click(byId('truck-all'));
  await until(() => !byId('truck-all'), 'all loaded applied');
  const furnaceRow = doc.querySelector('[data-testid="truck-row-furnace"]');
  ok(!!furnaceRow, 'furnace row');
  click(byId('truck-no-gas'));
  await until(() => text().includes('не хватает 1'), 'missing count in header');
  ok(text().includes('Не хватает до сдачи'), 'gaps list shown');
  ok(text().includes('нет фото: До начала'), 'gaps mention missing photo steps');

  // surprise without photo
  click(byId('surprise-new'));
  typeIn(await until(() => byId('surprise-text'), 'surprise text'), 'Гнилая площадка');
  await sleep(200);
  click(byId('surprise-save'));
  await until(() => text().includes('Сюрприз записан'), 'surprise saved');
  ok(text().includes('ещё не отправлено'), 'surprise marked not sent');
  ok(text().includes('сюрприз не отправлен: 1'), 'gaps mention unsent surprise');

  // report language: default English, copy text via clipboard stub
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { copied = t; } }, configurable: true });
  click(byId('job-copy'));
  await until(() => copied, 'report copied');
  ok(copied.startsWith('JOB: '), 'report is English by default');
  ok(copied.includes('Missing on the truck:') && copied.includes('Gas valve'), 'report lists missing item');
  ok(copied.includes('SURPRISES (not in the order)') && copied.includes('NOT SENT YET'), 'report lists unsent surprise');
  ok(copied.includes('✗ Disconnect & clearance: no photo'), 'report lists missing photo step');
  click(byId('lang-ru'));
  await sleep(200);
  copied = '';
  click(byId('job-copy'));
  await until(() => copied, 'report copied ru');
  ok(copied.startsWith('ОБЪЕКТ: '), 'report switches to Russian');

  // persistence: reload shows job and language kept
  await sleep(1200);
  const keys = Object.keys(w.localStorage);
  ok(keys.some(k => k.includes('reportLang')), 'language saved on device');
  const jobs = JSON.parse(w.localStorage.getItem(keys.find(k => k.includes('fm.jobs'))) || '[]');
  ok(jobs[0]?.surprises?.length === 1, 'surprise stored with job');

  // «Ещё» has the hidden sections
  click(byId('job-back'));
  await sleep(300);
  const moreTab = [...doc.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes('Ещё'));
  click(moreTab);
  await until(() => byId('more-laws'), 'more screen tools');
  ok(!!byId('more-training') && !!byId('more-library') && !!byId('more-sklad'), 'training, library, sklad reachable from Ещё');
  w.console.warn = (...a) => errors.push('warn: ' + a.join(' '));
  w.console.error = (...a) => errors.push('err: ' + a.join(' '));
  const ps = w.history.pushState.bind(w.history), rs = w.history.replaceState.bind(w.history);
  w.history.pushState = (a, b, u) => { console.log('pushState', u); return ps(a, b, u); };
  w.history.replaceState = (a, b, u) => { console.log('replaceState', u); return rs(a, b, u); };
  click(byId('more-training'));
  await sleep(3000);
  console.log('after training click:', w.location.pathname, /Практика/.test(text()), 'hist', w.history.length);
  click(byId('more-laws'));
  await sleep(3000);
  console.log('path after click:', w.location.pathname, 'errors:', errors.slice(-5));
  await until(() => w.location.pathname.endsWith('/ref/laws') && text().length > 3000, 'laws opens');
  ok(true, 'laws screen opens from Ещё');

  const real = errors.filter(e => !/Not implemented|Could not load (img|link)|css|serviceWorker|canvas/i.test(e));
  ok(real.length === 0, 'no page errors' + (real.length ? ': ' + real.slice(0, 5).join(' | ') : ''));
  console.log('SMOKE PASS');
} catch (e) {
  console.log(String(e.stack || e));
  console.log('errors:', errors.slice(0, 8));
  process.exitCode = 1;
} finally {
  w.close();
  srv.close();
}
