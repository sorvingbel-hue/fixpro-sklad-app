// E2E «Форман · Объекты» на профиле iPhone 13: создать → фото → скрин заказа → сверка/этапы →
// перезагрузка (всё на месте) → открыть и удалить фото → итог → отчёт → второй браузер (чужого не видно).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2], DIR = process.argv[3];
const log = [];
const ok = (name, cond, extra = '') => { log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true, locale: 'ru-RU', timezoneId: 'America/Los_Angeles', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  const T = id => page.getByTestId(id);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 20000 });
  ok('1 первый экран объясняет, что это', await page.getByText('Форман — помощник бригадира HVAC').first().isVisible());
  ok('1б нет общей «Заметки смены» и импорта v0.3', (await page.getByText('Заметка смены').count()) === 0);
  ok('1в у страницы есть title', (await page.title()).includes('Форман'));
  await page.screenshot({ path: `${DIR}/01-start.png` });
  await T('new-create').click();
  ok('2 пустое название не принимается', await T('new-title-error').isVisible());
  await T('new-title').fill('Тест: замена печи');
  await T('new-order').fill('OT-TEST-1');
  await T('new-create').click();
  await T('job-screen').waitFor();
  ok('3 объект создан и открыт', await page.getByText('Тест: замена печи').first().isVisible());
  const bb = await T('job-back').first().boundingBox();
  ok('3б после создания виден верх объекта (без прыжка вниз)', !!bb && bb.y >= 0 && bb.y < 844, `y=${bb && Math.round(bb.y)}`);
  ok('3в новый объект без вымышленного шаблона', (await page.getByText('Furnace', { exact: false }).count()) === 0);
  // фото с «камеры»
  let [fc] = await Promise.all([page.waitForEvent('filechooser'), T('pick-camera').click()]);
  await fc.setFiles(`${DIR}/../test-photo.jpg`);
  await page.getByText('добавлено и сохранено', { exact: false }).waitFor({ timeout: 15000 });
  ok('4 фото с камеры добавлено', (await page.locator('[data-testid^="thumb-"]').count()) === 1);
  [fc] = await Promise.all([page.waitForEvent('filechooser'), T('pick-order').click()]);
  await fc.setFiles(`${DIR}/../test-order.png`);
  await page.getByText('Скрин заказа добавлен', { exact: false }).waitFor({ timeout: 15000 });
  ok('5 скрин заказа добавлен', (await page.locator('[data-testid^="thumb-"]').count()) === 2);
  await page.screenshot({ path: `${DIR}/02-photos.png` });
  // сверка: своя позиция + этап
  await T('item-new-name').fill('Медная труба 3/8');
  await T('item-new-qty').fill('25');
  await T('item-add').click();
  ok('6 своя позиция добавлена в сверку', await page.getByText('Медная труба 3/8').first().isVisible());
  await T('q-new').fill('Где щиток и есть ли свободный автомат?');
  await T('q-add').click();
  ok('6б свой вопрос добавлен', await page.getByText('Где щиток и есть ли свободный автомат?').first().isVisible());
  await T('check-scope').click();
  await page.waitForTimeout(1500); // автосохранение 0,7 с
  ok('7 видно «Сохранено на этом устройстве»', (await T('job-save').innerText()).includes('Сохранено на этом устройстве'));
  // перезагрузка
  await page.reload({ waitUntil: 'networkidle' });
  await T('jobs-section').waitFor({ timeout: 20000 });
  const card = page.getByText('Тест: замена печи').first();
  ok('8 после перезагрузки объект в списке', await card.isVisible());
  await page.screenshot({ path: `${DIR}/03-after-reload-list.png` });
  await page.locator('[data-testid^="job-open-"]').first().click();
  await T('job-screen').waitFor();
  await page.waitForTimeout(800);
  const thumbs = await page.locator('[data-testid^="thumb-"] img').count();
  ok('9 после перезагрузки фото на месте (2 миниатюры с картинкой)', thumbs === 2, `img=${thumbs}`);
  ok('10 после перезагрузки поле заказа на месте', (await T('job-order').inputValue()) === 'OT-TEST-1');
  ok('11 после перезагрузки своя позиция на месте', await page.getByText('Медная труба 3/8').first().isVisible());
  ok('12 после перезагрузки отметка этапа на месте', (await page.getByText('Этапы · 1/', { exact: false }).count()) > 0);
  await page.screenshot({ path: `${DIR}/04-after-reload-job.png`, fullPage: false });
  // открыть фото крупно и удалить
  await page.locator('[data-testid^="thumb-"]').first().click();
  await T('photo-viewer').waitFor(); await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/05-viewer.png` });
  await T('viewer-delete').click();
  await page.getByText('Фото удалено').waitFor({ timeout: 10000 });
  ok('13 фото удалено после подтверждения', (await page.locator('[data-testid^="thumb-"]').count()) === 1);
  // итог и отчёт
  const sum = await T('job-summary').innerText();
  ok('14 итог считает фото/скрин/этапы', /Фото: 0 · скрин заказа: 1/.test(sum) && /этапы: 1\//.test(sum), sum);
  const [dl] = await Promise.all([page.waitForEvent('download'), T('job-report').click()]);
  const rp = `${DIR}/report.txt`; await dl.saveAs(rp);
  const txt = fs.readFileSync(rp, 'utf8');
  ok('15 отчёт скачан: объект, заказ, скрин, позиция, этап', txt.includes('ОБЪЕКТ: Тест: замена печи') && txt.includes('OT-TEST-1') && txt.includes('test-order.png') && txt.includes('Медная труба 3/8') && txt.includes('Отмечено: Scope'), dl.suggestedFilename());
  ok('15б имя файла латиницей, в отчёте название, а не id', /^forman-otchet-OT-TEST-1-\d{4}-\d\d-\d\d-\d{4}\.txt$/.test(dl.suggestedFilename()) && txt.includes('Личная сверка Тест: замена печи') && !/job-[a-z0-9]{6,}/.test(txt), dl.suggestedFilename());
  await T('job-share-prepare').click();
  await page.waitForTimeout(800);
  const shareMsg = await page.getByText(/Готово к отправке|не умеет отправлять файлы/).first().innerText().catch(() => '');
  ok('15в «Подготовить отчёт с фото» отвечает понятно', !!shareMsg, shareMsg.slice(0, 80));
  await T('job-copy').click();
  await page.getByText('скопирован', { exact: false }).waitFor({ timeout: 5000 }).catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('15г «Скопировать текст» кладёт отчёт в буфер', clip.includes('ОБЪЕКТ: Тест: замена печи'));
  await page.locator('[data-testid="job-summary"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/06-summary.png` });
  // второй «телефон»: чистый контекст — данных первого не видно
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.getByTestId('jobs-section').waitFor({ timeout: 20000 });
  ok('16 другой браузер не видит чужие объекты', (await p2.getByText('Тест: замена печи').count()) === 0);
  // пример
  await p2.getByTestId('new-example').click();
  await p2.getByTestId('job-screen').waitFor();
  ok('17 «Посмотреть пример» открывает ДЕМО-объект с шаблоном', (await p2.getByTestId('job-demo').isVisible()) && (await p2.getByText('Furnace', { exact: false }).count()) > 0);
  // удаление объекта
  await T('job-delete').click();
  await page.getByText('удалён', { exact: false }).waitFor({ timeout: 10000 });
  ok('18 объект удаляется', (await page.locator('[data-testid^="job-open-"]').count()) === 0);
  ok('19 без ошибок JS на странице', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(log.join('\n'));
  await browser.close();
})().catch(e => { console.log(log.join('\n')); console.error('CRASH', e); process.exit(2); });
