// E2E «Форман · Р2 Сохранность и без сети» (профиль iPhone 13, Chromium):
// копия файлом → чистый браузер «Загрузить копию» (объект + фото) → повтор без дублей → битые файлы →
// более свежий/старый объект → напоминание «Сделайте копию» → без сети после первого открытия →
// (если передана папка сайта) «Есть обновление» после новой сборки.
// Запуск: node e2e-r2.js <URL> <папка скриншотов> [<папка, где лежит отдаваемый sw.js — для проверки обновления>]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2], DIR = process.argv[3], SITE_SW = process.argv[4];
const PHOTO = path.join(__dirname, 'test-photo.jpg'), ORDER = path.join(__dirname, 'test-order.png');
const TITLE = 'Копия: замена печи';
const log = [];
const ok = (name, cond, extra = '') => { log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const opts = { ...devices['iPhone 13'], acceptDownloads: true, locale: 'ru-RU', timezoneId: 'America/Los_Angeles' };

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('dialog', d => d.accept()); return p; };

  // ---------- 1. Первый телефон: объект с фото → «Сохранить копию (файл)»
  const ctx1 = await browser.newContext(opts);
  const page = watch(await ctx1.newPage());
  const T = id => page.getByTestId(id);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 20000 });
  ok('R1 пустой список: карточка «Копия и второй телефон» с «Загрузить копию», без напоминания',
    (await page.getByText('Копия и второй телефон').count()) === 1 && (await T('backup-load').isVisible()) &&
    (await T('backup-warn').count()) === 0 && (await T('backup-save').count()) === 0);

  await T('new-title').fill(TITLE);
  await T('new-order').fill('OT-BAK-1');
  await T('new-create').click();
  await T('job-screen').waitFor();
  let [fc] = await Promise.all([page.waitForEvent('filechooser'), T('pick-camera').click()]);
  await fc.setFiles(PHOTO);
  await page.getByText('добавлено и сохранено', { exact: false }).waitFor({ timeout: 15000 });
  [fc] = await Promise.all([page.waitForEvent('filechooser'), T('pick-order').click()]);
  await fc.setFiles(ORDER);
  await page.getByText('Скрин заказа добавлен', { exact: false }).waitFor({ timeout: 15000 });
  await T('item-new-name').fill('Медная труба 3/8');
  await T('item-new-qty').fill('25');
  await T('item-add').click();
  await T('check-scope').click();
  await page.waitForTimeout(1500); // автосохранение 0,7 с
  await T('job-back').first().click();
  await T('jobs-section').waitFor();
  const warn = await T('backup-warn').innerText().catch(() => '');
  ok('R2 есть объект, копии нет → «Сделайте копию»', warn.includes('Сделайте копию'), warn.slice(0, 60));
  await page.screenshot({ path: `${DIR}/r2-01-warn.png` });

  const [dl] = await Promise.all([page.waitForEvent('download'), T('backup-save').click()]);
  const bpath = `${DIR}/backup.forman.json`;
  await dl.saveAs(bpath);
  let bk = null;
  try { bk = JSON.parse(fs.readFileSync(bpath, 'utf8')); } catch { /* проверка ниже */ }
  const job = bk && bk.jobs && bk.jobs[0];
  ok('R3 файл копии: имя латиницей *.forman.json', /^forman-kopiya-\d{4}-\d\d-\d\d-\d{4}\.forman\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('R4 копия: kind/v/app, объект, «Работа» (позиция и этап)',
    !!bk && bk.kind === 'forman-backup' && bk.v === 1 && bk.app === 'forman' && bk.jobs.length === 1 && job.title === TITLE && job.orderNo === 'OT-BAK-1' &&
    bk.works[job.id] && bk.works[job.id].items.some(i => i.name === 'Медная труба 3/8') && bk.works[job.id].checks.scope === true);
  const phIds = job ? job.photos.map(p => p.id) : [];
  const phOk = !!bk && phIds.length === 2 && phIds.every(id => typeof bk.photos[id] === 'string' && bk.photos[id].startsWith('data:image/jpeg;base64,') && Buffer.from(bk.photos[id].split(',')[1], 'base64').length > 2000);
  ok('R5 копия содержит оба фото (полный JPEG как data:URL)', phOk, `фото: ${phIds.length}, ${(fs.statSync(bpath).size / 1024).toFixed(0)} КБ`);
  const dlMsg = await T('backup-msg').innerText().catch(() => '');
  ok('R6а после скачивания: просим подтвердить «Файл сохранён», дата копии ещё не записана, напоминание на месте',
    dlMsg.includes('Файл скачивается') && (await T('backup-confirm').isVisible()) && (await T('backup-warn').count()) === 1 &&
    (await page.evaluate(() => localStorage.getItem('fm.backup.last'))) === null, dlMsg.slice(0, 60));
  await T('backup-confirm').click();
  const after = await T('backup-msg').innerText().catch(() => '');
  ok('R6 после «Файл сохранён»: «Копия сохранена», напоминания нет, «Последняя копия: сегодня»',
    after.includes('Копия сохранена') && (await T('backup-warn').count()) === 0 && (await page.getByText('Последняя копия: сегодня.').count()) === 1, after.slice(0, 70));
  const last = await page.evaluate(() => localStorage.getItem('fm.backup.last'));
  ok('R7 дата копии записана в localStorage fm.backup.last', !!last && !Number.isNaN(Date.parse(last)), last || '');

  // ---------- 2. Без сети после первого открытия
  await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    const keys = (await caches.keys()).filter(k => k.startsWith('forman-sw-'));
    const c = keys.length ? await caches.open(keys[0]) : null;
    const reqs = c ? (await c.keys()).map(x => x.url) : [];
    return { scope: r && r.scope, keys, n: reqs.length, index: reqs.some(u => /\/forman\/$/.test(u)), entry: reqs.some(u => /\/_expo\/static\/js\/web\/entry-/.test(u)), laws: reqs.some(u => /\/laws\.html$/.test(u)) };
  });
  ok('R8 service worker управляет страницей, scope /fixpro-sklad-app/forman/, кэш с версией',
    !!sw.scope && sw.scope.endsWith('/fixpro-sklad-app/forman/') && sw.keys.length === 1 && sw.index && sw.entry && sw.laws, `${sw.keys[0]} · файлов ${sw.n}`);

  await ctx1.setOffline(true);
  const worker = ctx1.serviceWorkers()[0];
  const swNet = worker ? await worker.evaluate(() => fetch('/fixpro-sklad-app/forman/manifest.webmanifest?n=' + Date.now(), { cache: 'no-store' }).then(r => 'online ' + r.status, () => 'offline')) : 'нет SW';
  ok('R9 сеть выключена и для самого service worker (проверка честная)', swNet === 'offline', swNet);
  let offlineOk = true;
  try {
    await page.reload({ waitUntil: 'load', timeout: 20000 });
    await T('jobs-section').waitFor({ timeout: 20000 });
  } catch (e) { offlineOk = false; errors.push('offline reload: ' + String(e).slice(0, 120)); }
  ok('R10 без сети + перезагрузка → «Форман» открывается, объект виден',
    offlineOk && (await page.getByText(TITLE).count()) > 0 && (await page.evaluate(() => navigator.onLine)) === false);
  await page.screenshot({ path: `${DIR}/r2-02-offline-list.png` });
  if (offlineOk) {
    await page.locator('[data-testid^="job-open-"]').first().click();
    await T('job-screen').waitFor();
    await page.waitForTimeout(1000);
    const imgs = await page.$$eval('[data-testid^="thumb-"] img', xs => xs.map(i => i.complete && i.naturalWidth > 0));
    ok('R11 без сети: в объекте обе миниатюры с картинкой', imgs.length === 2 && imgs.every(Boolean), JSON.stringify(imgs));
    await page.screenshot({ path: `${DIR}/r2-03-offline-job.png` });
    await page.goto(BASE + 'laws', { waitUntil: 'load', timeout: 20000 }).catch(e => errors.push('offline laws: ' + String(e).slice(0, 100)));
    const lawsOk = await page.getByText('Законы Калифорнии').first().isVisible({ timeout: 15000 }).catch(() => false);
    ok('R12 без сети открывается и другая вкладка («Законы»)', lawsOk);
  }
  await ctx1.setOffline(false);

  // Контроль: без service worker та же проверка должна падать
  const ctx0 = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const p0 = await ctx0.newPage();
  await p0.goto(BASE, { waitUntil: 'networkidle' });
  await p0.getByTestId('jobs-section').waitFor({ timeout: 20000 });
  await ctx0.setOffline(true);
  let failed = false;
  try { await p0.reload({ waitUntil: 'load', timeout: 10000 }); failed = !(await p0.getByTestId('jobs-section').isVisible({ timeout: 3000 }).catch(() => false)); } catch { failed = true; }
  ok('R13 контроль: без service worker без сети не открывается (значит, R10 — заслуга SW)', failed);
  await ctx0.close();

  // ---------- 3. Второй телефон: чистый браузер → «Загрузить копию»
  const ctx2 = await browser.newContext(opts);
  const q = watch(await ctx2.newPage());
  const Q = id => q.getByTestId(id);
  await q.goto(BASE, { waitUntil: 'networkidle' });
  await Q('jobs-section').waitFor({ timeout: 20000 });
  ok('R14 чистый браузер: объекта нет', (await q.getByText(TITLE).count()) === 0);
  const load = async file => {
    const [ch] = await Promise.all([q.waitForEvent('filechooser'), Q('backup-load').click()]);
    await ch.setFiles(file);
    await q.waitForFunction(() => {
      const m = document.querySelector('[data-testid="backup-msg"]');
      return m && /Загружено|не копия|повреждён|новой версией|пуст|нет ни одного/.test(m.textContent || '');
    }, null, { timeout: 20000 });
    await q.waitForTimeout(300);
    return Q('backup-msg').innerText();
  };
  const jobsCount = () => q.locator('[data-testid^="job-open-"]').count();

  const m1 = await load(bpath);
  ok('R15 «Загружено: 1 объект, 2 фото; пропущено: 0.»', m1.startsWith('Загружено: 1 объект, 2 фото; пропущено: 0.'), m1.split('\n')[0]);
  await q.waitForTimeout(600); // прокрутка к началу
  const tb = await q.getByText(TITLE).first().boundingBox();
  ok('R16 объект появился в списке и виден сверху экрана', (await jobsCount()) === 1 && !!tb && tb.y >= 0 && tb.y < 844, `y=${tb && Math.round(tb.y)}`);
  ok('R16б телефон был пустой → копия есть, «Сделайте копию» не показывается', (await Q('backup-warn').count()) === 0 && (await q.getByText('Последняя копия: сегодня.').count()) === 1);
  await q.screenshot({ path: `${DIR}/r2-04-restored-list.png` });
  await q.locator('[data-testid^="job-open-"]').first().click();
  await Q('job-screen').waitFor();
  await q.waitForTimeout(1200);
  const imgs2 = await q.$$eval('[data-testid^="thumb-"] img', xs => xs.map(i => i.complete && i.naturalWidth > 0));
  ok('R17 после загрузки: обе миниатюры с картинкой (пересчитаны)', imgs2.length === 2 && imgs2.every(Boolean), JSON.stringify(imgs2));
  ok('R18 после загрузки: № заказа, своя позиция и отметка этапа на месте',
    (await Q('job-order').inputValue()) === 'OT-BAK-1' && (await q.getByText('Медная труба 3/8').count()) > 0 && (await q.getByText('Этапы · 1/', { exact: false }).count()) > 0);
  await q.screenshot({ path: `${DIR}/r2-05-restored-job.png` });
  await q.locator('[data-testid^="thumb-"]').first().click();
  await Q('photo-viewer').waitFor();
  await q.waitForTimeout(800);
  const fullW = await q.$$eval('[data-testid="photo-viewer"] img', xs => Math.max(0, ...xs.map(i => i.naturalWidth)));
  const wantW = job ? job.photos.find(p => p.kind === 'photo').w : -1;
  ok('R19 крупный просмотр: полное фото из копии (та же ширина)', fullW === wantW, `${fullW} = ${wantW}`);
  await Q('viewer-close').click();
  await Q('job-back').first().click();
  await Q('jobs-section').waitFor();

  const m2 = await load(bpath);
  ok('R20 повторная загрузка того же файла не создаёт дублей', m2.startsWith('Загружено: 0 объектов, 0 фото; пропущено: 1.') && (await jobsCount()) === 1, m2.split('\n')[0]);

  const bad1 = `${DIR}/bad-notjson.forman.json`, bad2 = `${DIR}/bad-other.json`, bad3 = `${DIR}/bad-newer.forman.json`;
  fs.writeFileSync(bad1, 'это не json {{{');
  fs.writeFileSync(bad2, JSON.stringify({ kind: 'forman-work-v03', schema: 1, items: [] }));
  fs.writeFileSync(bad3, JSON.stringify({ ...bk, v: 99 }));
  const e1 = await load(bad1);
  ok('R21 битый файл → понятная ошибка', /повреждён/.test(e1) && (await jobsCount()) === 1, e1.slice(0, 70));
  const e2 = await load(bad2);
  ok('R22 чужой JSON → «Это не копия «Формана»»', e2.startsWith('Это не копия «Формана»') && (await jobsCount()) === 1, e2.slice(0, 60));
  const e3 = await load(bad3);
  ok('R23 копия из новой версии → «обновите страницу»', /более новой версией/.test(e3) && (await jobsCount()) === 1, e3.slice(0, 60));
  await q.screenshot({ path: `${DIR}/r2-06-bad-file.png` });

  // более свежий объект в файле заменяет, более старый — нет
  const future = new Date(Date.now() + 3600e3).toISOString();
  const newer = `${DIR}/backup-newer.forman.json`, older = `${DIR}/backup-older.forman.json`;
  fs.writeFileSync(newer, JSON.stringify({ ...bk, jobs: [{ ...job, title: TITLE + ' (правка)', updatedAt: future, editedAt: future }] }));
  fs.writeFileSync(older, JSON.stringify({ ...bk, jobs: [{ ...job, title: 'Старое название', updatedAt: '2020-01-01T00:00:00.000Z', editedAt: '2020-01-01T00:00:00.000Z' }], works: {} }));
  const m3 = await load(newer);
  ok('R24 в файле поля объекта свежее → взяты из файла, без дубля', m3.startsWith('Загружено: 1 объект, 0 фото; пропущено: 0.') && (await q.getByText(TITLE + ' (правка)').count()) > 0 && (await jobsCount()) === 1, m3.split('\n')[0]);
  const m4 = await load(older);
  ok('R25 в файле объект старее → пропущен, своё не тронуто', m4.startsWith('Загружено: 0 объектов, 0 фото; пропущено: 1.') && (await q.getByText('Старое название').count()) === 0, m4.split('\n')[0]);

  // ---------- 4. Напоминание: копия старше 3 дней
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 20000 });
  await page.evaluate(() => localStorage.setItem('fm.backup.last', new Date(Date.now() - 4 * 864e5).toISOString()));
  await page.reload({ waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 20000 });
  const w4 = await T('backup-warn').innerText().catch(() => '');
  ok('R26 копия старше 3 дней → «Сделайте копию»', w4.includes('Сделайте копию') && w4.includes('4 дня'), w4.slice(0, 70));

  // ---------- 5. Новая версия сайта → «Есть обновление» → нажать → новая версия
  if (SITE_SW && fs.existsSync(SITE_SW)) {
    const orig = fs.readFileSync(SITE_SW, 'utf8');
    const m = orig.match(/const VERSION = '([^']+)'/);
    try {
      fs.writeFileSync(SITE_SW, orig.replace(m[0], `const VERSION = '${m[1]}-upd'`));
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
      await T('sw-update').waitFor({ timeout: 20000 });
      ok('R27 новая сборка → на экране «Есть обновление — нажмите, чтобы обновить»', (await T('sw-update').innerText()).includes('Есть обновление'));
      await page.screenshot({ path: `${DIR}/r2-07-update.png` });
      await Promise.all([page.waitForEvent('load', { timeout: 15000 }), T('sw-update').click()]);
      await T('jobs-section').waitFor({ timeout: 20000 });
      const upd = await page.evaluate(async () => ({ keys: (await caches.keys()).filter(k => k.startsWith('forman-sw-')) }));
      ok('R28 после нажатия: новая версия, старый кэш удалён, объект на месте',
        upd.keys.length === 1 && upd.keys[0].endsWith('-upd') && (await T('sw-update').count()) === 0 && (await page.getByText(TITLE).count()) > 0, upd.keys.join(','));
    } finally {
      fs.writeFileSync(SITE_SW, orig);
    }
  } else {
    log.push('SKIP R27–R28 обновление: не передана папка с sw.js');
  }

  ok('R29 без ошибок JS на страницах', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(log.join('\n'));
  await browser.close();
})().catch(e => { console.log(log.join('\n')); console.error('CRASH', e); process.exit(2); });
