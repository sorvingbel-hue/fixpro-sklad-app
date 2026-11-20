// E2E «Форман · точечная правка разбора скрина (dot)», профиль iPhone 13. Движок: ENGINE=chromium (по умолчанию) или webkit.
// P1 путь: две разные кнопки «Фото объекта — просто вложение» / «Скрин заказа — можно разобрать», тип переключается у миниатюры;
// P2 черновик: исходный скрин сверху (миниатюра → крупно), спорные строки первыми и раскрыты, уверенные — «ещё N строк»;
//    правило dot на НАСТОЯЩЕМ распознавании: «Filter MERV 13» = 2 из колонки Qty, «Filter MERV 11» без количества → флаг, не 11;
// P3 исправленное количество: 6 → 8, в траке 4 → «не хватает 4» в сверке, в «6. Итог» и в отчёте .txt;
// P4 повторный разбор того же скрина: «уже есть в сверке», по умолчанию «оставить» — без задвоения;
// P5 второй скрин того же заказа с перекрытием: оставить / заменить количество / добавить отдельно;
// P6 «фото экрана» (перспектива, поворот, размытие, муар, блик, JPEG): что распозналось, флаги, 0 неверных без флага;
// P7 скрин заказа, восстановленный из копии файлом (только 1600 px): длинный скрин до и после восстановления.
// Все картинки вымышленные (gen-point.py, qa_ocr). Запуск: node e2e-ocr-point.js <URL> <папка> <папка ocr_point/img> <папка qa_ocr/img>
const pw = require('playwright');
const fs = require('fs');
const path = require('path');

const ENGINE = process.env.ENGINE || 'chromium';
const [BASE, DIR, PT, QA] = process.argv.slice(2);
const ORIGIN = new URL(BASE).origin;
const truth = JSON.parse(fs.readFileSync(path.join(PT, 'truth.json'), 'utf8'));
const PHOTO = path.join(__dirname, 'test-photo.jpg');
const log = [];
const out = (s) => { log.push(s); console.log(s); };
const ok = (name, cond, extra = '') => { out(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const info = (name, extra) => out(`INFO ${name} — ${extra}`);
const opts = { ...pw.devices['iPhone 13'], acceptDownloads: true, locale: 'ru-RU', timezoneId: 'America/Los_Angeles' };
const errors = [];
const requests = [];
const numbers = {};

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// rows — строки черновика; tr — [название, кол-во | null]. null — на скрине количества нет: верно только «пусто + флаг».
function grade(rows, tr) {
  const res = { correct: 0, flagged: 0, wrong: [], missing: [], extra: 0 };
  const used = new Set();
  for (const [name, qty] of tr) {
    const k = rows.findIndex((x, i) => !used.has(i) && norm(x.name) === norm(name));
    if (k < 0) { res.missing.push(name); continue; }
    used.add(k);
    const r = rows[k];
    if (qty !== null && r.qty === String(qty)) res.correct++;
    else if (r.qty === '' && r.flag.includes('проверь количество')) { res.flagged++; if (qty === null) res.correct++; }
    else res.wrong.push(`${name}: ${r.qty || '∅'} (правда ${qty ?? 'нет'})`);
  }
  // строки, которых нет в правде: «Filter MERV» = 13 и т.п. — с числом без флага считаются неверными
  rows.forEach((r, i) => { if (!used.has(i)) { res.extra++; if (r.qty !== '' && !r.flag) res.wrong.push(`лишняя «${r.name}» = ${r.qty} без флага`); } });
  return res;
}
const gtxt = g => `верно ${g.correct}, с флагом ${g.flagged}, неверно без флага ${g.wrong.length}${g.wrong.length ? ' [' + g.wrong.join('; ') + ']' : ''}, не найдено ${g.missing.length}${g.missing.length ? ' [' + g.missing.join('; ') + ']' : ''}, лишних ${g.extra}`;

function helpers(page) {
  page.on('pageerror', e => errors.push(String(e)));
  const T = id => page.getByTestId(id);
  const readRows = () => page.evaluate(() => {
    const out = [];
    for (let k = 0; k < 80; k++) {
      const row = document.querySelector(`[data-testid="ocr-row-${k}"]`);
      if (!row) break;
      const val = id => (document.querySelector(`[data-testid="${id}-${k}"]`) || {}).value;
      const txt = id => { const el = document.querySelector(`[data-testid="${id}-${k}"]`); return el ? el.textContent : ''; };
      out.push({
        k, name: val('ocr-name'), qty: val('ocr-qty'), unit: val('ocr-unit'), flag: txt('ocr-flag'), note: txt('ocr-note'),
        dup: txt('ocr-dupinfo'), keep: txt('ocr-dupkeep'), visible: getComputedStyle(row).display !== 'none' && row.getBoundingClientRect().height > 0,
      });
    }
    return out;
  });
  const newJob = async title => {
    if (await T('job-back').count()) { await T('job-back').first().click(); await page.waitForTimeout(400); }
    await T('jobs-section').waitFor({ timeout: 20000 });
    await T('new-title').fill(title);
    await T('new-create').click();
    await T('job-screen').waitFor();
    await page.waitForTimeout(800);
  };
  const thumbIds = () => page.locator('[data-testid^="thumb-"]').evaluateAll(xs => xs.map(x => x.getAttribute('data-testid').slice(6)));
  const addFile = async (btn, file) => {
    const before = (await thumbIds()).length;
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), T(btn).click()]);
    await fc.setFiles(file);
    await page.waitForFunction(n => document.querySelectorAll('[data-testid^="thumb-"]').length > n, before, { timeout: 60000 });
    const ids = await thumbIds();
    const prev = new Set(ids.slice(0, before));
    return ids.find(x => !prev.has(x)) || ids[ids.length - 1];
  };
  const runOcr = async (id, timeout = 180000) => {
    const t0 = Date.now();
    await T(`ocr-start-${id}`).click();
    const got = await Promise.race([
      T('ocr-draft').waitFor({ timeout }).then(() => 'draft'),
      page.waitForFunction(() => { const m = document.querySelector('[data-testid="ocr-msg"]'); const p = document.querySelector('[data-testid="ocr-progress"]'); return m && !p; }, null, { timeout }).then(() => 'msg'),
    ]).catch(() => 'timeout');
    const ms = Date.now() - t0;
    if (got === 'draft') return { got, ms, rows: await readRows(), stats: await T('ocr-stats').innerText() };
    return { got, ms, rows: [], msg: got === 'msg' ? await T('ocr-msg').innerText() : '' };
  };
  const cancelDraft = async () => { if (await T('ocr-cancel').count()) { await T('ocr-cancel').click(); await page.waitForTimeout(500); } };
  const work = () => page.evaluate(async () => {
    const jobs = JSON.parse(localStorage.getItem('fm.jobs.v1') || '[]');
    const title = document.querySelector('[data-testid="job-title"]')?.value;
    const j = jobs.find(x => x.title === title);
    return j ? JSON.parse(localStorage.getItem(`fm.job.${j.id}.work`) || 'null') : null;
  });
  const openMore = async () => { if (await T('ocr-more').count() && !(await T('ocr-more').getAttribute('aria-expanded').then(v => v === 'true').catch(() => false))) await T('ocr-more').click(); };
  return { T, readRows, newJob, thumbIds, addFile, runOcr, cancelDraft, work, openMore };
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  // WebKit: в одноразовом профиле картинки не пишутся в IndexedDB (как приватный режим Safari) — профиль на диске
  const browser = ENGINE === 'webkit' ? null : await pw[ENGINE].launch();
  const newCtx = async name => (browser ? browser.newContext(opts) : pw.webkit.launchPersistentContext(path.join(DIR, `profile-${name}`), opts));
  const ctx = await newCtx('phone1');
  info('движок', `${ENGINE} ${browser ? browser.version() : ctx.browser()?.version() ?? 'webkit (persistent)'}`);
  ctx.on('request', r => requests.push({ url: r.url(), method: r.method(), body: (r.postData() || '').length }));
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  const { T, readRows, newJob, addFile, runOcr, cancelDraft, work, openMore } = helpers(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 40000 }).catch(() => {});

  // ================= P1. Путь: две разные кнопки, тип у миниатюры
  await newJob('P заказ PT-0412');
  const tPhoto = await T('pick-camera').innerText(), tOrder = await T('pick-order').innerText();
  const hPhoto = (await T('pick-camera').boundingBox()).height, hOrder = (await T('pick-order').boundingBox()).height;
  ok('P1 в «2. Фото и скрин заказа» две разные кнопки: «📷 Фото объекта — просто вложение» и «🧾 Скрин заказа — можно разобрать», обе ≥ 48 px',
    tPhoto.includes('Фото объекта — просто вложение') && tOrder.includes('Скрин заказа — можно разобрать') && hPhoto >= 48 && hOrder >= 48 && (await T('pick-gallery').count()) === 0,
    `«${tPhoto.trim()}» ${Math.round(hPhoto)} px; «${tOrder.trim()}» ${Math.round(hOrder)} px`);
  // скрин заказа по ошибке добавлен как «Фото объекта» → «Разобрать» для него нет → «⇄ Это скрин заказа»
  const idA = await addFile('pick-camera', path.join(PT, 'pt-a.png'));
  const startA0 = await T(`ocr-start-${idA}`).count();
  const kindBtn = T(`kind-${idA}`);
  const kb = await kindBtn.boundingBox();
  const kindTxt = await kindBtn.innerText();
  await kindBtn.click();
  await T('photo-msg').filter({ hasText: 'Перенесено в «Скрин заказа»' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const startA1 = await T(`ocr-start-${idA}`).count();
  const sumKind = await T('job-summary').innerText();
  ok('P1б скрин заказа, добавленный кнопкой «Фото объекта», разобрать нельзя; «⇄ Это скрин заказа» у миниатюры (≥ 48 px) переносит его — появляется «Разобрать»',
    startA0 === 0 && kindTxt.includes('Это скрин заказа') && kb.height >= 48 && startA1 === 1 && sumKind.includes('Фото: 0 · скрин заказа: 1'),
    `до: «Разобрать» ${startA0}, после: ${startA1}; кнопка «${kindTxt.replace(/\n/g, ' ')}» ${Math.round(kb.height)} px; итог: ${sumKind.slice(0, 40)}`);
  // наоборот: фото объекта добавлено как скрин заказа → открыть миниатюру → «⇄ Это фото объекта — перенести»
  const idP = await addFile('pick-order', PHOTO);
  const startP0 = await T(`ocr-start-${idP}`).count();
  await T(`thumb-${idP}`).click();
  await T('photo-viewer').waitFor();
  const vk = await T('viewer-kind').innerText();
  await T('viewer-kind').click();
  await T('photo-msg').filter({ hasText: 'Перенесено в «Фото объекта»' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const sum2 = await T('job-summary').innerText();
  ok('P1в фото объекта, добавленное как скрин заказа: в крупном просмотре «⇄ Это фото объекта — перенести» → «Разобрать» для него исчезает',
    startP0 === 1 && vk.includes('Это фото объекта') && (await T(`ocr-start-${idP}`).count()) === 0 && sum2.includes('Фото: 1 · скрин заказа: 1'), `«${vk}»; ${sum2.slice(0, 40)}`);
  await page.screenshot({ path: `${DIR}/p1-section2.png` });

  // ================= P2. Черновик: скрин сверху, спорные первыми, уверенные свёрнуты; правило dot на настоящем распознавании
  let r = await runOcr(idA);
  numbers.ptA = { ms: r.ms, stats: r.stats };
  info('P2 черновик pt-a', r.rows.map(x => `${x.visible ? '' : '(свёрнута) '}[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}`).join('; '));
  let g = grade(r.rows, truth['pt-a']);
  numbers.ptAgrade = gtxt(g);
  ok('P2 правило dot на скрине A (колонка «Qty» без слова «Qty»): «Filter MERV 13» = 2, «Breaker 2 pole 30» = 1 — число из названия не взято; неверных без флага 0',
    r.rows.some(x => x.name === 'Filter MERV 13' && x.qty === '2') && r.rows.some(x => x.name === 'Breaker 2 pole 30' && x.qty === '1') &&
    !r.rows.some(x => /^Filter MERV$|^Breaker 2 pole$/.test(x.name)) && g.wrong.length === 0, gtxt(g));
  const firstCalm = r.rows.findIndex(x => !x.flag);
  const lastFlag = r.rows.map(x => !!x.flag).lastIndexOf(true);
  const flaggedVisible = r.rows.filter(x => x.flag).every(x => x.visible);
  const calm = r.rows.filter(x => !x.flag);
  const moreTxt = calm.length ? await T('ocr-more').innerText() : '';
  ok('P2б спорные строки (с флагом) — первыми и раскрыты; уверенные — свёрнуты списком «Ещё N строк без вопросов»',
    flaggedVisible && (lastFlag < 0 || firstCalm < 0 || lastFlag < firstCalm) && calm.every(x => !x.visible) && (!calm.length || new RegExp(`Ещё ${calm.length} строк\\S* без вопросов`).test(moreTxt)),
    `с флагом ${r.rows.length - calm.length}, свёрнуто ${calm.length}; «${moreTxt.trim()}»`);
  const lines = await page.locator('[data-testid^="ocr-line-"]').count();
  ok('P2в в свёрнутом виде уверенные строки видны коротко («• название — кол-во»)', lines === calm.length, `${lines} строк`);
  const srcOk = await page.evaluate(() => { const i = document.querySelector('[data-testid="ocr-source"] img'); return !!i && i.complete && i.naturalWidth > 0; });
  const srcBox = await T('ocr-source').boundingBox();
  await T('ocr-draft').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/p2-draft.png` });
  await T('ocr-source').click();
  await T('ocr-zoom').waitFor();
  await page.waitForTimeout(500);
  const zb = await page.locator('[data-testid="ocr-zoom"] img').first().boundingBox().catch(() => null) || await T('ocr-zoom').boundingBox();
  const vw = page.viewportSize().width;
  await T('ocr-zoom').screenshot({ path: `${DIR}/p2-zoom.png` }).catch(() => {});
  ok('P2г исходный скрин над черновиком: миниатюра (нажать) → крупно во всю ширину; «Свернуть скрин»',
    srcOk && srcBox.height >= 48 && !!zb && zb.width >= vw * 0.7 && zb.height > zb.width * 1.5, `миниатюра ${Math.round(srcBox.width)}×${Math.round(srcBox.height)}; крупно ${zb && Math.round(zb.width)}×${zb && Math.round(zb.height)} при ширине экрана ${vw}`);
  await T('ocr-zoom-close').click();
  // раскрыть уверенные и поправить: «Return grille 20x20» 6 → 8
  await openMore();
  await page.waitForTimeout(300);
  r.rows = await readRows();
  const ret = r.rows.find(x => x.name === 'Return grille 20x20');
  ok('P2д «Ещё N строк» раскрываются — их можно править', calm.length === 0 || r.rows.filter(x => !x.flag).every(x => x.visible), '');

  // ================= P3. Исправленное количество 6 → 8, в траке 4
  ok('P3а в черновике «Return grille 20x20» = 6 (со скрина)', !!ret && ret.qty === '6', ret ? `${ret.name}=${ret.qty}` : 'нет строки');
  if (ret) await T(`ocr-qty-${ret.k}`).fill('8');
  const planTxt = await T('ocr-plan').innerText();
  await T('ocr-confirm').click();
  await T('ocr-msg').waitFor();
  const m3 = await T('ocr-msg').innerText();
  await page.waitForTimeout(1500);
  let w = await work();
  const retItem = w && w.items.find(i => i.name === 'Return grille 20x20');
  ok('P3б «Подтвердить» → в сверке «Return grille 20x20»: заказано 8 = нужно 8 (исправленное), в траке пусто',
    !!retItem && retItem.ordered === 8 && retItem.required === 8 && retItem.actual === '' && m3.startsWith('Добавлено в сверку:'), `${planTxt} | ${m3.slice(0, 90)}`);
  const nA = w.items.length;
  const card = page.locator(`xpath=//*[@data-testid="work-verdict-${retItem.id}"]/..`);
  await card.locator('input[aria-label="В траке"]').fill('4');
  await page.waitForTimeout(500);
  const verdictTxt = await T(`work-verdict-${retItem.id}`).innerText();
  const short = await T('job-shortage').innerText();
  ok('P3в в траке 4 → сверка «Не хватает: 4 шт.»', verdictTxt.includes('Не хватает: 4 шт.'), verdictTxt);
  ok('P3г «6. Итог» → «Return grille 20x20: заказано 8, в траке 4 — не хватает 4 шт.»', short.includes('Return grille 20x20: заказано 8, в траке 4 — не хватает 4 шт.'), short.replace(/\n/g, ' / ').slice(0, 160));
  await T('job-shortage').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/p3-itog.png` });
  await page.waitForTimeout(1000);
  const [dl] = await Promise.all([page.waitForEvent('download'), T('job-report').click()]);
  const rp = `${DIR}/report-point.txt`;
  await dl.saveAs(rp);
  let txt = fs.readFileSync(rp, 'utf8');
  ok('P3д отчёт .txt: «НЕДОСТАЧА ПО ЗАКАЗУ» и «Return grille 20x20: заказано 8, в траке 4 — не хватает 4 шт.»; строка сверки «требуется 8 … в траке 4»',
    txt.includes('НЕДОСТАЧА ПО ЗАКАЗУ:') && txt.includes('• Return grille 20x20: заказано 8, в траке 4 — не хватает 4 шт.') && txt.includes('Return grille 20x20: требуется 8, заказано 8, в траке 4; Не хватает: 4 шт.'));

  // ================= P4. Повторный разбор того же скрина: без задвоения
  r = await runOcr(idA);
  const dupRows = r.rows.filter(x => x.dup.startsWith('Уже есть в сверке'));
  const retDup = r.rows.find(x => x.name === 'Return grille 20x20');
  info('P4 черновик (повтор)', r.rows.map(x => `[${x.name}]=${x.qty || '∅'}${x.dup ? ' (уже в сверке)' : ''}`).join('; '));
  ok('P4 повторный разбор: строки, которые уже в сверке, — первыми, раскрыты, «Уже есть в сверке: … заказано 8, в траке 4. Что сделать?», по умолчанию «● Оставить как есть»',
    dupRows.length >= 5 && dupRows.every(x => x.visible && x.keep.startsWith('●')) && !!retDup && retDup.dup.includes('«Return grille 20x20» — заказано 8, в траке 4') && r.stats.includes(`уже в сверке: ${dupRows.length}`),
    `${dupRows.length} из ${r.rows.length}; ${retDup ? retDup.dup : ''}; ${r.stats}`);
  if (retDup) {
    const rb = await T(`ocr-duprepl-${retDup.k}`).innerText();
    ok('P4б у повтора три выбора: оставить / «Заменить количество: 8 → 6» / добавить отдельно; кнопки ≥ 48 px',
      rb.includes('Заменить количество: 8 → 6') && (await T(`ocr-dupadd-${retDup.k}`).innerText()).includes('Добавить отдельной позицией') &&
      (await T(`ocr-dupkeep-${retDup.k}`).boundingBox()).height >= 48 && (await T(`ocr-duprepl-${retDup.k}`).boundingBox()).height >= 48, rb);
    await T(`ocr-row-${retDup.k}`).screenshot({ path: `${DIR}/p4-dup-row.png` }).catch(() => {});
  }
  await T('ocr-confirm').click();
  await T('ocr-msg').waitFor();
  const m4 = await T('ocr-msg').innerText();
  await page.waitForTimeout(1500);
  w = await work();
  const cnt = n => w.items.filter(i => i.name === n).length;
  const ret4 = w.items.find(i => i.name === 'Return grille 20x20');
  ok('P4в «Подтвердить» по умолчанию — сверка не изменилась: позиций столько же, «Return grille» одна, 8, в траке 4, недостача 4',
    w.items.length === nA && cnt('Return grille 20x20') === 1 && ret4.required === 8 && ret4.actual === '4' && (await T('job-shortage').innerText()).includes('не хватает 4 шт.'),
    `позиций ${nA} → ${w.items.length}; ${m4.slice(0, 120)}`);

  // ================= P5. Второй скрин того же заказа с перекрытием (строки 4–6 повторяются)
  const idB = await addFile('pick-order', path.join(PT, 'pt-b.png'));
  r = await runOcr(idB);
  info('P5 черновик pt-b', r.rows.map(x => `[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}${x.dup ? ' (уже в сверке)' : ''}`).join('; '));
  g = grade(r.rows, truth['pt-b']);
  numbers.ptBgrade = gtxt(g);
  const merv11 = r.rows.find(x => x.name === 'Filter MERV 11');
  ok('P5а скрин B: «Filter MERV 11» с пустой колонкой «Qty» → название целиком, пусто, «проверь количество», причина «число в конце может быть частью названия»; неверных без флага 0',
    !!merv11 && merv11.qty === '' && merv11.flag.includes('проверь количество') && merv11.note.includes('число в конце может быть частью названия — проверь') && g.wrong.length === 0, gtxt(g));
  const overlap = ['Supply boot 6x10', 'Flex duct 8 in', 'Condensate pump'];
  const ov = overlap.map(n => r.rows.find(x => x.name === n));
  ok('P5б перекрытие: строки 4–6 («Supply boot 6x10», «Flex duct 8 in», «Condensate pump») помечены «Уже есть в сверке», по умолчанию «оставить»',
    ov.every(x => x && x.dup.startsWith('Уже есть в сверке') && x.keep.startsWith('●') && x.visible), ov.map(x => x ? `${x.name}: ${x.dup.slice(0, 40)}` : 'нет').join(' | '));
  const topB = r.rows.filter(x => x.flag || x.dup), restB = r.rows.filter(x => !x.flag && !x.dup);
  const moreB = await T('ocr-more').innerText().catch(() => '');
  ok('P5б2 скрин B: спорные (флаг «Filter MERV 11» и 3 повтора) — первыми и раскрыты; новые уверенные — свёрнуты «Ещё N строк без вопросов»',
    topB.every(x => x.visible) && restB.length > 0 && restB.every(x => !x.visible) && Math.max(...topB.map(x => x.k)) < Math.min(...restB.map(x => x.k)) &&
    new RegExp(`Ещё ${restB.length} строк\\S* без вопросов`).test(moreB), `раскрыто ${topB.length}, свёрнуто ${restB.length}; «${moreB.trim()}»`);
  await T('ocr-draft').screenshot({ path: `${DIR}/p5-draft-b.png` }).catch(() => {});
  await openMore();
  // выборы: Condensate pump — 1 → 2 и «заменить»; Supply boot — «добавить отдельно»; Flex duct — оставить (по умолчанию)
  const pump = ov[2], boot = ov[0];
  if (pump) { await T(`ocr-qty-${pump.k}`).fill('2'); await T(`ocr-duprepl-${pump.k}`).click(); }
  if (boot) await T(`ocr-dupadd-${boot.k}`).click();
  await page.waitForTimeout(200);
  const plan5 = await T('ocr-plan').innerText();
  const pumpRepl = pump ? await T(`ocr-duprepl-${pump.k}`).innerText() : '';
  await T('ocr-confirm').click();
  await T('ocr-msg').waitFor();
  const m5 = await T('ocr-msg').innerText();
  await page.waitForTimeout(1500);
  w = await work();
  const newNames = ['Wire nuts', 'Thermostat wire', 'Filter MERV 11', 'Disconnect 60A'];
  const pumpItem = w.items.find(i => i.name === 'Condensate pump');
  ok('P5в «оставить» — «Flex duct 8 in» одна; «заменить количество: 1 → 2» — «Condensate pump» одна, заказано 2; «добавить отдельно» — «Supply boot 6x10» дважды (по явному выбору)',
    cnt('Flex duct 8 in') === 1 && cnt('Condensate pump') === 1 && pumpItem.required === 2 && pumpItem.ordered === 2 && cnt('Supply boot 6x10') === 2,
    `${pumpRepl} | ${plan5} | ${m5.slice(0, 160)}`);
  ok('P5г новые строки B добавлены по одной, «Return grille» не тронута, недостача 4 на месте; «Filter MERV 11» без количества',
    newNames.every(n => cnt(n) === 1) && cnt('Return grille 20x20') === 1 && w.items.find(i => i.name === 'Filter MERV 11').required === null &&
    (await T('job-shortage').innerText()).includes('Return grille 20x20: заказано 8, в траке 4 — не хватает 4 шт.') && w.items.length === nA + newNames.length + 1,
    `позиций ${w.items.length} (ожидалось ${nA + newNames.length + 1})`);
  // ещё раз B целиком: всё уже есть → «Сверка не изменилась»
  r = await runOcr(idB);
  await T('ocr-confirm').click();
  await T('ocr-msg').waitFor();
  const m5e = await T('ocr-msg').innerText();
  await page.waitForTimeout(1200);
  const w5e = await work();
  ok('P5д скрин B ещё раз → по умолчанию ничего не задвоено', w5e.items.length === w.items.length, `${m5e.slice(0, 110)}`);

  // ================= P6. «Фото экрана»: перспектива, поворот, размытие, муар, блик, JPEG
  await newJob('P фото экрана');
  numbers.photos = {};
  let photoWrong = 0;
  for (const name of Object.keys(truth.photos)) {
    const meta = truth.photos[name];
    const id = await addFile('pick-order', path.join(PT, name));
    const rr = await runOcr(id);
    const gg = grade(rr.rows, truth[meta.from]);
    photoWrong += gg.wrong.length;
    const orphans = await T('ocr-orphans').innerText().catch(() => '');
    numbers.photos[name] = { ...meta, ms: rr.ms, got: rr.got, rows: rr.rows.map(x => `${x.name}=${x.qty || '∅'}${x.flag ? '⚠' : ''}`), grade: gtxt(gg), orphansNotice: !!orphans, stats: rr.stats };
    info(`P6 ${name} (${meta.from}; поворот ${meta.rot}°, перекос ${meta.skew}, размытие ${meta.blur}, муар ${meta.moire}, блик ${meta.glare}, JPEG ${meta.jpeg})`,
      `${rr.got}, ${rr.ms} мс: ${rr.rows.map(x => `[${x.name}]=${x.qty || '∅'}${x.flag ? '⚠' : ''}`).join('; ') || 'позиций нет'} | ${gtxt(gg)}${orphans ? ' | предупреждение: числа отдельно от названий' : ''}`);
    if (name === 'photo-a-mid.jpg' && rr.got === 'draft') { await T('ocr-draft').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${DIR}/p6-photo-mid.png` }); }
    await cancelDraft();
    if (rr.got !== 'draft') await page.waitForTimeout(300);
  }
  ok('P6 «фото экрана» (4 варианта): ни одного неверного количества без флага', photoWrong === 0, `неверных без флага: ${photoWrong}`);

  // ================= P7. Скрин заказа, восстановленный из копии файлом (только версия 1600 px)
  {
    const truth40 = JSON.parse(fs.readFileSync(path.join(QA, 'long40.json'), 'utf8'));
    await newJob('P копия: длинный скрин');
    const id40 = await addFile('pick-order', path.join(QA, 'long40.png'));
    const dims = async (pg, id) => pg.evaluate(async id => {
      const db = await new Promise((res, rej) => { const q = indexedDB.open('forman-photos'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const get = key => new Promise(res => { const t = db.transaction('blobs').objectStore('blobs').get(key); t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
      const d = async b => { if (!b) return null; const bm = await createImageBitmap(b); return [bm.width, bm.height, b.size]; };
      return { ocr: await d(await get(`${id}:ocr`)), full: await d(await get(`${id}:full`)) };
    }, id);
    const d1 = await dims(page, id40);
    const r1 = await runOcr(id40);
    const g1 = grade(r1.rows, truth40);
    await cancelDraft();
    await T('job-back').first().click();
    await T('jobs-section').waitFor();
    const [bdl] = await Promise.all([page.waitForEvent('download'), T('backup-save').click()]);
    const bpath = `${DIR}/backup-point.forman.json`;
    await bdl.saveAs(bpath);
    const ctx2 = await newCtx('phone2');
    ctx2.on('request', q => requests.push({ url: q.url(), method: q.method(), body: (q.postData() || '').length }));
    const q = await ctx2.newPage();
    q.on('dialog', d => d.accept());
    const H2 = helpers(q);
    await q.goto(BASE, { waitUntil: 'networkidle' });
    await H2.T('jobs-section').waitFor({ timeout: 30000 });
    const [ch] = await Promise.all([q.waitForEvent('filechooser'), H2.T('backup-load').click()]);
    await ch.setFiles(bpath);
    await q.waitForFunction(() => /Загружено/.test((document.querySelector('[data-testid="backup-msg"]') || {}).textContent || ''), null, { timeout: 60000 });
    const jobId = await q.evaluate(() => (JSON.parse(localStorage.getItem('fm.jobs.v1') || '[]').find(j => j.title === 'P копия: длинный скрин') || {}).id);
    await H2.T(`job-open-${jobId}`).click();
    await H2.T('job-screen').waitFor();
    await q.waitForTimeout(1000);
    const d2 = await dims(q, id40);
    const r2 = await H2.runOcr(id40);
    const g2 = grade(r2.rows, truth40);
    numbers.restore = { before: { dims: d1, ms: r1.ms, grade: gtxt(g1) }, after: { dims: d2, ms: r2.ms, grade: gtxt(g2) } };
    info('P7 длинный скрин 1170×4960, 40 позиций — ДО копии', `копия для распознавания ${JSON.stringify(d1.ocr)}, полная ${JSON.stringify(d1.full)}; ${r1.ms} мс; ${gtxt(g1)}`);
    info('P7 тот же скрин ПОСЛЕ восстановления из копии файлом', `копии для распознавания ${JSON.stringify(d2.ocr)}, полная ${JSON.stringify(d2.full)}; ${r2.ms} мс; ${gtxt(g2)}`);
    ok('P7 после восстановления из копии файлом скрин только 1600 px (без копии для распознавания), разбор: неверных без флага 0, верно ≥ 38 из 40',
      !!d1.ocr && d2.ocr === null && d2.full && Math.max(d2.full[0], d2.full[1]) === 1600 && g2.wrong.length === 0 && g2.correct >= 38 && g1.wrong.length === 0,
      `до ${g1.correct}/40, после ${g2.correct}/40`);
    // превью в черновике после восстановления (копии для распознавания нет — показывается полная)
    const srcOk2 = await q.evaluate(() => { const i = document.querySelector('[data-testid="ocr-source"] img'); return !!i && i.complete && i.naturalWidth > 0; });
    ok('P7б черновик восстановленного скрина: исходный скрин показан (полная копия)', srcOk2);
    await ctx2.close();
  }

  const foreign = requests.filter(x => !x.url.startsWith(ORIGIN) && !x.url.startsWith('data:') && !x.url.startsWith('blob:'));
  const posts = requests.filter(x => x.method !== 'GET');
  ok('P8 скрины никуда не уходят: ни одного запроса на чужие сайты и ни одной отправки (POST/PUT)', foreign.length === 0 && posts.length === 0, `чужих ${foreign.length}, не-GET ${posts.length}`);
  ok('P9 без ошибок JS', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.writeFileSync(`${DIR}/numbers-${ENGINE}.json`, JSON.stringify(numbers, null, 1));
  out(`ИТОГ ${ENGINE}: ${log.filter(x => x.startsWith('PASS')).length} PASS / ${log.filter(x => x.startsWith('FAIL')).length} FAIL`);
  if (browser) await browser.close(); else await ctx.close();
})().catch(e => { console.log(log.join('\n')); console.error('CRASH', e); process.exit(2); });
