// E2E «Форман · Разбор скрина» на движке Safari (Playwright WebKit для Linux, профиль iPhone 13). Это не iOS Safari.
// Режим run: пример → черновик → подтвердить → «в траке 4» → «не хватает 2»; F1/F2/F3 на картинках QA; кэш forman-ocr-files.
// Режим off: сервер выключен (запускать после run с тем же профилем) → «Форман» открывается и разбор идёт из кэша.
// Запуск: PLAYWRIGHT_BROWSERS_PATH=<pwb> node e2e-ocr-wk.js <URL> <папка> <папка картинок QA> run|off
const { webkit, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const [BASE, DIR, IMG, MODE] = process.argv.slice(2);
const log = [];
const ok = (name, cond, extra = '') => { const s = `${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`; log.push(s); console.log(s); if (!cond) process.exitCode = 1; };
const info = (name, extra) => console.log(`INFO ${name} — ${extra}`);
const meta = JSON.parse(fs.readFileSync(path.join(IMG, 'meta.json'), 'utf8'));
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

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const ctx = await webkit.launchPersistentContext(path.join(DIR, 'profile'), { ...devices['iPhone 13'], locale: 'ru-RU', acceptDownloads: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  const T = id => page.getByTestId(id);
  const readRows = () => page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 80; k++) {
      if (!document.querySelector(`[data-testid="ocr-row-${k}"]`)) break;
      const val = id => (document.querySelector(`[data-testid="${id}-${k}"]`) || {}).value;
      const flag = document.querySelector(`[data-testid="ocr-flag-${k}"]`);
      out.push({ name: val('ocr-name'), qty: val('ocr-qty'), flag: flag ? flag.textContent : '' });
    }
    return out;
  });
  const runOcr = async (sid, timeout = 180000) => {
    const t0 = Date.now();
    await T(sid).click();
    const got = await Promise.race([
      T('ocr-draft').waitFor({ timeout }).then(() => 'draft'),
      page.waitForFunction(() => { const m = document.querySelector('[data-testid="ocr-msg"]'); const p = document.querySelector('[data-testid="ocr-progress"]'); return m && !p; }, null, { timeout }).then(() => 'msg'),
    ]).catch(() => 'timeout');
    return { got, ms: Date.now() - t0, rows: got === 'draft' ? await readRows() : [], msg: got === 'msg' ? await T('ocr-msg').innerText() : '' };
  };
  const cancel = async () => { if (await T('ocr-cancel').count()) { await T('ocr-cancel').click(); await page.waitForTimeout(500); } };
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

  if (MODE === 'run') {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await T('jobs-section').waitFor({ timeout: 30000 });
    info('W0 браузер', await page.evaluate(() => navigator.userAgent));
    ok('W0 service worker взял страницу', await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 40000 }).then(() => true).catch(() => false));

    await newJob('WK пример');
    const t0 = Date.now();
    await T('ocr-sample').click();
    await T('ocr-draft').waitFor({ timeout: 180000 });
    let rows = await readRows();
    const reg = rows.find(r => (r.name || '').startsWith('Bar type supply registers'));
    const pump = rows.find(r => r.name === 'Condensate pump');
    ok('W1 пример: «Bar type…» = 6, «Condensate pump» пусто + «проверь количество», 6 позиций', reg?.qty === '6' && pump?.qty === '' && pump.flag.includes('проверь количество') && rows.length === 6, `${Date.now() - t0} мс`);
    await T('ocr-confirm').click();
    await T('ocr-msg').waitFor();
    await page.waitForTimeout(1500);
    const work = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(x => /^fm\.job\..+\.work$/.test(x) && JSON.parse(localStorage.getItem(x)).items.length))));
    const item = work.items.find(i => i.name === 'Bar type supply registers 10x6');
    const card = page.locator(`xpath=//*[@data-testid="work-verdict-${item.id}"]/..`);
    await card.locator('input[aria-label="В траке"]').fill('4');
    await page.waitForTimeout(500);
    const short = await T('job-shortage').innerText();
    ok('W1б подтвердить → «В траке» 4 → «Недостача по заказу … не хватает 2 шт.» (позиция помечена ПРИМЕР)', short.includes('Bar type supply registers 10x6 [ПРИМЕР]: заказано 6, в траке 4 — не хватает 2 шт.'), short.replace(/\n/g, ' / ').slice(0, 140));

    await newJob('WK две строки');
    let r = await runOcr(await addOrder(path.join(IMG, 'twoline.png')));
    let g = grade(r.rows, [['Flex duct 8', 12], ['Disconnect 60', 1], ['Filter MERV 13', 2], ['Supply boot', 6], ['Copper elbow', 11]]);
    ok('W2 «… 8 / Qty 12» и т.п.: неверных без флага нет', g.wrong.length === 0 && g.missing.length === 0, `верно ${g.correct}, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}]`);
    await cancel();
    r = await runOcr(await addOrder(path.join(IMG, 'small39.png')));
    g = grade(r.rows, meta.small39.rows.map(x => [x[0], x[1]]));
    const motor = r.rows.find(x => x.name === 'Motor mount ring');
    ok('W3 «Qty 11» не превращается в 1 без флага (small39)', g.wrong.length === 0 && !!motor && (motor.qty === '11' || motor.qty === ''), `верно ${g.correct}/10, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}], Motor mount ring="${motor && motor.qty}"`);
    await cancel();
    r = await runOcr(await addOrder(path.join(IMG, 'long40.png')));
    g = grade(r.rows, JSON.parse(fs.readFileSync(path.join(IMG, 'long40.json'), 'utf8')));
    ok('W4 длинный скрин 40 позиций: ≥ 38 верно, неверных нет', g.correct >= 38 && g.wrong.length === 0, `верно ${g.correct}/40, флаг ${g.flagged}, неверно [${g.wrong.join('; ')}]; ${r.ms} мс`);
    await cancel();
    await page.waitForTimeout(1500);
    const cache = await page.evaluate(async () => {
      if (!(await caches.has('forman-ocr-files'))) return null;
      const c = await caches.open('forman-ocr-files');
      const out = {};
      for (const q of await c.keys()) out[q.url.split('/ocr/')[1]] = (await c.match(q)).headers.get('X-Forman-Hash');
      return out;
    });
    ok('W5 файлы распознавания в кэше forman-ocr-files с хэшами (поток распознавания идёт через service worker)',
      !!cache && ['t7/worker.min.js', 't7/eng.traineddata.gz', 't7/tesseract.min.js'].every(f => /^[0-9a-f]{12}$/.test(cache[f] || '')), JSON.stringify(cache));
  } else {
    let opened = true, err = '';
    try { await page.goto(BASE, { waitUntil: 'load', timeout: 30000 }); await T('jobs-section').waitFor({ timeout: 30000 }); } catch (e) { opened = false; err = String(e).slice(0, 120); }
    ok('W6 сервер выключен → «Форман» открывается из кэша', opened, err);
    if (opened) {
      await page.locator('[data-testid^="job-open-"]').last().click();
      await T('job-screen').waitFor();
      await page.waitForTimeout(800);
      const sid = await page.locator('[data-testid^="ocr-start-"]').first().getAttribute('data-testid');
      const r = await runOcr(sid, 90000);
      ok('W6б сервер выключен → разбор примера из кэша: «Bar type…» = 6', r.got === 'draft' && r.rows.some(x => (x.name || '').startsWith('Bar type') && x.qty === '6'), `${r.got} ${r.ms} мс ${(r.msg || '').slice(0, 100)}`);
    }
  }
  ok('W7 без ошибок JS', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
