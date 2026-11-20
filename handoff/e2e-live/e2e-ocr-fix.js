// E2E «Форман · Разбор скрина заказа — исправления после проверки», профиль iPhone 13 (Chromium).
// F1 «Qty N» строкой ниже, название кончается числом; F2 «11», прочитанное как «1»; F3 длинный скрин прокруткой
// (копия для распознавания); F4 первый разбор до того, как service worker взял страницу → потом без сети;
// F5 файл распознавания поменялся на сайте → после обновления кэш берёт новый, остальное не качается заново;
// F6 мелочи: двойное нажатие, уход с черновиком, стёртое название, пример трижды.
// Запуск: node e2e-ocr-fix.js <URL> <папка скриншотов> <папка сайта forman (dist)> <папка картинок QA> <папка Формана с scripts/>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [BASE, DIR, SITE, IMG, APP] = process.argv.slice(2);
const log = [];
const ok = (name, cond, extra = '') => { const s = `${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`; log.push(s); console.log(s); if (!cond) process.exitCode = 1; };
const info = (name, extra) => { const s = `INFO ${name} — ${extra}`; log.push(s); console.log(s); };
const opts = { ...devices['iPhone 13'], acceptDownloads: true, locale: 'ru-RU', timezoneId: 'America/Los_Angeles' };
const meta = JSON.parse(fs.readFileSync(path.join(IMG, 'meta.json'), 'utf8'));
const errors = [];

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function grade(rows, truth) {
  const res = { correct: 0, flagged: 0, wrong: [], missing: [] };
  for (const [name, qty] of truth) {
    const r = rows.find(x => norm(x.name) === norm(name)) || rows.find(x => norm(x.name).startsWith(norm(name)));
    if (!r) { res.missing.push(name); continue; }
    if (r.qty === String(qty)) res.correct++;
    else if (r.qty === '' && r.flag.includes('проверь количество')) res.flagged++;
    else res.wrong.push(`${name}: ${r.qty || '∅'} (правда ${qty})`);
  }
  return res;
}

async function setup(page) {
  page.on('pageerror', e => errors.push(String(e)));
  const T = id => page.getByTestId(id);
  const readRows = () => page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 80; k++) {
      const row = document.querySelector(`[data-testid="ocr-row-${k}"]`);
      if (!row) break;
      const val = id => (document.querySelector(`[data-testid="${id}-${k}"]`) || {}).value;
      const flag = document.querySelector(`[data-testid="ocr-flag-${k}"]`);
      const note = document.querySelector(`[data-testid="ocr-note-${k}"]`);
      out.push({ name: val('ocr-name'), qty: val('ocr-qty'), unit: val('ocr-unit'), flag: flag ? flag.textContent : '', note: note ? note.textContent : '' });
    }
    return out;
  });
  const newJob = async title => {
    if (await T('job-back').count()) { await T('job-back').click(); await page.waitForTimeout(400); }
    await T('jobs-section').waitFor({ timeout: 20000 });
    await T('new-title').fill(title);
    await T('new-create').click();
    await T('job-screen').waitFor();
    await page.waitForTimeout(800);
  };
  const addOrder = async file => {
    const before = await page.locator('[data-testid^="ocr-start-"]').count();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), T('pick-order').click()]);
    await fc.setFiles(file);
    await page.waitForFunction(n => document.querySelectorAll('[data-testid^="ocr-start-"]').length > n, before, { timeout: 30000 });
    const ids = await page.locator('[data-testid^="ocr-start-"]').evaluateAll(xs => xs.map(x => x.getAttribute('data-testid')));
    return ids[ids.length - 1];
  };
  const runOcr = async (startId, timeout = 180000) => {
    const t0 = Date.now();
    if (startId) await T(startId).click();
    const got = await Promise.race([
      T('ocr-draft').waitFor({ timeout }).then(() => 'draft'),
      page.waitForFunction(() => { const m = document.querySelector('[data-testid="ocr-msg"]'); const p = document.querySelector('[data-testid="ocr-progress"]'); return m && !p; }, null, { timeout }).then(() => 'msg'),
    ]).catch(() => 'timeout');
    const ms = Date.now() - t0;
    if (got === 'draft') return { got, ms, rows: await readRows(), stats: await T('ocr-stats').innerText() };
    return { got, ms, rows: [], msg: got === 'msg' ? await T('ocr-msg').innerText() : '' };
  };
  const cancelDraft = async () => { if (await T('ocr-cancel').count()) { await T('ocr-cancel').click(); await page.waitForTimeout(500); } };
  return { T, readRows, newJob, addOrder, runOcr, cancelDraft };
}

const ocrCache = page => page.evaluate(async () => {
  if (!(await caches.has('forman-ocr-files'))) return null;
  const c = await caches.open('forman-ocr-files');
  const out = {};
  for (const r of await c.keys()) out[r.url.split('/ocr/')[1]] = (await c.match(r)).headers.get('X-Forman-Hash');
  return out;
});

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();

  // ================= A. Качество разбора и мелочи (обычное открытие, service worker на месте)
  {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    let dialogs = [], dialogAnswer = true;
    page.on('dialog', d => { dialogs.push(d.message()); dialogAnswer ? d.accept() : d.dismiss(); });
    const { T, newJob, addOrder, runOcr, cancelDraft, readRows } = await setup(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await T('jobs-section').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30000 });

    // F1
    await newJob('F1 две строки');
    let r = await runOcr(await addOrder(path.join(IMG, 'twoline.png')));
    const truth1 = [['Flex duct 8', 12], ['Disconnect 60', 1], ['Filter MERV 13', 2], ['Supply boot', 6], ['Copper elbow', 11]];
    let g = grade(r.rows, truth1);
    info('F1 черновик', r.rows.map(x => `[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}`).join('; '));
    ok('F1 «Flex duct 8 / Qty 12», «Disconnect 60 / Qty 1», «Filter MERV 13 / Qty 2»: количество из «Qty», число — в названии; неверных нет',
      g.wrong.length === 0 && g.missing.length === 0 && ['Flex duct 8', 'Disconnect 60', 'Filter MERV 13'].every(n => r.rows.find(x => x.name === n)?.qty === String(truth1.find(t => t[0] === n)[1])),
      `верно ${g.correct}, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}], не найдено [${g.missing.join('; ')}]`);
    const dropped1 = await page.evaluate(() => (document.querySelector('[data-testid="ocr-dropped"]') || {}).innerText || '');
    ok('F1б строки «Qty N» не уходят в «Пропущенные» с причиной «нет названия»', !/Qty \d+» — нет названия/.test(dropped1), dropped1.replace(/\n/g, ' / ').slice(0, 120));
    await T('ocr-draft').screenshot({ path: `${DIR}/f1-twoline.png` });
    await cancelDraft();

    // F2
    await newJob('F2 одиннадцать');
    r = await runOcr(await addOrder(path.join(IMG, 'small39.png')));
    g = grade(r.rows, meta.small39.rows.map(x => [x[0], x[1]]));
    const motor = r.rows.find(x => x.name === 'Motor mount ring');
    info('F2 черновик', r.rows.map(x => `[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}`).join('; '));
    ok('F2 «Motor mount ring Qty 11»: не «1» без флага — пусто или 11; при пустом — «проверь количество» и причина «слились две цифры»',
      !!motor && (motor.qty === '11' || (motor.qty === '' && motor.flag.includes('проверь количество') && motor.note.includes('слились две цифры'))),
      motor ? `qty="${motor.qty}" ${motor.flag} ${motor.note}` : 'нет строки');
    ok('F2б весь скрин small39: ни одного неверного количества без флага', g.wrong.length === 0, `верно ${g.correct}/${meta.small39.rows.length}, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}], не найдено [${g.missing.join('; ')}]`);
    if (motor && motor.qty === '') {
      const k = r.rows.indexOf(motor);
      await T(`ocr-row-${k}`).scrollIntoViewIfNeeded();
      await T(`ocr-row-${k}`).screenshot({ path: `${DIR}/f2-eleven.png` });
    }
    await cancelDraft();

    // F3
    await newJob('F3 длинный скрин');
    const sid40 = await addOrder(path.join(IMG, 'long40.png'));
    const ocrDims = await page.evaluate(async id => {
      const db = await new Promise((res, rej) => { const q = indexedDB.open('forman-photos'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const get = key => new Promise(res => { const t = db.transaction('blobs').objectStore('blobs').get(key); t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
      const dims = async b => { if (!b) return null; const bm = await createImageBitmap(b); return [bm.width, bm.height, b.size]; };
      return { ocr: await dims(await get(`${id}:ocr`)), full: await dims(await get(`${id}:full`)) };
    }, sid40.replace('ocr-start-', ''));
    ok('F3 у скрина заказа копия для распознавания в ширину скрина (1170), полная — как раньше 1600 по длинной стороне',
      !!ocrDims.ocr && ocrDims.ocr[0] === 1170 && ocrDims.ocr[1] === 4960 && ocrDims.full && Math.max(ocrDims.full[0], ocrDims.full[1]) === 1600, JSON.stringify(ocrDims));
    r = await runOcr(sid40);
    g = grade(r.rows, JSON.parse(fs.readFileSync(path.join(IMG, 'long40.json'), 'utf8')));
    ok('F3б скрин прокруткой 1170×4960, 40 позиций: найдено ≥ 38 верно, неверных без флага нет (было 5 из 40)', g.correct >= 38 && g.wrong.length === 0,
      `верно ${g.correct}/40, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}], не найдено ${g.missing.length}; ${r.ms} мс; ${r.stats}`);
    await cancelDraft();
    // скрин, добавленный до исправления (или из копии файлом): есть только полная копия 377×1600 → увеличение в prepare()
    await page.evaluate(async id => {
      const db = await new Promise((res, rej) => { const q = indexedDB.open('forman-photos'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      await new Promise(res => { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').delete(`${id}:ocr`); t.oncomplete = res; });
    }, sid40.replace('ocr-start-', ''));
    r = await runOcr(sid40);
    g = grade(r.rows, JSON.parse(fs.readFileSync(path.join(IMG, 'long40.json'), 'utf8')));
    ok('F3г старый скрин (только копия 377×1600, без копии для распознавания) → увеличение перед распознаванием: ≥ 38 верно, неверных нет',
      g.correct >= 38 && g.wrong.length === 0, `верно ${g.correct}/40, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}], не найдено ${g.missing.length}; ${r.ms} мс`);
    await cancelDraft();
    r = await runOcr(await addOrder(path.join(IMG, 'long30.png')));
    g = grade(r.rows, meta.long30.rows.map(x => [x[0], x[1]]));
    ok('F3в скрин 1170×4570, 30 позиций: ≥ 28 верно, неверных без флага нет (было 26, одно неверное)', g.correct >= 28 && g.wrong.length === 0,
      `верно ${g.correct}/30, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}], не найдено [${g.missing.join('; ')}]; ${r.ms} мс`);
    await cancelDraft();
    await page.waitForTimeout(1500);
    const offTxt = await T('ocr-offline').innerText().catch(() => '');
    ok('F4а после удачного разбора на экране: «Модуль распознавания сохранён на этом телефоне — работает и без сети»', offTxt.includes('сохранён на этом телефоне'), offTxt);

    // F6d: пример трижды → один
    await newJob('F6 пример трижды');
    for (let k = 0; k < 3; k++) {
      await T('ocr-sample').click();
      await T('ocr-draft').waitFor({ timeout: 120000 });
      await cancelDraft();
    }
    const thumbs = await page.locator('[data-testid^="thumb-"]').evaluateAll(xs => xs.map(x => x.innerText));
    const summary = await T('job-summary').innerText();
    const warnReal = await page.getByText('Нет скрина настоящего заказа', { exact: false }).count();
    ok('F6г «Попробовать на примере» три раза → в объекте один «ПРИМЕР»; в итоге «скрин заказа: 0 (+ пример)», предупреждение про настоящий заказ',
      thumbs.length === 1 && thumbs[0].includes('ПРИМЕР') && summary.includes('скрин заказа: 0 (+ пример)') && warnReal === 1, `${thumbs.length} миниатюр; ${summary.slice(0, 60)}`);
    await page.waitForTimeout(800);
    const [dl] = await Promise.all([page.waitForEvent('download'), T('job-report').click()]);
    const rp = `${DIR}/report-f6.txt`;
    await dl.saveAs(rp);
    const txt = fs.readFileSync(rp, 'utf8');
    ok('F6г2 в отчёте: «Скрины заказа: 0» и отдельной строкой «Пример скрина заказа (вымышленный…): 1»', /Скрины заказа: 0\n/.test(txt) && txt.includes('Пример скрина заказа (вымышленный, для проверки разбора; не настоящий заказ): 1'));

    // F6a: два нажатия «Разобрать» в одном такте
    const sid = await page.locator('[data-testid^="ocr-start-"]').first().getAttribute('data-testid');
    await page.evaluate(id => { const el = document.querySelector(`[data-testid="${id}"]`); el.click(); el.click(); }, sid);
    await T('ocr-draft').waitFor({ timeout: 120000 });
    await page.waitForTimeout(2500);
    const msgAfterDouble = await T('ocr-msg').innerText().catch(() => '');
    ok('F6а два нажатия «Разобрать» в одном такте → один разбор: черновик, без «Распознавание остановлено», прогресса нет',
      (await T('ocr-draft').count()) === 1 && !msgAfterDouble.includes('остановлено') && (await T('ocr-progress').count()) === 0, msgAfterDouble.slice(0, 60) || 'сообщения нет');

    // F6b: уход к списку с открытым черновиком
    await T('ocr-name-0').fill('Bar type supply registers 10x6 (правка)');
    dialogs = []; dialogAnswer = false;
    await T('job-back').click();
    await page.waitForTimeout(500);
    ok('F6б «← Все объекты» с черновиком → вопрос «Черновик со скрина не подтверждён…»; «Нет» — остаёмся, правка на месте',
      dialogs.length === 1 && dialogs[0].includes('Черновик со скрина не подтверждён') && (await T('job-screen').count()) === 1 &&
      (await T('ocr-name-0').inputValue()) === 'Bar type supply registers 10x6 (правка)', dialogs.join(' | ').slice(0, 100));
    dialogAnswer = true;

    // F6c: стёртое название
    const before = await readRows();
    await T('ocr-name-0').fill('');
    await T('ocr-confirm').click();
    await T('ocr-msg').waitFor();
    const m6 = await T('ocr-msg').innerText();
    ok('F6в строка со стёртым названием не добавлена — и об этом сказано', m6.includes('Строки без названия не добавлены: 1') && m6.startsWith(`Добавлено в сверку: ${before.length - 1}`), m6.slice(0, 160));

    // F6b2: без черновика — уход без вопроса; с черновиком и «Да» — уходим
    await runOcr(sid);
    dialogs = [];
    await T('job-back').click();
    await T('jobs-section').waitFor({ timeout: 5000 });
    ok('F6б2 с черновиком и ответом «Да» — к списку объектов', dialogs.length === 1);
    await page.locator('[data-testid^="job-open-"]').first().click();
    await T('job-screen').waitFor();
    dialogs = [];
    await T('job-back').click();
    await T('jobs-section').waitFor({ timeout: 5000 });
    ok('F6б3 без черновика — к списку без вопроса', dialogs.length === 0);
    await ctx.close();
  }

  // ================= B. F4: первый разбор до того, как service worker взял страницу (медленная первая загрузка)
  {
    const ctx = await browser.newContext(opts);
    let delayed = 0;
    await ctx.route(/_expo\/static\/js\/web\/laws-.*\.js$/, async route => { delayed++; await new Promise(r => setTimeout(r, 25000)); await route.continue().catch(() => {}); });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const { T, newJob, runOcr, cancelDraft } = await setup(page);
    await page.goto(BASE, { waitUntil: 'load' });
    await T('jobs-section').waitFor({ timeout: 20000 });
    await newJob('F4 первый раз');
    const controlledAtStart = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await T('ocr-sample').click();
    await T('ocr-draft').waitFor({ timeout: 120000 });
    await cancelDraft();
    const cacheRightAfter = await ocrCache(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 90000 }).catch(() => {});
    await T('ocr-offline').waitFor({ timeout: 60000 }).catch(() => {});
    const cacheLater = await ocrCache(page);
    info('F4 состояние', `SW управлял страницей при нажатии=${controlledAtStart}, задержано файлов=${delayed}; кэш OCR сразу: ${JSON.stringify(cacheRightAfter && Object.keys(cacheRightAfter))}; позже: ${JSON.stringify(cacheLater && Object.keys(cacheLater))}`);
    ok('F4 разбор прошёл до service worker → когда он включился, файлы распознавания сохранены в forman-ocr-files',
      !controlledAtStart && !!cacheLater && ['t7/worker.min.js', 't7/eng.traineddata.gz', 't7/tesseract.min.js', 'primer-zakaza.png'].every(f => cacheLater[f]) && Object.keys(cacheLater).some(f => /core/.test(f)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache'); // «через полчаса»: HTTP-кэш браузера уже не помогает
    await ctx.setOffline(true);
    let opened = true;
    try { await page.reload({ waitUntil: 'load', timeout: 20000 }); await T('jobs-section').waitFor({ timeout: 20000 }); } catch { opened = false; }
    let res = { got: 'не открылось' };
    if (opened) {
      await page.locator('[data-testid^="job-open-"]').first().click();
      await T('job-screen').waitFor();
      await page.waitForTimeout(800);
      res = await runOcr(await page.locator('[data-testid^="ocr-start-"]').first().getAttribute('data-testid'), 60000);
    }
    ok('F4б потом без сети (HTTP-кэш очищен) «Разобрать» работает: «Bar type…» = 6 (шаг 9 Георгия)', res.got === 'draft' && res.rows.some(x => (x.name || '').startsWith('Bar type') && x.qty === '6'), `${res.got} ${(res.msg || '').slice(0, 100)}`);
    await ctx.setOffline(false);
    await ctx.close();
  }

  // ================= C. F5: файл распознавания поменялся на сайте
  {
    const SW = path.join(SITE, 'sw.js'), PNG = path.join(SITE, 'ocr', 'primer-zakaza.png');
    const swOrig = fs.readFileSync(SW), pngOrig = fs.readFileSync(PNG);
    const ctx = await browser.newContext(opts);
    const reqs = [];
    ctx.on('request', q => reqs.push(q.url()));
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const { T, newJob, cancelDraft } = await setup(page);
    try {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await T('jobs-section').waitFor({ timeout: 20000 });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
      await newJob('F5 обновление файла');
      await T('ocr-sample').click();
      await T('ocr-draft').waitFor({ timeout: 120000 });
      await cancelDraft();
      await page.waitForTimeout(1500);
      const c0 = await ocrCache(page);
      // на сайте: новый пример (байты добавлены в конец PNG — картинка та же, файл другой) + пересобранный sw.js
      fs.writeFileSync(PNG, Buffer.concat([pngOrig, Buffer.from('forman-e2e-new-sample')]));
      fs.copyFileSync(path.join(APP, 'public', 'sw.js'), SW);
      const stamp = execFileSync('node', [path.join(APP, 'scripts', 'sw-stamp.mjs'), SITE], { encoding: 'utf8' });
      const newHash = (fs.readFileSync(SW, 'utf8').match(/"ocr\/primer-zakaza\.png": "([0-9a-f]+)"/) || [])[1];
      info('F5 новая сборка', stamp.trim());
      // до обновления — прежний файл из кэша (одна версия целиком)
      const before = await page.evaluate(async () => (await (await fetch('ocr/primer-zakaza.png')).arrayBuffer()).byteLength);
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
      await T('sw-update').waitFor({ timeout: 20000 });
      await Promise.all([page.waitForEvent('load', { timeout: 15000 }), T('sw-update').click()]);
      await T('jobs-section').waitFor({ timeout: 20000 });
      await page.waitForTimeout(1000);
      const c1 = await ocrCache(page);
      const n0 = reqs.length;
      const after = await page.evaluate(async () => (await (await fetch('ocr/primer-zakaza.png')).arrayBuffer()).byteLength);
      await page.waitForTimeout(500);
      const c2 = await ocrCache(page);
      ok('F5 до обновления телефон берёт прежний пример из кэша; после «Есть обновление» — новый файл с сайта, в кэше с новым хэшем',
        before === pngOrig.length && after === pngOrig.length + 21 && !c1['primer-zakaza.png'] && c2['primer-zakaza.png'] === newHash && c0['primer-zakaza.png'] !== newHash,
        `было ${before} Б, стало ${after} Б; хэш в кэше ${c0['primer-zakaza.png']} → ${c2['primer-zakaza.png']} (в sw.js ${newHash})`);
      ok('F5б остальные файлы распознавания пережили обновление (модель и ядро заново не качаются)',
        ['t7/eng.traineddata.gz', 't7/worker.min.js', 't7/tesseract.min.js'].every(f => c1[f] && c1[f] === c0[f]), JSON.stringify(Object.keys(c1)));
      // новый объект → пример → разбор: модель/ядро не скачиваются (из кэша)
      await newJob('F5 разбор после обновления');
      await T('ocr-sample').click();
      await T('ocr-draft').waitFor({ timeout: 120000 });
      const heavy = reqs.slice(n0).filter(u => /eng\.traineddata|core.*wasm/.test(u));
      const fromNet = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /eng\.traineddata|wasm\.js/.test(e.name)).map(e => e.transferSize));
      info('F5 запросы после обновления', `${heavy.length} запросов к модели/ядру (идут через service worker), transferSize страницы: ${JSON.stringify(fromNet)}`);
      ok('F5в разбор после обновления работает', (await page.locator('[data-testid^="ocr-row-"]').count()) === 6);
    } finally {
      fs.writeFileSync(PNG, pngOrig);
      fs.writeFileSync(SW, swOrig);
      await ctx.close();
    }
  }

  ok('F7 без ошибок JS на страницах', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('ИТОГ:', log.filter(x => x.startsWith('PASS')).length, 'PASS /', log.filter(x => x.startsWith('FAIL')).length, 'FAIL');
  await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
