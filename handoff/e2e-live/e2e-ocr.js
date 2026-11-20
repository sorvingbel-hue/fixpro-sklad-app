// E2E «Форман · Разбор скрина заказа (распознавание на телефоне)», профиль iPhone 13 (Chromium):
// новый объект → «Попробовать разбор на примере» → НАСТОЯЩЕЕ распознавание (tesseract.js в браузере) → черновик
// («Bar type…» = 6, размазанная цифра → пусто + «проверь количество») → отмена ничего не меняет → повторный разбор →
// правки черновика → «Подтвердить» → сверка «заказано 6» → «в траке 4» → итог «не хватает 2» → повторы не задваиваются →
// свой скрин другого содержания (доказательство, что это не подставленный текст) → без сети: открытие и разбор из кэша →
// без кэша и без сети: честная ошибка, сверка не меняется. Скрин никуда не отправляется: проверяются все запросы.
// Запуск: node e2e-ocr.js <URL> <папка скриншотов>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2], DIR = process.argv[3];
const ORDER2 = path.join(__dirname, 'test-order-ocr2.png');
const ORIGIN = new URL(BASE).origin;
const log = [];
const ok = (name, cond, extra = '') => { log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const opts = { ...devices['iPhone 13'], acceptDownloads: true, locale: 'ru-RU', timezoneId: 'America/Los_Angeles' };
const timings = {};

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const requests = [];
  const ctx = await browser.newContext(opts);
  ctx.on('request', r => requests.push({ url: r.url(), method: r.method(), body: (r.postData() || '').length }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  const T = id => page.getByTestId(id);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  const precacheOcr = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter(k => k.startsWith('forman-sw-'));
    const c = await caches.open(keys[0]);
    return (await c.keys()).filter(x => x.url.includes('/ocr/')).length;
  });
  ok('O0 модуль распознавания не входит в общий офлайн-кэш (грузится по требованию)', precacheOcr === 0, `в общем кэше /ocr/: ${precacheOcr}`);

  await T('new-title').fill('OCR: проверка заказа');
  await T('new-create').click();
  await T('job-screen').waitFor();
  await page.waitForTimeout(800); // экран объекта сам прокручивается к началу (~0,5 с)
  const where = await T('ocr-where').innerText();
  ok('O1 на экране: «Распознавание идёт на телефоне, скрин никуда не отправляется»', where.includes('Распознавание идёт на телефоне, скрин никуда не отправляется'));
  ok('O1б на экране сказано про первую загрузку модуля (до 7 МБ) и работу без сети', (await page.getByText('При первом «Разобрать»', { exact: false }).count()) === 1);
  const before = await page.evaluate(() => Object.keys(localStorage).filter(k => /^fm\.job\..+\.work$/.test(k)).map(k => JSON.parse(localStorage.getItem(k)).items.length));

  // ---------- 1. Пример в один тап → настоящее распознавание
  const progress = new Set();
  const n0 = requests.length;
  const tStart = Date.now();
  await T('ocr-sample').click();
  let shot = false;
  const poll = setInterval(async () => {
    const t = await T('ocr-progress-text').innerText({ timeout: 200 }).catch(() => '');
    if (t) progress.add(t.replace(/\d+%/, 'N%'));
    if (t && !shot && t.startsWith('Распознаю')) { shot = true; await page.screenshot({ path: `${DIR}/ocr-00-progress.png` }).catch(() => {}); }
  }, 150);
  await T('ocr-draft').waitFor({ timeout: 180000 });
  clearInterval(poll);
  timings.firstRunMs = Date.now() - tStart;
  const stats1 = await T('ocr-stats').innerText();
  timings.firstStats = stats1;
  await T('ocr-draft').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/ocr-01-draft.png` });
  ok('O2 был виден прогресс «Загружаю модуль… N%» и «Распознаю… N%»', progress.has('Загружаю модуль распознавания… N%') && progress.has('Распознаю… N%'), [...progress].join(' | '));
  const ocrReq = requests.slice(n0).map(r => r.url).filter(u => u.includes('/ocr/'));
  const need = ['/ocr/primer-zakaza.png', '/ocr/t7/tesseract.min.js', '/ocr/t7/worker.min.js', '/ocr/t7/eng.traineddata.gz'];
  ok('O3 файлы распознавания скачаны с этого же сайта (свой сайт, без CDN)',
    need.every(n => ocrReq.some(u => u.startsWith(ORIGIN) && u.includes(n))) && ocrReq.some(u => /tesseract-core-(simd-)?lstm\.wasm\.js$/.test(u)),
    ocrReq.map(u => u.split('/ocr/')[1]).join(', '));
  const workers = page.workers().map(w => w.url());
  ok('O3б распознавание шло в фоновом потоке (Web Worker с адреса сайта)', workers.some(u => u.includes('/ocr/t7/worker.min.js')) || ocrReq.some(u => u.includes('worker.min.js')), workers.join(', ') || 'поток уже закрыт (это нормально)');

  const readRows = async () => page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 60; k++) {
      const row = document.querySelector(`[data-testid="ocr-row-${k}"]`);
      if (!row) break;
      const val = id => (document.querySelector(`[data-testid="${id}-${k}"]`) || {}).value;
      const flag = document.querySelector(`[data-testid="ocr-flag-${k}"]`);
      out.push({ name: val('ocr-name'), qty: val('ocr-qty'), unit: val('ocr-unit'), flag: flag ? flag.textContent : '', bg: getComputedStyle(row).backgroundColor });
    }
    return out;
  });
  let rows = await readRows();
  const reg = rows.find(r => (r.name || '').startsWith('Bar type supply registers'));
  ok('O4 черновик (из распознавания): «Bar type supply registers 10x6» с количеством 6', !!reg && reg.qty === '6', reg ? `${reg.name} = ${reg.qty}` : JSON.stringify(rows.map(r => r.name)));
  const pump = rows.find(r => r.name === 'Condensate pump');
  ok('O5 размазанная цифра: поле количества пустое, оранжевое «проверь количество»',
    !!pump && pump.qty === '' && pump.flag.includes('проверь количество') && pump.bg === 'rgb(255, 231, 214)', pump ? `qty="${pump.qty}" flag="${pump.flag}" bg=${pump.bg}` : 'нет строки');
  ok('O6 итоги, цены, телефон, адрес — не в черновике; всего 6 позиций',
    rows.length === 6 && !rows.some(r => /total|tax|phone|sample way|customer|\$/i.test(r.name)), rows.map(r => `${r.name}=${r.qty}`).join('; '));
  const workAfterDraft = await page.evaluate(() => Object.keys(localStorage).filter(k => /^fm\.job\..+\.work$/.test(k)).map(k => JSON.parse(localStorage.getItem(k)).items.length));
  ok('O7 до подтверждения сверка не изменилась (0 позиций на экране и в памяти)',
    (await page.locator('[data-testid^="item-remove-"]').count()) === 0 && workAfterDraft.every(n => n === 0) && before.every(n => n === 0), JSON.stringify(workAfterDraft));
  const thumbBadge = await page.locator('[data-testid^="thumb-"]').first().innerText();
  ok('O8 пример добавлен в объект как скрин заказа с пометкой «ПРИМЕР» (настоящим заказом не считается)', thumbBadge.includes('ПРИМЕР') && (await page.getByText('скрин заказа: 0 (+ пример)', { exact: false }).count()) > 0, thumbBadge);

  // ---------- 2. Отмена черновика
  await T('ocr-cancel').click();
  await T('ocr-msg').waitFor();
  await page.waitForTimeout(1200);
  const cancelMsg = await T('ocr-msg').innerText();
  const workAfterCancel = await page.evaluate(() => Object.keys(localStorage).filter(k => /^fm\.job\..+\.work$/.test(k)).map(k => JSON.parse(localStorage.getItem(k)).items.length));
  ok('O9 «Отмена» → черновик закрыт, сверка не изменилась', cancelMsg.includes('сверка не изменилась') && (await T('ocr-draft').count()) === 0 &&
    (await page.locator('[data-testid^="item-remove-"]').count()) === 0 && workAfterCancel.every(n => n === 0), cancelMsg);

  // ---------- 3. Повторный разбор того же скрина (из кэша) → правки → подтвердить
  const sampleThumb = await page.locator('[data-testid^="ocr-start-"]').first().getAttribute('data-testid');
  const n1 = requests.length;
  const t2 = Date.now();
  await T(sampleThumb).click();
  await T('ocr-draft').waitFor({ timeout: 120000 });
  timings.warmRunMs = Date.now() - t2;
  timings.warmStats = await T('ocr-stats').innerText();
  const swServed = await page.evaluate(async () => {
    const c = await caches.open('forman-ocr-files');
    return (await c.keys()).map(r => r.url.split('/ocr/')[1]);
  });
  ok('O10 файлы распознавания лежат в отдельном кэше forman-ocr-files (второй разбор и офлайн — оттуда)',
    ['t7/worker.min.js', 't7/eng.traineddata.gz', 't7/tesseract.min.js'].every(f => swServed.includes(f)) && swServed.some(f => /core/.test(f)), swServed.join(', '));
  rows = await readRows();
  const thermo = rows.findIndex(r => (r.name || '').startsWith('Thermostat'));
  await T('ocr-more').click(); // [точечная правка] уверенные строки свёрнуты в «Ещё N строк без вопросов» — раскрыть, чтобы править
  await T(`ocr-del-${thermo}`).click();
  await T('ocr-add-row').click();
  rows = await readRows();
  const last = rows.length - 1;
  await T(`ocr-name-${last}`).fill('Медная труба 3/8');
  await T(`ocr-qty-${last}`).fill('25');
  await T(`ocr-unit-${last}`).fill('фут');
  rows = await readRows();
  ok('O11 черновик правится: строка удалена, строка добавлена вручную', rows.length === 6 && !rows.some(r => (r.name || '').startsWith('Thermostat')) && rows[last].name === 'Медная труба 3/8');
  ok('O11б предупреждение «Без количества: 1» перед подтверждением', (await T('ocr-noqty').innerText()).includes('Без количества: 1'));
  await page.screenshot({ path: `${DIR}/ocr-02-edited.png` });
  await T('ocr-confirm').click();
  await T('ocr-msg').waitFor();
  const addMsg = await T('ocr-msg').innerText();
  ok('O12 «Подтвердить» → «Добавлено в сверку: 6», черновик закрыт', addMsg.startsWith('Добавлено в сверку: 6') && addMsg.includes('Без количества: 1') && (await T('ocr-draft').count()) === 0, addMsg.slice(0, 120));
  await page.waitForTimeout(1500); // автосохранение 0,7 с
  const work = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => /^fm\.job\..+\.work$/.test(x));
    return JSON.parse(localStorage.getItem(k));
  });
  const regItem = work.items.find(i => i.name === 'Bar type supply registers 10x6');
  const pumpItem = work.items.find(i => i.name === 'Condensate pump');
  ok('O13 в сверке: «Bar type…» заказано 6 = нужно 6, в траке пусто, «не проверял», источник — скрин заказа (ПРИМЕР)',
    !!regItem && regItem.ordered === 6 && regItem.required === 6 && regItem.actual === '' && regItem.status === 'unknown' && regItem.source === 'скрин заказа (ПРИМЕР, вымышленный)', JSON.stringify(regItem && { o: regItem.ordered, r: regItem.required, a: regItem.actual, s: regItem.status, src: regItem.source }));
  ok('O13б позиция с нечитабельным количеством добавлена без количества (не угадано)', !!pumpItem && pumpItem.required === null && pumpItem.ordered === '');
  const card = page.locator(`xpath=//*[@data-testid="work-verdict-${regItem.id}"]/..`);
  ok('O14 на экране сверки у позиции «Заказано» = 6 и «Требуется: 6 шт. Источник: скрин заказа (ПРИМЕР, вымышленный).»',
    (await card.locator('input[aria-label="Заказано"]').inputValue()) === '6' && (await card.getByText('Требуется: 6 шт. Источник: скрин заказа (ПРИМЕР, вымышленный).').count()) === 1);

  // ---------- 4. В траке 4 → итог «не хватает 2»
  await card.locator('input[aria-label="В траке"]').fill('4');
  await page.waitForTimeout(400);
  const verdictTxt = await T(`work-verdict-${regItem.id}`).innerText();
  const short = await T('job-shortage').innerText();
  ok('O15 сверка: «Не хватает: 2 шт.» (существующий verdict)', verdictTxt.includes('Не хватает: 2 шт.'), verdictTxt);
  ok('O16 «6. Итог» → блок «Недостача по заказу»: заказано 6, в траке 4 — не хватает 2',
    short.includes('Недостача по заказу') && short.includes('Bar type supply registers 10x6 [ПРИМЕР]: заказано 6, в траке 4 — не хватает 2 шт.'), short.replace(/\n/g, ' / ').slice(0, 160));
  await T('job-shortage').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/ocr-03-itog.png` });
  await page.waitForTimeout(1000);
  const [dl] = await Promise.all([page.waitForEvent('download'), T('job-report').click()]);
  const rp = `${DIR}/report-ocr.txt`;
  await dl.saveAs(rp);
  const txt = fs.readFileSync(rp, 'utf8');
  ok('O17 в отчёте .txt есть «НЕДОСТАЧА ПО ЗАКАЗУ» и «не хватает 2»', txt.includes('НЕДОСТАЧА ПО ЗАКАЗУ:') && txt.includes('в траке 4 — не хватает 2 шт.'));

  // ---------- 5. Повторный разбор → повторы не задваиваются молча
  // [точечная правка] повтор показывается прямо в строке черновика: «Уже есть в сверке: … Что сделать?» и выбор
  // «Оставить как есть» (по умолчанию) / «Заменить количество» / «Добавить отдельной позицией»; отдельного окна «Без повторов» нет
  await T(sampleThumb).click();
  await T('ocr-draft').waitFor({ timeout: 120000 });
  rows = await readRows();
  const regK = rows.findIndex(r => (r.name || '').startsWith('Bar type supply registers'));
  const dupTxt = regK >= 0 ? await T(`ocr-dupinfo-${regK}`).innerText() : '';
  const keepTxt = regK >= 0 ? await T(`ocr-dupkeep-${regK}`).innerText() : '';
  ok('O18 повторы: в строке «Уже есть в сверке: «Bar type supply registers 10x6» …», по умолчанию «● Оставить как есть»',
    dupTxt.includes('Уже есть в сверке:') && dupTxt.includes('Bar type supply registers 10x6') && keepTxt.startsWith('●'), `${dupTxt.slice(0, 100)} | ${keepTxt}`);
  await T('ocr-confirm').click();
  await page.waitForTimeout(1500);
  const work2 = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => /^fm\.job\..+\.work$/.test(x));
    return JSON.parse(localStorage.getItem(k));
  });
  const regCount = work2.items.filter(i => i.name === 'Bar type supply registers 10x6').length;
  ok('O19 «Подтвердить» с выбором по умолчанию («оставить») → добавлена только новая (Thermostat), «Bar type…» одна, «в траке 4» не тронуто',
    regCount === 1 && work2.items.length === 7 && work2.items.some(i => i.name.startsWith('Thermostat')) && work2.items.find(i => i.name.startsWith('Bar type')).actual === '4', `позиций ${work2.items.length}, Bar type × ${regCount}`);

  // ---------- 6. Свой скрин другого содержания (не пример) → настоящее распознавание
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), T('pick-order').click()]);
  await fc.setFiles(ORDER2);
  await page.getByText('Скрин заказа добавлен', { exact: false }).waitFor({ timeout: 15000 });
  const startIds = await page.locator('[data-testid^="ocr-start-"]').evaluateAll(xs => xs.map(x => x.getAttribute('data-testid')));
  await T(startIds[startIds.length - 1]).click();
  await T('ocr-draft').waitFor({ timeout: 120000 });
  rows = await readRows();
  const get = n => rows.find(r => (r.name || '').startsWith(n));
  ok('O20 свой скрин: «Copper line set…» Qty: 2, «Disconnect box 60A» x4, «Wire nuts» 10 pcs',
    get('Copper line set')?.qty === '2' && get('Disconnect box 60A')?.qty === '4' && get('Wire nuts')?.qty === '10', rows.map(r => `${r.name}=${r.qty}`).join('; '));
  const fb = get('Filter base');
  ok('O21 нечитабельное количество на своём скрине → пустое поле и «проверь количество»', !!fb && fb.qty === '' && fb.flag.includes('проверь количество'), fb ? `qty="${fb.qty}" ${fb.flag}` : 'нет строки');
  await page.screenshot({ path: `${DIR}/ocr-04-own-screen.png` });
  await T('ocr-cancel').click();
  await page.waitForTimeout(1200);
  const work3 = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(x => /^fm\.job\..+\.work$/.test(x)))).items.length);
  ok('O22 отмена второго черновика — сверка та же (7)', work3 === 7, String(work3));

  // ---------- 7. Скрин никуда не отправляется
  const foreign = requests.filter(r => !r.url.startsWith(ORIGIN) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  const posts = requests.filter(r => r.method !== 'GET');
  ok('O23 за всё время — ни одного запроса на чужие сайты и ни одной отправки (POST/PUT)', foreign.length === 0 && posts.length === 0,
    `чужих: ${foreign.length}${foreign.length ? ' ' + foreign.slice(0, 3).map(r => r.url).join(', ') : ''}; не-GET: ${posts.length}`);

  // ---------- 8. Без сети: открытие и разбор из кэша
  await ctx.setOffline(true);
  let offlineOk = true;
  try {
    await page.reload({ waitUntil: 'load', timeout: 20000 });
    await T('jobs-section').waitFor({ timeout: 20000 });
  } catch (e) { offlineOk = false; errors.push('offline reload: ' + String(e).slice(0, 120)); }
  ok('O24 без сети + перезагрузка → «Форман» открывается, объект в списке', offlineOk && (await page.getByText('OCR: проверка заказа').count()) > 0);
  if (offlineOk) {
    await page.locator('[data-testid^="job-open-"]').first().click();
    await T('job-screen').waitFor();
    await page.waitForTimeout(800);
    const t3 = Date.now();
    await T(sampleThumb).click();
    const got = await Promise.race([
      T('ocr-draft').waitFor({ timeout: 90000 }).then(() => 'draft'),
      T('ocr-msg').waitFor({ timeout: 90000 }).then(() => 'msg'),
    ]).catch(() => 'timeout');
    timings.offlineRunMs = Date.now() - t3;
    rows = got === 'draft' ? await readRows() : [];
    const msg = got === 'msg' ? await T('ocr-msg').innerText() : '';
    ok('O25 без сети (после первого разбора) разбор работает из кэша: «Bar type…» = 6', got === 'draft' && rows.some(r => (r.name || '').startsWith('Bar type') && r.qty === '6'), got === 'draft' ? `${timings.offlineRunMs} мс` : msg.slice(0, 100) || got);
    if (got === 'draft') await T('ocr-cancel').click();
  }
  await ctx.setOffline(false);

  // ---------- 9. Без кэша и без сети — честная ошибка, ручной ввод
  const ctx2 = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const q = await ctx2.newPage();
  q.on('pageerror', e => errors.push('ctx2: ' + String(e)));
  q.on('dialog', d => d.accept());
  const Q = id => q.getByTestId(id);
  await q.goto(BASE, { waitUntil: 'networkidle' });
  await Q('jobs-section').waitFor({ timeout: 20000 });
  await Q('new-title').fill('OCR без сети');
  await Q('new-create').click();
  await Q('job-screen').waitFor();
  const [fc2] = await Promise.all([q.waitForEvent('filechooser'), Q('pick-order').click()]);
  await fc2.setFiles(ORDER2);
  await q.getByText('Скрин заказа добавлен', { exact: false }).waitFor({ timeout: 15000 });
  await ctx2.setOffline(true);
  await q.locator('[data-testid^="ocr-start-"]').first().click();
  await Q('ocr-msg').waitFor({ timeout: 60000 });
  const failMsg = await Q('ocr-msg').innerText();
  ok('O26 первый разбор без сети: понятная ошибка (не пустой «успех»), подсказка про ручной ввод',
    failMsg.includes('Не удалось скачать модуль распознавания') && failMsg.includes('вручную') && (await Q('ocr-draft').count()) === 0, failMsg.slice(0, 140));
  await q.screenshot({ path: `${DIR}/ocr-05-offline-fail.png` });
  ok('O27 после ошибки ручной ввод на месте, сверка пуста', (await Q('item-new-name').isVisible()) && (await q.locator('[data-testid^="item-remove-"]').count()) === 0);
  await Q('item-new-name').fill('Ручная позиция');
  await Q('item-new-qty').fill('3');
  await Q('item-add').click();
  ok('O28 ручное добавление в сверку работает как раньше', (await q.getByText('Ручная позиция').count()) > 0);
  await ctx2.close();

  // ---------- 10. «Остановить», пока модуль скачивается (медленная сеть): сразу, без черновика, сверка та же
  const ctx3 = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx3.route('**/ocr/t7/eng.traineddata.gz', async route => { await new Promise(r => setTimeout(r, 8000)); await route.continue().catch(() => {}); });
  const z = await ctx3.newPage();
  z.on('pageerror', e => errors.push('ctx3: ' + String(e)));
  z.on('dialog', d => d.accept());
  const Z = id => z.getByTestId(id);
  await z.goto(BASE, { waitUntil: 'networkidle' });
  await Z('jobs-section').waitFor({ timeout: 20000 });
  await Z('new-title').fill('OCR стоп');
  await Z('new-create').click();
  await Z('job-screen').waitFor();
  await z.waitForTimeout(800);
  await Z('ocr-sample').click();
  await z.getByText('Загружаю модуль распознавания', { exact: false }).waitFor({ timeout: 20000 });
  await z.waitForTimeout(1500);
  const ts = Date.now();
  await Z('ocr-stop').click();
  await Z('ocr-msg').waitFor({ timeout: 5000 });
  const stopMsg = await Z('ocr-msg').innerText();
  const stopMs = Date.now() - ts;
  await z.waitForTimeout(8000); // запоздавшая модель не должна «оживить» черновик
  ok('O29 «Остановить» во время загрузки → сразу «остановлено», черновика нет, сверка пуста',
    stopMsg.includes('остановлено') && stopMs < 3000 && (await Z('ocr-draft').count()) === 0 && (await z.locator('[data-testid^="item-remove-"]').count()) === 0, `${stopMs} мс: ${stopMsg.slice(0, 60)}`);
  await ctx3.close();

  ok('O30 без ошибок JS на страницах', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(log.join('\n'));
  console.log('ВРЕМЯ:', JSON.stringify(timings));
  await browser.close();
})().catch(e => { console.log(log.join('\n')); console.error('CRASH', e); process.exit(2); });
