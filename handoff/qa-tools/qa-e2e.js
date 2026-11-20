// Разрушающая проверка в приложении (iPhone 13, 390 px): вымышленные картинки qa_point/img(-sweep).
// Запуск: node qa-e2e.js <URL> <папка вывода> <img> <img-sweep>   (ENGINE=webkit — WebKit)
const pw = require('playwright');
const fs = require('fs'), path = require('path');
const ENGINE = process.env.ENGINE || 'chromium';
const ONLY = process.env.ONLY || 'Q1 Q2 Q3 Q4 Q5 Q6';
const on = q => ONLY.split(' ').includes(q);
const [BASE, DIR, IMG, SW] = process.argv.slice(2);
const truth = { ...JSON.parse(fs.readFileSync(path.join(IMG, 'truth.json'), 'utf8')), ...JSON.parse(fs.readFileSync(path.join(SW, 'truth.json'), 'utf8')) };
const log = []; const out = s => { log.push(s); console.log(s); };
const ok = (n, c, x = '') => { out(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const info = (n, x) => out(`INFO ${n} — ${x}`);
const opts = { ...pw.devices['iPhone 13'], acceptDownloads: true, locale: 'ru-RU', timezoneId: 'America/Los_Angeles' };
const errors = [], requests = [];
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function lev(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
const sim = (a, b) => { a = norm(a); b = norm(b); return a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0; };
function grade(rows, tr) {
  const g = { ok: 0, flag: 0, wrong: [], hiddenWrong: 0 };
  for (const r of rows) {
    if (r.qty === '' || r.flag) { g.flag++; continue; }
    let best = null, bs = 0;
    for (const [tn, tq] of tr) for (const c of [tn, tn.replace(/\s*\S*\d\S*$/, '')]) { const s = sim(r.name, c); if (s > bs) { bs = s; best = [tn, tq]; } }
    if (bs >= 0.6 && String(best[1]) === r.qty) g.ok++;
    else { g.wrong.push(`«${r.name}»=${r.qty}${bs >= 0.6 ? ` (правда ${best[1] ?? 'пусто'})` : ' (нет на скрине)'}${r.visible ? '' : ' [свёрнута]'}`); if (!r.visible) g.hiddenWrong++; }
  }
  return g;
}
(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = ENGINE === 'webkit' ? null : await pw[ENGINE].launch();
  const ctx = browser ? await browser.newContext(opts) : await pw.webkit.launchPersistentContext(path.join(DIR, 'profile'), opts);
  ctx.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => errors.push(String(e)));
  const T = id => page.getByTestId(id);
  const readRows = () => page.evaluate(() => {
    const o = [];
    for (let k = 0; k < 80; k++) {
      const row = document.querySelector(`[data-testid="ocr-row-${k}"]`); if (!row) break;
      const val = id => (document.querySelector(`[data-testid="${id}-${k}"]`) || {}).value;
      const txt = id => { const el = document.querySelector(`[data-testid="${id}-${k}"]`); return el ? el.textContent : ''; };
      o.push({ k, name: val('ocr-name'), qty: val('ocr-qty'), flag: txt('ocr-flag'), note: txt('ocr-note'), dup: txt('ocr-dupinfo'), visible: getComputedStyle(row).display !== 'none' && row.getBoundingClientRect().height > 0 });
    }
    return o;
  });
  const thumbIds = () => page.locator('[data-testid^="thumb-"]').evaluateAll(xs => xs.map(x => x.getAttribute('data-testid').slice(6)));
  const addFile = async (btn, file) => {
    const beforeIds = await thumbIds(); const before = beforeIds.length;
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), T(btn).click()]);
    await fc.setFiles(file);
    await page.waitForFunction(n => document.querySelectorAll('[data-testid^="thumb-"]').length > n, before, { timeout: 60000 });
    const ids = await thumbIds(); const prev = new Set(beforeIds);
    return ids.find(x => !prev.has(x)) || ids[ids.length - 1];
  };
  const newJob = async title => {
    if (await T('job-back').count()) { await T('job-back').first().click(); await page.waitForTimeout(400); }
    await T('jobs-section').waitFor({ timeout: 20000 });
    await T('new-title').fill(title); await T('new-create').click(); await T('job-screen').waitFor(); await page.waitForTimeout(800);
  };
  const runOcr = async id => {
    const t0 = Date.now();
    await T(`ocr-start-${id}`).click();
    const got = await Promise.race([
      T('ocr-draft').waitFor({ timeout: 180000 }).then(() => 'draft'),
      page.waitForFunction(() => { const m = document.querySelector('[data-testid="ocr-msg"]'); const p = document.querySelector('[data-testid="ocr-progress"]'); return m && !p; }, null, { timeout: 180000 }).then(() => 'msg'),
    ]).catch(() => 'timeout');
    return { got, ms: Date.now() - t0, rows: got === 'draft' ? await readRows() : [], stats: got === 'draft' ? await T('ocr-stats').innerText() : '' };
  };
  const cancelDraft = async () => { if (await T('ocr-cancel').count()) { await T('ocr-cancel').click(); await page.waitForTimeout(400); } };
  const work = () => page.evaluate(() => {
    const jobs = JSON.parse(localStorage.getItem('fm.jobs.v1') || '[]');
    const title = document.querySelector('[data-testid="job-title"]')?.value;
    const j = jobs.find(x => x.title === title);
    return j ? JSON.parse(localStorage.getItem(`fm.job.${j.id}.work`) || 'null') : null;
  });
  const text = async id => (await T(id).count()) ? (await T(id).innerText()).replace(/\n/g, ' ') : '';

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 30000 });
  info('движок', ENGINE);

  if (on('Q1')) {
  // ===== Q1. Фото экрана под углом (+4°, плотные строки): строки «съезжают» на соседнюю → количества чужих строк
  const photos = [['pA2_r+4', IMG], ['w80_r+4.5', SW], ['w95_r+4.5', SW], ['w70_r+3.5', SW]];
  await newJob('QA фото под углом');
  for (const [n, dir] of photos) {
    const id = await addFile('pick-order', path.join(dir, n + '.jpg'));
    const r = await runOcr(id);
    const g = grade(r.rows, truth[n]);
    const orphan = await T('ocr-orphans').count(), none = await text('ocr-top-none'), more = await text('ocr-more');
    info(`Q1 ${n}`, `${r.got} ${r.ms} мс; ${r.rows.map(x => `${x.visible ? '' : '(свёрн.) '}[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}`).join('; ')}`);
    ok(`Q1 ${n}: фото экрана — нет неверных количеств без флага`, g.wrong.length === 0,
      `неверно без флага ${g.wrong.length} (из них свёрнуто «без вопросов» ${g.hiddenWrong}): ${g.wrong.join('; ')} | предупреждение «под углом»: ${orphan ? 'есть' : 'НЕТ'} | ${none || ''} | ${more}`);
    if (n === 'pA2_r+4') { await T('ocr-draft').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${DIR}/q1-photo-r+4-draft.png`, fullPage: false }); }
    await cancelDraft();
  }
  // то же фото кнопкой «Фото объекта» → «⇄» → Разобрать (полная копия 1600 px)
  {
    const id = await addFile('pick-camera', path.join(IMG, 'pA2_r+4.jpg'));
    await T(`kind-${id}`).click(); await page.waitForTimeout(800);
    const r = await runOcr(id); const g = grade(r.rows, truth['pA2_r+4']);
    ok('Q1б фото «не той кнопкой» → ⇄ → Разобрать: нет неверных без флага', g.wrong.length === 0, `неверно ${g.wrong.length}: ${g.wrong.join('; ')}`);
    await cancelDraft();
  }

  }
  if (on('Q2')) {
  // ===== Q2. Чистые скрины с числом в названии
  await newJob('QA числа в названии');
  for (const n of ['sE', 'sB', 'sC', 'sD', 'sG', 'sF']) {
    const id = await addFile('pick-order', path.join(IMG, n + '.png'));
    const r = await runOcr(id); const g = grade(r.rows, truth[n]);
    info(`Q2 ${n}`, r.rows.map(x => `${x.visible ? '' : '(свёрн.) '}[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}`).join('; ') || (await text('ocr-empty')) || r.got);
    ok(`Q2 ${n}: нет неверных количеств без флага`, g.wrong.length === 0, `неверно ${g.wrong.length} (свёрнуто ${g.hiddenWrong}): ${g.wrong.join('; ')}`);
    if (n === 'sE') { await T('ocr-draft').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${DIR}/q2-sE-draft.png` }); }
    await cancelDraft();
  }

  }
  if (on('Q3')) {
  // ===== Q3. Перекрытие двух скринов: второй — без шапки таблицы (обрезан) → повторы не узнаны?
  await newJob('QA перекрытие без шапки');
  const idA = await addFile('pick-order', path.join(IMG, 'sA.png'));
  let r = await runOcr(idA);
  ok('Q3а скрин A: 8 строк, все количества верные', grade(r.rows, truth.sA).ok === 8, r.stats);
  await T('ocr-confirm').click(); await T('ocr-msg').waitFor(); await page.waitForTimeout(1200);
  let w = await work(); const nA = w.items.length;
  const idH = await addFile('pick-order', path.join(IMG, 'sH.png'));
  r = await runOcr(idH);
  const dupSeen = r.rows.filter(x => x.dup.includes('Уже есть в сверке')).length;
  info('Q3 второй скрин (без шапки)', r.rows.map(x => `[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}${x.dup ? ' {повтор}' : ''}`).join('; '));
  // бригадир делает, как просит черновик: вписывает количество по скрину в каждую строку «проверь количество»
  const qOf = nm => { const t = truth.sA.find(([tn]) => norm(nm).startsWith(norm(tn))); return t ? String(t[1]) : '1'; };
  for (const x of r.rows) if (x.flag && x.qty === '') await T(`ocr-qty-${x.k}`).fill(qOf(x.name));
  const plan = await text('ocr-plan');
  await T('ocr-confirm').click(); await T('ocr-msg').waitFor(); await page.waitForTimeout(1200);
  w = await work();
  const names = w.items.map(i => i.name);
  const twins = w.items.filter(i => w.items.some(j => j !== i && norm(j.name).startsWith(norm(i.name)) && j.name !== i.name));
  ok('Q3б второй скрин того же заказа без шапки «Qty»: строки, которые уже в сверке, узнаны как повтор (без задвоения)',
    dupSeen >= 5 && w.items.length === nA,
    `узнано повторов ${dupSeen} из ${r.rows.length}; ${plan}; позиций было ${nA}, стало ${w.items.length}; задвоены: ${twins.map(i => `«${i.name}»`).join(', ')} | ${names.join(' | ')}`);
  await page.screenshot({ path: `${DIR}/q3-after.png` });

  }
  if (on('Q4')) {
  // ===== Q4. 6 → 8 при 4 в траке, затем повторный разбор: поправить кол-во в строке-повторе, НЕ нажав «Заменить»
  await newJob('QA 6-8-4');
  const idA2 = await addFile('pick-order', path.join(IMG, 'sA.png'));
  r = await runOcr(idA2);
  if (await T('ocr-more').count()) await T('ocr-more').click();
  r.rows = await readRows();
  const ret = r.rows.find(x => x.name === 'Return grille 20x20');
  await T(`ocr-qty-${ret.k}`).fill('8');
  await T('ocr-confirm').click(); await T('ocr-msg').waitFor(); await page.waitForTimeout(1200);
  w = await work(); const it = w.items.find(i => i.name === 'Return grille 20x20');
  await page.locator(`xpath=//*[@data-testid="work-verdict-${it.id}"]/..`).locator('input[aria-label="В траке"]').fill('4');
  await page.waitForTimeout(600);
  ok('Q4а 6 → 8, в траке 4 → «Не хватает: 4 шт.»', (await text(`work-verdict-${it.id}`)).includes('Не хватает: 4 шт.'), await text(`work-verdict-${it.id}`));
  // повторный разбор: в строке-повторе поправить 6 → 10 (как будто заказ изменился), «Заменить» не нажимать
  r = await runOcr(idA2);
  const retd = r.rows.find(x => x.name === 'Return grille 20x20');
  info('Q4 повтор', `${retd.dup} | кнопка: ${await text(`ocr-duprepl-${retd.k}`)}`);
  await T(`ocr-qty-${retd.k}`).fill('10');
  const plan4 = await text('ocr-plan');
  await T('ocr-confirm').click(); await T('ocr-msg').waitFor(); await page.waitForTimeout(1000);
  const msg4 = await text('ocr-msg');
  w = await work(); const it4 = w.items.find(i => i.name === 'Return grille 20x20');
  info('Q4б правка количества в строке-повторе без «Заменить»', `план: «${plan4}»; после: «${msg4.slice(0, 140)}»; в сверке заказано ${it4.ordered}, позиций ${w.items.length}`);
  // исправлено (дефект 4): вписанное другое количество в строке-повторе само выбирает «Заменить» — правка не теряется
  ok('Q4б без задвоения, правка не потерялась: «Return grille» одна, заказано 10, план говорит «заменится»', w.items.filter(i => i.name === 'Return grille 20x20').length === 1 && it4.ordered === 10 && plan4.includes('заменится'), `заказано ${it4.ordered}`);
  // выбрать «Заменить количество» — недостача пересчитана
  r = await runOcr(idA2);
  const retd2 = r.rows.find(x => x.name === 'Return grille 20x20');
  await T(`ocr-qty-${retd2.k}`).fill('10');
  await T(`ocr-duprepl-${retd2.k}`).click();
  await T('ocr-confirm').click(); await T('ocr-msg').waitFor(); await page.waitForTimeout(1000);
  w = await work(); const it5 = w.items.find(i => i.name === 'Return grille 20x20');
  ok('Q4в «Заменить количество: 8 → 10» → заказано 10, в траке 4 → «Не хватает: 6 шт.»', it5.ordered === 10 && (await text(`work-verdict-${it5.id}`)).includes('Не хватает: 6 шт.'), await text(`work-verdict-${it5.id}`));

  }
  if (on('Q5')) {
  // ===== Q5. Переключение типа при открытом черновике
  await newJob('QA переключение');
  const idK = await addFile('pick-order', path.join(IMG, 'sA.png'));
  r = await runOcr(idK);
  await T(`kind-${idK}`).click(); await page.waitForTimeout(800);
  const draftStill = await T('ocr-draft').count();
  const startBtn = await T(`ocr-start-${idK}`).count();
  info('Q5 скрин перенесён в «Фото объекта», пока открыт его черновик', `черновик открыт: ${draftStill ? 'да' : 'нет'}; кнопка «Разобрать» у него: ${startBtn}; ${await text('photo-msg')}`);
  if (draftStill) { await T('ocr-confirm').click(); await page.waitForTimeout(1000); }
  w = await work();
  info('Q5б подтверждён черновик скрина, который уже «фото объекта»', `в сверке ${w ? w.items.length : 0} позиций (источник — скрин заказа)`);

  }
  if (on('Q6')) {
  // ===== Q6. 390 px: горизонтальная прокрутка, высота кнопок, размер текста
  await newJob('QA 390');
  const idU = await addFile('pick-order', path.join(IMG, 'sB.png'));
  await addFile('pick-camera', path.join(IMG, 'pA_r+3.jpg'));
  r = await runOcr(idU);
  const lay = await page.evaluate(() => {
    const vw = window.innerWidth, sw = document.documentElement.scrollWidth;
    const small = [], low = [], fonts = new Set();
    for (const el of document.querySelectorAll('[role="button"], button')) {
      const b = el.getBoundingClientRect(); if (!b.width || getComputedStyle(el).display === 'none') continue;
      const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (b.height < 48) small.push(`${t} ${Math.round(b.height)}px`);
      if (b.right > vw + 1) low.push(`${t} выходит за край`);
      const fs_ = parseFloat(getComputedStyle(el.querySelector('div,span') || el).fontSize); if (fs_ < 16) fonts.add(`${t}: ${fs_}px`);
    }
    const tiny = [...document.querySelectorAll('[data-testid="ocr-draft"] div, [data-testid="job-screen"] div')].filter(e => e.childElementCount === 0 && e.innerText && e.innerText.trim() && parseFloat(getComputedStyle(e).fontSize) < 15).map(e => `${e.innerText.trim().slice(0, 30)}(${getComputedStyle(e).fontSize})`);
    return { vw, sw, small, low, fonts: [...fonts], tiny: [...new Set(tiny)].slice(0, 12) };
  });
  ok('Q6 390 px: нет горизонтальной прокрутки', lay.sw <= lay.vw, `${lay.sw} / ${lay.vw}`);
  ok('Q6б все видимые кнопки ≥ 48 px', lay.small.length === 0, lay.small.join('; '));
  info('Q6в кнопки с текстом мельче 16 px', lay.fonts.join('; ') || 'нет');
  info('Q6г мелкий текст (<15 px) на экране объекта/черновике', lay.tiny.join('; ') || 'нет');
  await T('ocr-draft').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${DIR}/q6-390-draft.png`, fullPage: true });
  }
  const ext = requests.filter(x => !x.url.startsWith(new URL(BASE).origin) && !x.url.startsWith('blob:') && !x.url.startsWith('data:'));
  ok('Q7 нет запросов на чужие сайты и POST/PUT', ext.length === 0 && !requests.some(x => /POST|PUT/.test(x.method)), ext.slice(0, 3).map(x => x.url).join(' '));
  ok('Q8 нет ошибок JS', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.writeFileSync(path.join(DIR, 'report.txt'), log.join('\n'));
  await ctx.close(); if (browser) await browser.close();
})().catch(e => { console.log('CRASH', e); process.exitCode = 2; });
