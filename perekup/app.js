// «Перекуп» — интерфейс. Вся логика и формулы — в logic.js и ядре core/calc.js.
// Данные только в этом браузере (localStorage). Никаких запросов в сеть, кроме загрузки самих файлов программы.
// Правило вывода: всё, что вставляется в HTML, проходит через esc() (или берётся из закрытого списка значений).
import * as L from './logic.js';
import * as LG from './ledger.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fm = (v, o) => esc(L.fmtMoney(v, o));
const fd = (s) => esc(L.fmtDate(s));
const day = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? L.todayLocal(new Date(t)) : ''; };

// ---------- хранилище ----------
let realStorage = null;
try {
  realStorage = window.localStorage;
  realStorage.getItem('perekup.probe');
} catch {
  realStorage = null;
}
const memStorage = {
  d: {},
  get length() { return Object.keys(this.d).length; },
  key(i) { return Object.keys(this.d)[i] ?? null; },
  getItem(k) { return Object.hasOwn(this.d, k) ? this.d[k] : null; },
  setItem(k, v) { this.d[k] = String(v); },
  removeItem(k) { delete this.d[k]; },
};
const storage = realStorage || memStorage;

// Испорченные сохранённые данные не затираем молча: их текст откладывается в отдельный ключ — один раз
// (тот же текст повторно не откладывается, копий не больше L.MAX_BROKEN). Данные среза 1 и так остаются
// под старым ключом. true — текст сохранён (или откладывать нечего).
function setAsideBroken(loadedNow) {
  if (!(loadedNow.error && loadedNow.raw) || loadedNow.migrated) return true;
  return L.setAsideBroken(storage, loadedNow.raw).ok;
}
const loaded = L.loadState(storage);
let state = loaded.state;
const asideOk = setAsideBroken(loaded);
const ui = { tab: 'eval', itemId: null, filter: 'all', ledgerYear: null, summaryYear: null };
// Настройки для расчётов «сейчас»: общие настройки + ставка за милю и порог 1099-K из реестра правил.
const eff = () => L.effectiveSettings(state);

// Вещи на момент последней записи: изменённые с тех пор отмечаются «изменено в новой версии» (meta.v1Sync),
// чтобы запись из вкладки со старой программой не затёрла их молча (L.syncLegacy).
let savedItems = state.items;
function persist() {
  if (state.meta && state.meta.v1Sync) state = L.markTouched(state, L.changedItemIds(savedItems, state.items));
  const ok = realStorage ? L.saveState(storage, state) : false;
  if (ok) savedItems = state.items;
  else showBanner('Не получилось сохранить на телефоне (память браузера закрыта или полна). Сделайте копию в «Настройках».');
  return ok;
}

// Вкладка со старой программой (до обновления) записала что-то под старым ключом уже после перевода:
// новые вещи добавляются, изменённые там (и не тронутые здесь) — берутся оттуда; спорные — только называются.
function syncFromLegacy() {
  if (!realStorage || !state.meta || !state.meta.v1Sync) return;
  let text = null;
  try { text = storage.getItem(L.LEGACY_STORAGE_KEY); } catch { return; }
  const r = L.syncLegacy(state, text);
  if (!r.changed) return;
  state = r.state;
  savedItems = state.items;
  persist();
  const parts = [];
  if (r.added.length) parts.push(`добавлено вещей: ${r.added.length}`);
  if (r.updated.length) parts.push(`обновлено: ${r.updated.length}`);
  if (r.conflicts.length) parts.push(`не перенесено (изменено и здесь): ${r.conflicts.slice(0, 3).join(', ')}${r.conflicts.length > 3 ? '…' : ''}`);
  if (parts.length) showBanner(`Записи из старой версии программы: ${parts.join('; ')}.`, 'info');
}

function readDraft() {
  try { return L.cleanDraft(JSON.parse(storage.getItem(L.DRAFT_KEY) || 'null')); } catch { return null; }
}
function writeDraft(input) {
  try { storage.setItem(L.DRAFT_KEY, JSON.stringify(input)); } catch { /* черновик — только удобство */ }
}
function clearDraft() {
  try { storage.removeItem(L.DRAFT_KEY); } catch { /* ignore */ }
}

let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch { /* ignore */ }
}

// ---------- мелочи интерфейса ----------
function showBanner(text, kind = 'warn', actionHtml = '') {
  const b = $('#banner');
  b.className = 'banner' + (kind === 'info' ? ' info' : '');
  b.innerHTML = `<span>${esc(text)}</span>${actionHtml}`;
  b.hidden = false;
}

let toastTimer = 0;
function toast(html, ms = 4000) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const toastText = (text, ms) => toast(`<span>${esc(text)}</span>`, ms);

// Шторка — по видимой части экрана: на iPhone открытая клавиатура уменьшает видимую область, а не окно,
// и без этого низ шторки (кнопка «Сохранить») оказывается под клавиатурой.
function fitSheet() {
  const w = $('#sheet');
  const vv = window.visualViewport;
  if (!vv || w.hidden) return;
  w.style.top = `${Math.max(0, vv.offsetTop)}px`;
  w.style.height = `${vv.height}px`;
  w.style.bottom = 'auto';
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fitSheet);
  window.visualViewport.addEventListener('scroll', fitSheet);
}

function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  fitSheet();
  const first = $('#sheet-body input:not([type=hidden]):not([type=radio]):not([type=checkbox]), #sheet-body select');
  if (first && window.matchMedia('(hover: hover)').matches) first.focus();
}
function closeSheet() {
  const w = $('#sheet');
  w.hidden = true;
  w.style.top = w.style.height = w.style.bottom = '';
  $('#sheet-body').innerHTML = '';
  document.body.style.overflow = '';
}

function catName(id) {
  const c = state.settings.categories.find((x) => x.id === id);
  return c ? c.name : 'без категории';
}

function setFieldErrors(root, errors) {
  $$('.field', root).forEach((f) => f.classList.remove('bad'));
  $$('.err', root).forEach((e) => e.remove());
  for (const [k, msg] of Object.entries(errors || {})) {
    const input = root.querySelector(`[name="${CSS.escape(k)}"]`);
    const field = input ? input.closest('.field') : null;
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = msg;
    if (field) { field.classList.add('bad'); field.appendChild(p); }
    else root.querySelector('.form-errors')?.appendChild(p);
  }
}

function formValues(f) {
  const raw = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') { if (el.checked) raw[el.name] = el.value; continue; }
    if (el.type === 'checkbox') { raw[el.name] = el.checked; continue; }
    raw[el.name] = el.value;
  }
  return raw;
}

function errorCard(title, e) {
  return `<div class="screen"><h1>${esc(title)}</h1><div class="card warnbox" data-testid="render-error"><h3>Не получилось показать этот экран</h3>
    <p>Ошибка: ${esc((e && e.message) || e)}. Данные не изменены.</p>
    <p class="note">Сделайте копию в «Настройках». Если ошибка повторяется — «Стереть все данные» и загрузить копию.</p></div></div>`;
}

// ---------- навигация ----------
function route() {
  let h = location.hash.replace(/^#/, '');
  try { h = decodeURIComponent(h); } catch { h = ''; }
  const [tab, id] = h.split('/');
  ui.tab = ['eval', 'stock', 'ledger', 'settings'].includes(tab) ? tab : 'eval';
  ui.itemId = ui.tab === 'stock' && id ? id : null;
  ui.ledgerFocus = ui.tab === 'ledger' && id ? id : null;
  $$('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== ui.tab; });
  $$('.tabs a').forEach((a) => {
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (ui.tab === 'stock') renderStock();
  if (ui.tab === 'ledger') renderLedger();
  if (ui.tab === 'settings') renderSettings();
  if (ui.tab === 'eval') { fillCategorySelect(); onEvalInput(); }
  updateSticky();
}

function go(hash) {
  if (location.hash === '#' + hash) route();
  else location.hash = hash;
  window.scrollTo(0, 0);
}

// ---------- экран «Оценить вещь» ----------
const form = $('#eval-form');
let lastResult = null;

function fillCategorySelect() {
  const sel = $('#eval-cat');
  const cur = sel.value;
  sel.innerHTML = `<option value="">— выберите —</option>` + state.settings.categories
    .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.ebayName ? ' · ' + esc(c.ebayName) : ''}</option>`).join('');
  if (cur && state.settings.categories.some((c) => c.id === cur)) sel.value = cur;
}

function readForm() {
  const o = formValues(form);
  if (!('shipMode' in o)) o.shipMode = '';
  o.own = form.dataset.own === '1';
  return o;
}

function writeForm(o) {
  form.reset();
  form.dataset.own = o && o.own ? '1' : '0';
  if (!o) return;
  for (const el of form.elements) {
    if (!el.name || !(el.name in o)) continue;
    if (el.type === 'radio') el.checked = el.value === o[el.name];
    else if (el.type === 'checkbox') el.checked = o[el.name] === true;
    else el.value = typeof o[el.name] === 'string' ? o[el.name] : '';
  }
}

function updateShipFields(mode) {
  $$('[data-ship]', form).forEach((el) => { el.hidden = !el.dataset.ship.split(' ').includes(mode); });
  const own = $('[data-action="own-item"]');
  own.setAttribute('aria-pressed', form.dataset.own === '1' ? 'true' : 'false');
}

function onEvalInput(e) {
  if (e && e.target && e.target.name === 'buyPrice' && form.dataset.own === '1') {
    const v = L.parseNumber(e.target.value).value;
    if (v !== 0) form.dataset.own = '0';
  }
  const input = readForm();
  updateShipFields(input.shipMode);
  if (e) writeDraft(L.cleanDraft(input));
  try {
    lastResult = L.evaluate(eff(), input);
    renderResult(lastResult);
  } catch (err) {
    lastResult = null;
    $('#eval-result').innerHTML = `<div class="card warnbox"><h3>Не получилось посчитать</h3><p>${esc(err && err.message)}</p></div>`;
  }
  updateSticky();
}

const VCLASS = { buy: 'v-buy', offer: 'v-offer', skip: 'v-skip', insufficient: 'v-insufficient' };
const VCHIP = { buy: 'buy', offer: 'offer', skip: 'skip', insufficient: 'insufficient' };
const ST_CLASS = { evaluated: 'st-evaluated', have: 'st-have', listed: 'st-listed', sold: 'st-sold', paid: 'st-paid', writeoff: 'st-writeoff' };
const kindOf = (k) => (Object.hasOwn(VCLASS, k) ? k : 'insufficient');

function renderResult(r) {
  const box = $('#eval-result');
  const kind = kindOf(r.kind);
  const title = L.verdictTitle(r);
  let sub = '';
  if (r.own && kind === 'buy') sub = 'своя вещь — стоит выставить на eBay';
  else if (r.own && kind === 'skip') sub = 'своя вещь — на eBay не выгодно, см. «Почему»';
  else if (kind === 'offer') sub = r.ceiling && r.ceiling.low < r.maxOffer ? `начните торг с ${L.fmtMoney(r.ceiling.low, { cents: false })}` : 'выше этой цены не брать';
  else if (kind === 'insufficient') sub = 'решения нет — сначала заполните недостающее';
  const strTxt = r.str === null ? '—' : L.fmtPct(r.str);
  const hasCeiling = r.maxOffer !== null && r.maxOffer !== undefined;
  const lowTxt = r.ceiling && r.ceiling.low !== null ? `осторожно: ${L.fmtMoney(r.ceiling.low, { cents: false })}` : '';
  let breakdown = '';
  if (r.breakdown) {
    const b = r.breakdown;
    const cat = r.category;
    breakdown = `
      <details class="card more"><summary>Смета: из чего прибыль</summary>
        <table class="smeta">
          <tr><td>Продажа (медиана)</td><td>${fm(b.sale)}</td></tr>
          <tr><td>Доставка с покупателя</td><td>+${fm(b.shipCharged)}</td></tr>
          <tr><td>Комиссия eBay ≈ ${esc((cat.feePct * 100).toFixed(1))}% + ${fm(cat.perOrderFee)}</td><td>−${fm(b.fees)}</td></tr>
          <tr><td>Этикетка</td><td>−${fm(b.label)}</td></tr>
          <tr><td>Упаковка</td><td>−${fm(b.packaging)}</td></tr>
          <tr><td>Покупка</td><td>−${fm(b.buyPrice)}</td></tr>
          <tr><td>Поездка (мили)</td><td>−${fm(b.trip)}</td></tr>
          <tr class="total"><td>Чистыми</td><td>${fm(b.net)}</td></tr>
        </table>
        <p class="note">Комиссия считается и с налога покупателя (~${esc((state.settings.buyerTaxPct * 100).toFixed(2))}%).</p>
      </details>`;
  }
  const zero = r.net !== null && r.notes.length
    ? `<p class="note warn" data-testid="zero-notes">${r.notes.map(esc).join('; ')}. Если такие расходы есть — откройте «Ещё расходы» выше.</p>` : '';
  const warns = r.warnings.length
    ? `<div class="card warnbox" data-testid="warnings"><h3>Внимание</h3><ul class="reasons">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  box.innerHTML = `
    <div class="result" id="result-card">
      <div class="verdict ${VCLASS[kind]}" data-testid="verdict" data-kind="${kind}">
        <div class="v-title">${esc(title)}</div>
        ${sub ? `<div class="v-sub">${esc(sub)}</div>` : ''}
      </div>
      ${warns}
      <div class="kpis">
        <div class="kpi"><span>Чистая прибыль</span><b data-testid="net">${r.net === null ? '—' : fm(r.net)}</b><i>${r.net === null ? 'не посчитать без данных' : 'после всех расходов'}</i></div>
        <div class="kpi"><span>Спрос (STR)</span><b data-testid="str">${esc(strTxt)}</b><i>ориентир, не срок продажи</i></div>
        <div class="kpi wide"><span>Потолок покупки</span><b data-testid="ceiling">${hasCeiling ? fm(r.maxOffer, { cents: false }) : '—'}</b><i>${hasCeiling ? esc(lowTxt || 'больше не платить') : 'появится, когда хватит данных'}</i></div>
      </div>
      <div class="card">
        <h3>${kind === 'insufficient' ? 'Чего не хватает' : 'Почему'}</h3>
        <ul class="reasons" data-testid="reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${zero}
      </div>
      ${breakdown}
    </div>`;
}

function updateSticky() {
  const s = $('#sticky-verdict');
  if (ui.tab !== 'eval' || !lastResult || resultVisible) { s.hidden = true; return; }
  const r = lastResult;
  s.className = 'sticky-verdict ' + VCLASS[kindOf(r.kind)];
  s.innerHTML = `<span>${esc(L.verdictTitle(r))}</span><span class="num">${r.net === null ? '' : fm(r.net)}</span>`;
  s.hidden = false;
}

let resultVisible = false;
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((ents) => { resultVisible = ents.some((e) => e.isIntersecting); updateSticky(); });
  io.observe($('#eval-result'));
}

function resetEvalForm() {
  clearDraft();
  writeForm(null);
  fillCategorySelect();
  onEvalInput();
  window.scrollTo(0, 0);
}

// decision: 'take' — «беру / думаю» (в склад), 'pass' — «не беру» (запись в журнал решений).
function saveEval(decision) {
  const input = readForm();
  if (decision === 'pass' && L.isEvalEmpty(input)) return toastText('Нечего записывать — форма пустая');
  const s = eff();
  const r = L.evaluate(s, input);
  const item = L.makeItem(s, input, r, new Date(), decision);
  state = { ...state, items: [item, ...state.items] };
  persist();
  askPersist();
  resetEvalForm();
  const what = decision === 'pass' ? 'Записано в журнал («не беру»)' : 'Сохранено в склад';
  toast(`<span>${esc(what)}: «${esc(item.title)}»</span><button type="button" class="link" data-action="open-item" data-id="${esc(item.id)}">Открыть</button>`);
}

// ---------- экран «Склад» ----------
const FILTERS = [
  ['all', 'Все', () => true],
  ['evaluated', 'Оценены', (it) => it.status === 'evaluated' && !L.isPassed(it)],
  ['passed', 'Не взял', (it) => L.isPassed(it)],
  ['stock', 'На складе', (it) => it.status === 'have' || it.status === 'listed'],
  ['sold', 'В пути', (it) => it.status === 'sold'],
  ['closed', 'Закрыты', (it) => it.status === 'paid' || it.status === 'writeoff'],
];

function payoutLine(it) {
  const p = L.payoutInfo(it, state.items, state.settings);
  if (!p) return '';
  if (p.state === 'cash') return 'Наличные — деньги получены при продаже';
  if (p.state === 'paid') return `Деньги пришли через ${p.days} дн.`;
  if (p.estimateDays !== null) return `Деньги в пути · оценка ≈ ${p.estimateDays} дн. (к ${L.fmtDate(p.expectedDate)})`;
  return 'Деньги в пути · срок выплаты: неизвестно';
}

function itemNums(it) {
  const parts = [];
  if (it.have) parts.push(`Покупка ${L.fmtMoney(L.basisOf(it.have))}`);
  else if (it.eval && it.eval.result) parts.push(`Прибыль по оценке ${it.eval.result.net === null ? '—' : L.fmtMoney(it.eval.result.net)}`);
  if (it.listed && it.listed.price !== null && it.status === 'listed') parts.push(`Цена ${L.fmtMoney(it.listed.price)}`);
  if (it.sold && (it.status === 'sold' || it.status === 'paid')) {
    const r = L.saleResult(it, state.settings);
    parts.push(`Продажа ${L.fmtMoney(r.gross)}`);
    parts.push(r.net === null ? 'Чистыми: неизвестно' : `Чистыми ${r.feesEstimated ? '≈ ' : ''}${L.fmtMoney(r.net)}`);
  }
  return parts.join(' · ');
}

function renderStock() {
  const root = $('#stock-root');
  try {
    if (ui.itemId) {
      const it = state.items.find((x) => x.id === ui.itemId);
      if (it) return renderItem(root, it);
      ui.itemId = null;
    }
    renderStockList(root);
  } catch (e) {
    root.innerHTML = errorCard('Склад', e);
  }
}

function renderStockList(root) {
  const t = L.totals(state);
  const year = Number(L.todayLocal().slice(0, 4));
  const f = FILTERS.find((x) => x[0] === ui.filter) || FILTERS[0];
  const list = state.items.filter(f[2]);
  const k = t.k1099.find((x) => x.channel === 'ebay');
  const kr = t.k1099Rule; // порог из реестра правил на текущий год (null — правила нет)
  const netNotes = [];
  if (t.net.feesEstimated) netNotes.push(`продаж с комиссией по % категории (≈): ${t.net.feesEstimated}`);
  if (t.net.incomplete) netNotes.push(`не учтены — нет цены этикетки: ${t.net.incomplete}`);
  if (t.refunds.count) netNotes.push(`возвраты учтены: ${L.fmtMoney(t.refunds.amount)}`);
  const payoutTxt = t.payout.n ? `${t.payout.medianDays} дн.` : 'неизвестно';
  const ratio = kr ? Math.max(kr.minGross > 0 ? k.gross / kr.minGross : 1, kr.minCount > 0 ? k.count / kr.minCount : 1) : 0;
  const barW = Number.isFinite(ratio) ? Math.min(100, Math.max(0, ratio * 100)) : 100;
  const krChips = kr ? unvChips(kr.rules) : '';
  const receivedNote = [`выплат: ${t.received.count}`];
  if (t.received.cash) receivedNote.push(`наличными: ${t.received.cash}`);
  if (t.received.estimated) receivedNote.push(`без введённой суммы: ${t.received.estimated} (≈ оценка)`);
  root.innerHTML = `
    <div class="screen">
      <h1>Склад</h1>
      <div class="sum-grid" data-testid="totals">
        <div class="sum"><span>Вложено в покупки</span><b data-testid="t-invested">${fm(t.invested)}</b><i>поездки: ${fm(t.trips)}</i></div>
        <div class="sum"><span>Продано</span><b data-testid="t-sold">${fm(t.sold.gross)}</b><i>${esc(t.sold.count)} шт., с доставкой</i></div>
        <div class="sum"><span>Чистая прибыль</span><b data-testid="t-net">${fm(t.net.value)}</b><i>${esc(netNotes.join('; ') || 'по проданным')}</i></div>
        <div class="sum ${t.transit.count ? 'hl' : ''}"><span>Деньги в пути</span><b data-testid="t-transit">${fm(t.transit.amount)}</b><i>продаж: ${esc(t.transit.count)} · примерно, за вычетом комиссии</i></div>
        <div class="sum"><span>Деньги пришли</span><b data-testid="t-received">${fm(t.received.amount)}</b><i>${esc(receivedNote.join(' · '))}</i></div>
        <div class="sum"><span>Срок выплаты eBay</span><b data-testid="t-payout">${esc(payoutTxt)}</b><i>${t.payout.n ? `медиана по ${esc(t.payout.n)} вашим выплатам` : 'появится после первой выплаты'}</i></div>
        <div class="sum"><span>Лежит на складе</span><b>${esc(t.stock.count)} шт.</b><i>куплено на ${fm(t.stock.basis)}</i></div>
        <div class="sum"><span>Журнал решений</span><b data-testid="t-decisions">${esc(t.decisions.evaluated)} шт.</b><i>оценено, не куплено; из них «не беру»: ${esc(t.decisions.passed)}</i></div>
        ${t.writeoff.count ? `<div class="sum"><span>Списано</span><b data-testid="t-writeoff">${esc(t.writeoff.count)} шт.</b><i>себестоимость ${fm(t.writeoff.basis)} — убыток, в прибыль выше не входит</i></div>` : ''}
      </div>
      <div class="card k1099" data-testid="k1099">
        <h3>1099-K · eBay · ${esc(year)}</h3>
        ${kr ? `<p class="num"><b>${fm(k.gross)}</b> из ${fm(kr.minGross, { cents: false })} · <b>${esc(k.count)}</b> из ${esc(kr.minCount)} сделок${krChips}</p>
        <div class="bar" aria-hidden="true"><i style="width:${barW.toFixed(1)}%"></i></div>
        <p class="note">${k.overThreshold ? '<b>Порог превышен</b> — eBay пришлёт форму 1099-K.' : 'Порог не превышен (нужно больше суммы <b>и</b> больше сделок).'} Доход учитывается в налогах в любом случае, даже без формы.</p>`
        : `<p class="num"><b>${fm(k.gross)}</b> · <b>${esc(k.count)}</b> сделок</p><p class="note">Порога 1099-K на ${esc(year)} год нет в реестре правил («Учёт»).</p>`}
        ${t.k1099.filter((x) => x.channel !== 'ebay').map((x) => `<p class="note">${esc(L.CHANNELS[x.channel])}: ${fm(x.gross)} · ${esc(x.count)} сделок${x.overThreshold ? ' — порог превышен' : ''}</p>`).join('')}
        <a class="link" href="#ledger" data-testid="to-ledger">Учёт: поездки, расходы, сводка за год →</a>
      </div>
      <button type="button" class="btn btn-soft btn-wide" data-action="open-lot">Купил лот (несколько вещей за одну цену)</button>
      <div class="chips" role="group" aria-label="Фильтр">
        ${FILTERS.map(([id, name, fn]) => `<button type="button" class="chip" data-action="filter" data-filter="${esc(id)}" aria-pressed="${ui.filter === id}">${esc(name)} · ${esc(state.items.filter(fn).length)}</button>`).join('')}
      </div>
      ${list.length ? `<ul class="items" data-testid="items">${list.map((it) => `
        <li><button type="button" class="item" data-action="open-item" data-id="${esc(it.id)}">
          <div class="item-top"><span class="item-title">${esc(it.title)}</span><span class="st ${ST_CLASS[it.status] || ''}">${esc(L.statusLabel(it))}</span></div>
          <div class="item-meta">${esc(catName(it.categoryId))}${it.have && it.have.sku ? ` · ${esc(it.have.sku)}` : ''}${it.have && it.have.location ? ` · лежит: ${esc(it.have.location)}` : ''}${it.eval ? ` · оценка: <span class="vchip ${VCHIP[kindOf(it.eval.result.kind)]}">${esc(it.eval.result.title)}</span>` : ''}</div>
          <div class="item-nums">${esc(itemNums(it))}</div>
          ${it.status === 'sold' || it.status === 'paid' ? `<div class="item-pay">${esc(payoutLine(it))}</div>` : ''}
        </button></li>`).join('')}</ul>` : `<p class="empty">${state.items.length ? 'В этом фильтре пусто.' : 'Пока пусто. Оцените вещь и нажмите «Сохранить в склад».'}</p>`}
    </div>`;
}

const STEP_TITLE = { have: 'Купил / своя', listed: 'Выставил', sold: 'Продал', paid: 'Деньги пришли' };

function haveLine(it) {
  const h = it.have;
  if (!h) return '';
  const b = L.basisOf(h);
  const parts = [fd(h.date), fm(b) + (b !== h.buyPrice ? ` <span class="note">(цена ${fm(h.buyPrice)} + налог, комиссия аукциона, доставка)</span>` : ''), esc(L.ORIGINS[h.origin])];
  if (h.miles) parts.push(`${milesTxt(h.miles)}${typeof h.mileRate === 'number' ? '' : ' (ставки за милю на эту дату нет в реестре)'}`);
  if (h.tripId) {
    const tr = (state.trips || []).find((x) => x.id === h.tripId);
    parts.push(`поездка из журнала${tr ? `: ${milesTxt(tr.miles)} · ${esc(L.TRIP_KINDS[tr.kind] || '')}${tr.to ? ' · ' + esc(tr.to) : ''}` : ''}`);
  }
  if (h.lotId) parts.push('из лота');
  if (h.place) parts.push(`где: ${esc(h.place)}`);
  if (h.seller) parts.push(`продавец: ${esc(h.seller)}`);
  if (h.sku) parts.push(`SKU ${esc(h.sku)}`);
  if (h.location) parts.push(`лежит: ${esc(h.location)}`);
  if (it.checked) parts.push(`проверка ${fd(it.checked.date)}: ${esc(L.CHECK_RESULTS[it.checked.result])}${it.checked.note ? ' — ' + esc(it.checked.note) : ''}`);
  return parts.join(' · ');
}

function soldLine(it) {
  const s = it.sold;
  if (!s) return '';
  const parts = [fd(s.date), esc(L.CHANNELS[s.channel]), `${fm(s.price)} + доставка ${fm(s.shipCharged)}`];
  if (s.channel !== 'cash') parts.push(feesText(s));
  if (s.taxCollected !== null && s.taxCollected !== undefined) parts.push(`налог удержала площадка ${fm(s.taxCollected)}`);
  if (s.refund) parts.push(`<b>возврат ${fm(s.refund)}</b> (${fd(L.refundDateOf(s))})`);
  if (it.shipped) parts.push(`отправлена ${fd(it.shipped.date)}${it.shipped.tracking ? ` (трек ${esc(it.shipped.tracking)})` : ''}`);
  return parts.join(' · ');
}

// Комиссия продажи по видам одной строкой: «комиссия $15.40: площадка $13.00, за заказ $0.40, реклама $2.00».
function feesText(s) {
  const fo = L.feesOf(s);
  const fb = s.feesByType || {};
  if (!fo.known) return `комиссия ≈ по % категории${fo.ads ? ` + реклама ${fm(fo.ads)}` : ''}`;
  const by = [];
  if (fb.finalValue !== null) by.push(`площадка ${fm(fo.finalValue)}`);
  if (fb.perOrder !== null) by.push(`за заказ ${fm(fo.perOrder)}`);
  if (fo.ads) by.push(`реклама ${fm(fo.ads)}`);
  if (fb.other !== null) by.push(`прочее ${fm(fo.other)}`);
  return `комиссия ${fm(fo.total)}${s.feesCombined ? ' (одной суммой, из старой записи)' : ''}${by.length > 1 ? ': ' + by.join(', ') : ''}`;
}

function paidLine(it) {
  const p = it.paid;
  if (!p) return '';
  if (p.cash) return `${fd(p.date)} · наличными ${fm(p.amount)}`;
  const parts = [fd(p.date)];
  if (p.amount !== null) parts.push(fm(p.amount));
  if (p.withheld !== null && p.withheld !== undefined) parts.push(`удержано ${fm(p.withheld)}`);
  if (p.payoutId) parts.push(`ID выплаты ${esc(p.payoutId)}`);
  return parts.join(' · ');
}

// Продажи, после которых покупатель вернул вещь: они остаются в учёте своего года (доход, этикетка, комиссия),
// возврат денег, обратная доставка и возвращённая комиссия — в год возврата.
function pastSalesHtml(it) {
  if (!L.hasReturns(it)) return '';
  const li = it.pastSales.map((p) => {
    const s = p.sold;
    const r = p.returned;
    const parts = [`продана ${fd(s.date)} · ${esc(L.CHANNELS[s.channel])} · ${fm(Math.round((s.price + s.shipCharged) * 100) / 100)}`];
    if (s.refund) parts.push(`возврат денег ${fm(s.refund)} (${fd(L.refundDateOf(s))})`);
    parts.push(`<b>вернули ${fd(r.date)}</b>`, `покупателю вернул ${fm(r.refund)}`);
    if (r.returnShipping) parts.push(`обратная доставка ${fm(r.returnShipping)}`);
    if (r.feeCredit) parts.push(`площадка вернула комиссию ${fm(r.feeCredit)}`);
    if (r.note) parts.push(esc(r.note));
    return `<li>${parts.join(' · ')}</li>`;
  }).join('');
  return `<div class="card" data-testid="past-sales"><h3>Продажи с возвратом</h3><ul class="reasons">${li}</ul>
    <p class="note">Этикетка, комиссия и доход этих продаж остаются в учёте своего года.</p></div>`;
}

function returnFormHtml(it) {
  const s = it.sold;
  const gross = Math.round((s.price + s.shipCharged - (s.refund || 0)) * 100) / 100;
  const money = (name, label, value, hint = '') => `<label class="field"><span class="lbl">${label}${hint ? ` <i>${hint}</i>` : ''}</span><input name="${name}" inputmode="decimal" value="${esc(value)}"></label>`;
  return `<form id="return-form" novalidate><div class="sheet-body">
    <p class="note">Продажа ${fd(s.date)} (${fm(gross)}) останется в учёте своего года вместе с этикеткой и комиссией. Вещь снова будет на складе.</p>
    <label class="field"><span class="lbl">Дата возврата</span><input type="date" name="date" value="${esc(L.todayLocal())}"></label>
    ${money('refund', 'Вернул покупателю, $', String(gross), '(0 — если ничего)')}
    ${money('returnShipping', 'Обратная доставка, $', '', '(пусто = $0)')}
    ${money('feeCredit', 'Площадка вернула комиссию, $', '', '(пусто = $0)')}
    <label class="field"><span class="lbl">Заметка <i>(по желанию)</i></span><input name="note" type="text" maxlength="200"></label>
    <div class="form-errors"></div>
    <button type="submit" class="btn btn-main btn-big">Записать возврат</button>
  </div></form>`;
}

function submitReturnForm(f) {
  const it = state.items.find((x) => x.id === ui.itemId);
  if (!it) return closeSheet();
  const res = L.returnToStock(it, formValues(f));
  if (!res.ok) return setFieldErrors(f, res.errors);
  replaceItem(res.item);
  closeSheet();
  renderStock();
  toastText('Возврат записан: вещь снова на складе', 3000);
}

// Подтверждение «шаг назад»: что именно сотрётся. Продажу шаг назад стирает целиком (это для ошибок ввода);
// если покупатель вернул вещь — для этого отдельная кнопка, она сохраняет продажу и её расходы.
function stepBackMsg(it) {
  if (it.status === 'writeoff') return 'Отменить списание? Вещь вернётся на склад.';
  if (it.status === 'have' && L.hasReturns(it)) return 'Отменить возврат вещи? Продажа снова будет как была, вещь — не на складе.';
  if (it.status === 'have') return `Отменить покупку? Вещь снова станет «оценена».${tripKeptNote(it)}`;
  if ((it.status === 'sold' || it.status === 'paid') && it.sold) {
    if (it.status === 'paid' && !(it.paid && it.paid.cash)) return 'Вернуть шаг назад? Запись «деньги пришли» сотрётся, продажа останется.';
    const y = it.sold.date.slice(0, 4);
    const past = Number(y) < Number(L.todayLocal().slice(0, 4)) ? `\nЭто продажа ${y} года — сводка и CSV за ${y} изменятся.` : '';
    return `Вернуть шаг назад? Продажа сотрётся целиком — с этикеткой и комиссией.${past}\nЕсли покупатель вернул вещь — нажмите «Покупатель вернул вещь»: продажа и её расходы останутся в учёте.`;
  }
  return 'Вернуть вещь на шаг назад? Данные последнего шага сотрутся.';
}

// Текст для подтверждения: мили покупки не пропадут, а перейдут в журнал поездок.
function tripKeptNote(it) {
  const t = L.purchaseTripOf(it);
  return t ? `\nПоездка за покупкой (${t.miles} ${milesWord(t.miles)}, ${L.fmtDate(t.date)}) перейдёт в журнал поездок.` : '';
}

function renderItem(root, it) {
  const ev = it.eval;
  const pay = L.payoutInfo(it, state.items, state.settings);
  const sale = it.status === 'sold' || it.status === 'paid' ? L.saleResult(it, state.settings) : null;
  const next = L.nextStepLabel(it);
  const lot = L.lotOf(state, it);
  const si = L.doneIndex(it);
  const steps = [
    ['evaluated', 'Оценена', ev ? `${fd(day(ev.at))} · ${esc(ev.result.title)}${L.isPassed(it) ? ' · решил: не беру' : ''}${it.decision && it.decision.note ? ' · ' + esc(it.decision.note) : ''}` : 'без оценки (из лота)'],
    ['have', it.have && it.have.origin !== 'bought' ? 'Своя вещь' : 'Куплена', haveLine(it)],
    ['listed', 'Выставлена', it.listed ? `${fd(it.listed.date)}${it.listed.price !== null ? ' · ' + fm(it.listed.price) : ''}` : ''],
    ['sold', 'Продана', soldLine(it)],
    ['paid', it.paid && it.paid.cash ? 'Деньги на руках' : 'Деньги пришли', paidLine(it)],
  ];
  const editable = (s, i) => i > 0 && i <= si && !(s === 'paid' && it.paid && it.paid.cash);
  const editLabel = (s) => (s === 'have' && lot ? 'Изменить SKU / место' : 'Изменить');
  let payHtml = '';
  if (pay && pay.state === 'cash') {
    const tx = L.ruleOnDate(state.taxRules, 'sd_sales_tax', it.sold.date);
    const g = Math.round((it.sold.price + it.sold.shipCharged) * 100) / 100;
    const taxTxt = tx ? `Налог с продаж ≈ ${fm(Math.round(g * tx.value * 100) / 100)} (${esc(L.fmtRuleValue(tx.rule))}, Сан-Диего)${unvChip(tx.rule)}${srcLink(tx.rule)}` : 'Ставки налога с продаж на эту дату нет в реестре.';
    payHtml = `<div class="card payout paid" data-testid="payout"><span>Продана за наличные</span><span class="big" data-testid="payout-days">деньги на руках</span><span class="note" data-testid="cash-tax">${taxTxt}</span><span class="note">Seller's permit (бесплатно)${srcLink({ sourceUrl: L.SELLERS_PERMIT.sourceUrl })}</span></div>`;
  } else if (pay && pay.state === 'paid') {
    payHtml = `<div class="card payout paid" data-testid="payout"><span>Деньги пришли через</span><span class="big" data-testid="payout-days">${esc(pay.days)} дн.</span><span class="note">от продажи ${fd(it.sold.date)} до выплаты ${fd(it.paid.date)}</span></div>`;
  } else if (pay && pay.state === 'transit') {
    payHtml = `<div class="card payout transit" data-testid="payout"><span>Деньги в пути: ${fm(L.expectedPayout(it, state.settings))} <i class="note">(примерно, за вычетом комиссии)</i></span>
      <span class="big" data-testid="payout-days">${pay.estimateDays !== null ? `оценка ≈ ${esc(pay.estimateDays)} дн.` : 'срок: неизвестно'}</span>
      <span class="note">${pay.estimateDays !== null ? `по ${esc(pay.estimateN)} вашим прошлым выплатам (${esc(L.CHANNELS[it.sold.channel])}); ожидается к ${fd(pay.expectedDate)}. Это оценка, не факт.` : `оценка появится после ${esc(pay.needN)} ваших выплат (сейчас ${esc(pay.estimateN)}). Факт — когда нажмёте «Деньги пришли».`}</span></div>`;
  }
  const extras = [];
  if (it.status === 'have' || it.status === 'listed') {
    extras.push(`<button type="button" class="btn btn-ghost" data-action="extra" data-kind="checked">${it.checked ? 'Изменить проверку' : 'Проверил (работает / нет)'}</button>`);
  }
  if (it.sold && (it.status === 'sold' || it.status === 'paid') && it.sold.channel !== 'cash') {
    extras.push(`<button type="button" class="btn btn-ghost" data-action="extra" data-kind="shipped">${it.shipped ? 'Изменить отправку' : 'Отправил (дата, трек)'}</button>`);
  }
  if (it.status === 'have' || it.status === 'listed') {
    extras.push('<button type="button" class="btn btn-ghost" data-action="extra" data-kind="writeoff">Списать: не продано / лом</button>');
  }
  if (it.sold && (it.status === 'sold' || it.status === 'paid')) {
    extras.push('<button type="button" class="btn btn-soft" data-action="return-open" data-testid="return-open">Покупатель вернул вещь — снова на склад</button>');
  }
  const returnedBack = it.status === 'have' && L.hasReturns(it);
  const canBack = (si > 0 || it.status === 'writeoff') && (returnedBack || !(it.status === 'have' && it.have && it.have.lotId));
  if (canBack) extras.push(`<button type="button" class="btn btn-ghost" data-action="step-back" data-testid="step-back">${it.status === 'writeoff' ? 'Отменить списание' : returnedBack ? 'Отменить возврат вещи' : 'Вернуть шаг назад'}</button>`);
  if (lot && L.canUndoLot(state, lot)) extras.push(`<button type="button" class="btn btn-warn" data-action="undo-lot" data-lot="${esc(lot.id)}">Отменить покупку лота (${esc(lot.itemIds.length)} вещ. за ${fm(lot.total)})</button>`);
  if (!lot) extras.push('<button type="button" class="btn btn-warn" data-action="delete-item">Удалить вещь</button>');
  const lotNote = lot ? `<p class="note" data-testid="lot-note">Вещь из лота за ${fm(lot.total)} (${esc(lot.itemIds.length)} вещ.): доли цены посчитаны вместе, поэтому цену, дату и удаление по одной вещи не меняем.${L.canUndoLot(state, lot) ? ' Ошибка в лоте — «Отменить покупку лота» и записать заново.' : ''}</p>` : '';
  root.innerHTML = `
    <div class="screen">
      <button type="button" class="btn btn-ghost back" data-action="back">← Склад</button>
      <h1 data-testid="item-title">${esc(it.title)}</h1>
      <p><span class="st ${ST_CLASS[it.status] || ''}" data-testid="item-status">${esc(L.statusLabel(it))}</span> <span class="note">${esc(catName(it.categoryId))}</span></p>
      ${payHtml}
      ${sale ? `<div class="kpis">
        <div class="kpi"><span>Продажа</span><b>${fm(sale.gross)}</b><i>с доставкой</i></div>
        <div class="kpi"><span>Чистыми</span><b data-testid="sale-net">${sale.net === null ? '—' : (sale.feesEstimated ? '≈ ' : '') + fm(sale.net)}</b><i>${sale.net === null ? esc(sale.incomplete) + ' — введите в «Изменить»' : sale.feesEstimated ? 'комиссия по % категории' : 'по введённой комиссии'}</i></div>
      </div>` : ''}
      ${pastSalesHtml(it)}
      ${it.writeoff ? `<div class="card warnbox" data-testid="writeoff"><b>${esc(L.WRITEOFF_KINDS[it.writeoff.kind])}</b> ${fd(it.writeoff.date)}${it.writeoff.note ? ' · ' + esc(it.writeoff.note) : ''}<span class="note">Себестоимость ${fm(L.basisOf(it.have))} остаётся в учёте как убыток.</span></div>` : ''}
      ${ev ? `<details class="card more"><summary>Оценка ${fd(day(ev.at))}: ${esc(ev.result.title)}</summary>
        <p>Чистыми по оценке: <b>${ev.result.net === null ? '—' : fm(ev.result.net)}</b> · STR ${ev.result.str === null ? '—' : esc(L.fmtPct(ev.result.str))} · потолок ${ev.result.maxOffer === null ? '—' : fm(ev.result.maxOffer, { cents: false })}</p>
        <ul class="reasons">${ev.result.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${ev.result.warnings.length ? `<ul class="reasons">${ev.result.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <p class="note">Введено: медиана ${esc(ev.input.median || '—')}, продано за 90 дн. ${esc(ev.input.sold90 || '—')}, активных ${esc(ev.input.active || '—')}, доставка: ${esc(L.SHIP_MODES[ev.input.shipMode] || 'не выбрана')}.</p>
      </details>` : ''}
      <div class="card">
        <h3>Путь вещи</h3>
        <ol class="timeline">${steps.map(([s, name, d], i) => `<li class="${i <= si ? 'done' : ''}"><div class="t-h">${esc(name)}</div>${i <= si && d ? `<div class="t-d">${d}</div>` : ''}${editable(s, i) ? `<button type="button" class="link" data-action="edit-step" data-step="${esc(s)}">${esc(editLabel(s))}</button>` : ''}</li>`).join('')}</ol>
      </div>
      ${next ? `<button type="button" class="btn btn-main btn-big" data-action="next-step" data-testid="next-step">${esc(next)}</button>` : ''}
      ${lotNote}
      <div class="actions">${extras.join('')}</div>
    </div>`;
}

function stepFormHtml(it, step, editing) {
  const d = (editing ? it[step] : null) || {};
  const val = (v) => (v === null || v === undefined ? '' : esc(v));
  const today = L.todayLocal();
  const date = `<label class="field"><span class="lbl">Дата</span><input type="date" name="date" value="${esc(d.date || today)}"></label>`;
  const evIn = (it.eval && it.eval.input) || {};
  const money = (name, label, value, hint = '') => `<label class="field"><span class="lbl">${label}${hint ? ` <i>${hint}</i>` : ''}</span><input name="${name}" inputmode="decimal" value="${value}"></label>`;
  const txt = (name, label, value, max, hint = '') => `<label class="field"><span class="lbl">${label}${hint ? ` <i>${hint}</i>` : ''}</span><input name="${name}" type="text" maxlength="${max}" value="${value}"></label>`;
  let body = '';
  if (step === 'have' && editing && it.have && it.have.lotId) {
    body = `<p class="note">Вещь из лота: цена, дата и происхождение посчитаны вместе с другими вещами лота. Здесь меняются только SKU и место хранения.</p>
      ${txt('sku', 'SKU', val(d.sku), 40)}
      ${txt('location', 'Где лежит (полка / коробка)', val(d.location), 80)}`;
  } else if (step === 'have') {
    const origin = d.origin || it.origin || 'bought';
    const price = editing ? val(d.buyPrice) : origin === 'bought' ? esc(evIn.buyPrice || '') : '';
    const sku = editing ? val(d.sku) : esc(L.nextSku(state.items));
    body = `
      <div class="seg" role="radiogroup" aria-label="Откуда вещь" style="grid-template-columns:1fr">
        ${Object.entries(L.ORIGINS).map(([k, name]) => `<label><input type="radio" name="origin" value="${esc(k)}" ${origin === k ? 'checked' : ''}><span>${esc(name)}</span></label>`).join('')}
      </div>
      <label class="field" data-origin="bought own_stock"><span class="lbl">Заплатил за вещь, $ <i data-origin="own_stock">(свой запас: пусто = $0)</i></span><input name="buyPrice" inputmode="decimal" value="${price}"></label>
      ${date}
      ${tripPickHtml(d.date || today, d.tripId || null, d.miles ? String(d.miles) : '', 'вещью')}
      <details class="card more"><summary>Подробнее: где купил, налог, SKU, полка <i>(по желанию)</i></summary>
        <div data-origin="bought own_stock" class="sheet-body">
          ${txt('place', 'Где купил', val(d.place), 100, '(адрес или «гаражная распродажа»)')}
          ${txt('seller', 'Продавец', val(d.seller), 100, '(имя или «estate sale»)')}
          ${money('salesTax', 'Налог с покупки, $', val(d.salesTax || ''), '(пусто = $0)')}
          ${money('buyerPremium', 'Комиссия аукциона (buyer\'s premium), $', val(d.buyerPremium || ''), '(пусто = $0)')}
          ${money('freight', 'Доставка вещи до меня, $', val(d.freight || ''), '(пусто = $0)')}
          <p class="note">Себестоимость для налогов = цена + налог + комиссия аукциона + доставка до вас.</p>
        </div>
        ${txt('sku', 'SKU (номер на наклейке)', sku, 40)}
        ${txt('location', 'Где лежит (полка / коробка)', val(d.location), 80)}
      </details>`;
  } else if (step === 'listed') {
    body = `${date}${money('price', 'Цена в объявлении, $', editing ? val(d.price) : esc(evIn.median || ''), '(по желанию)')}
      <p class="note">Объявление публикуете сами в приложении eBay или Seller Hub.</p>`;
  } else if (step === 'sold') {
    const listedPrice = it.listed && it.listed.price !== null ? it.listed.price : '';
    const ship = editing ? val(d.shipCharged) : evIn.shipMode === 'buyer' ? esc(evIn.shipCharged || '') : evIn.shipMode === 'free' || evIn.shipMode === 'pickup' ? '0' : '';
    const label = editing ? val(d.label) : evIn.shipMode === 'pickup' ? '0' : esc(evIn.label || '');
    const ch = d.channel || 'ebay';
    const fb = (editing && d.feesByType) || {};
    const fv = (k) => (editing ? val(fb[k]) : '');
    body = `${date}
      <label class="field"><span class="lbl">Где продал</span><select name="channel">${Object.entries(L.CHANNELS).map(([k, nm]) => `<option value="${esc(k)}" ${ch === k ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></label>
      ${money('price', 'Цена продажи, $', editing ? val(d.price) : esc(listedPrice))}
      <div data-ch="ebay marketplace offerup" class="sheet-body">
        ${money('shipCharged', 'Доставка с покупателя, $', ship, '(0 — если бесплатная)')}
        ${money('label', 'Этикетка, $', label, '(пусто = ещё не знаю)')}
        <div class="card fees-box">
          <h3>Комиссии по видам</h3>
          <p class="note" data-ch="ebay">Пусто во всех полях — посчитаем по % категории (≈).</p>
          <label class="field"><span class="lbl">Комиссия площадки (final value fee), $ <i data-ch="marketplace offerup">(0 — если встречались лично)</i></span><input name="feeFinal" inputmode="decimal" value="${fv('finalValue')}"></label>
          <div class="row2">
            ${money('feeOrder', 'За заказ, $', fv('perOrder'))}
            ${money('feeAds', 'Реклама, $', fv('ads'))}
          </div>
          ${money('feeOther', 'Прочие сборы, $', fv('other'))}
          <p class="note" data-testid="fee-sum" data-fee-sum></p>
          ${editing && d.feesCombined ? '<p class="note warn">В старой записи комиссия введена одной суммой — она в поле «Комиссия площадки». Можно разнести по видам.</p>' : ''}
        </div>
      </div>
      <p class="note warn" data-ch="cash">Наличные при встрече: деньги на руках сразу, шага «Деньги пришли» не будет. Seller's permit и налог с продаж${srcLink({ sourceUrl: L.SELLERS_PERMIT.sourceUrl })}</p>
      <details class="card more"><summary>Ещё по продаже <i>(по желанию)</i></summary>
        <div data-ch="ebay marketplace offerup" class="sheet-body">
          ${money('taxCollected', 'Налог с продаж, удержала площадка, $', editing ? val(d.taxCollected) : '', '(это не ваш доход)')}
        </div>
        ${money('packaging', 'Упаковка, $', editing ? val(d.packaging || '') : esc(evIn.packaging || ''), '(пусто = $0)')}
        ${money('refund', 'Вернул деньги покупателю (refund), $', editing ? val(d.refund || '') : '', '(вещь осталась у него; пусто = $0)')}
        <label class="field"><span class="lbl">Когда вернул деньги <i>(для возврата: в учёт идёт в этот год)</i></span><input type="date" name="refundDate" value="${esc((editing && (d.refundDate || (d.refund ? d.date : ''))) || today)}"></label>
        <p class="note">Покупатель вернул саму вещь — кнопка «Покупатель вернул вещь» в карточке.</p>
      </details>`;
  } else if (step === 'paid') {
    body = `<p class="note">Дата, когда деньги реально пришли на счёт (выплата eBay — Payouts).</p>${date}
      ${money('amount', 'Сумма выплаты, $', editing ? val(d.amount) : '', '(по желанию)')}
      <details class="card more"><summary>Для сверки выплат <i>(по желанию)</i></summary>
        ${txt('payoutId', 'ID выплаты (из eBay → Payouts)', editing ? val(d.payoutId) : '', 80)}
        ${money('withheld', 'Удержания, $', editing ? val(d.withheld) : '', '(пусто = нет)')}
      </details>`;
  }
  return `<form id="step-form" data-step="${esc(step)}" data-editing="${editing ? 1 : 0}" novalidate>
      <div class="sheet-body">${body}<div class="form-errors"></div>
      <button type="submit" class="btn btn-main btn-big">${editing ? 'Сохранить' : 'Готово'}</button></div></form>`;
}

function extraFormHtml(it, kind) {
  const today = L.todayLocal();
  const cur = it[kind] || {};
  const date = `<label class="field"><span class="lbl">Дата</span><input type="date" name="date" value="${esc(cur.date || today)}"></label>`;
  const seg = (name, opts, sel) => `<div class="seg" role="radiogroup" style="grid-template-columns:1fr">${Object.entries(opts).map(([k, nm]) => `<label><input type="radio" name="${name}" value="${esc(k)}" ${sel === k ? 'checked' : ''}><span>${esc(nm)}</span></label>`).join('')}</div>`;
  let body = '';
  if (kind === 'checked') {
    body = `${seg('result', L.CHECK_RESULTS, cur.result)}${date}
      <label class="field"><span class="lbl">Как проверял, что заметил <i>(по желанию)</i></span><input name="note" type="text" maxlength="300" value="${esc(cur.note || '')}"></label>`;
  } else if (kind === 'shipped') {
    body = `${date}<label class="field"><span class="lbl">Трек-номер <i>(по желанию)</i></span><input name="tracking" type="text" maxlength="60" value="${esc(cur.tracking || '')}"></label>`;
  } else if (kind === 'writeoff') {
    body = `${seg('kind', L.WRITEOFF_KINDS, cur.kind)}${date}
      <label class="field"><span class="lbl">Заметка <i>(по желанию)</i></span><input name="note" type="text" maxlength="300" value="${esc(cur.note || '')}"></label>
      <p class="note">Себестоимость списанной вещи остаётся в учёте (это убыток). Списание можно отменить.</p>`;
  }
  return `<form id="extra-form" data-kind="${esc(kind)}" novalidate><div class="sheet-body">${body}<div class="form-errors"></div>
    <button type="submit" class="btn btn-main btn-big">Сохранить</button></div></form>`;
}

const EXTRA_TITLE = { checked: 'Проверка вещи', shipped: 'Отправка', writeoff: 'Списать вещь' };

function syncOriginFields(formEl) {
  const o = (formEl.querySelector('input[name=origin]:checked') || {}).value;
  $$('[data-origin]', formEl).forEach((el) => { el.hidden = !el.dataset.origin.split(' ').includes(o); });
}
function syncChannelFields(formEl) {
  const sel = formEl.querySelector('select[name=channel]');
  if (!sel) return;
  $$('[data-ch]', formEl).forEach((el) => { el.hidden = !el.dataset.ch.split(' ').includes(sel.value); });
}

// Поездка за покупкой/лотом: если в журнале уже есть поездка за этот день — её можно выбрать (мили второй раз
// не вводятся, двойного счёта нет). Сама форма выбирает поездку, только если за день ровно одна поездка с целью
// «распродажа» или «забрать купленное» и мили ещё не введены; поездку на почту, за коробками или на склад
// за покупку молча не выдаёт — по умолчанию поле «мили» открыто.
function tripPickHtml(date, sel, miles, what) {
  const trips = L.tripsOnDate(state, date);
  const milesField = (hidden) => `<label class="field" data-pick-new ${hidden ? 'hidden' : ''}><span class="lbl">Мили за ${esc(what)} <i>(по желанию, туда и обратно)</i></span><input name="miles" inputmode="decimal" value="${esc(miles)}" placeholder="пусто = не ездил"></label>`;
  if (!trips.length) return `<div data-trip-pick data-date="${esc(date)}">${milesField(false)}</div>`;
  const forBuy = trips.filter((t) => L.PURCHASE_TRIP_KINDS.includes(t.kind));
  const pick = sel && trips.some((t) => t.id === sel) ? sel : !miles && forBuy.length === 1 ? forBuy[0].id : 'new';
  return `<div data-trip-pick data-date="${esc(date)}" class="field">
    <span class="lbl">Поездка за ${esc(what)}</span>
    <div class="seg" role="radiogroup" aria-label="Поездка" style="grid-template-columns:1fr">
      <label><input type="radio" name="tripPick" value="new" ${pick === 'new' ? 'checked' : ''}><span>Отдельная поездка — ввести мили</span></label>
      ${trips.map((t) => `<label><input type="radio" name="tripPick" value="${esc(t.id)}" ${pick === t.id ? 'checked' : ''}><span>Эта поездка из журнала: ${milesTxt(t.miles)} · ${esc(L.TRIP_KINDS[t.kind] || '')}${t.to ? ' · ' + esc(t.to) : ''}</span></label>`).join('')}
    </div>
    ${milesField(pick !== 'new')}
    <p class="note">Поездка из журнала второй раз не считается.</p>
  </div>`;
}

function syncTripPick(f, what) {
  const box = f.querySelector('[data-trip-pick]');
  const dateEl = f.querySelector('input[name=date]');
  if (!box || !dateEl) return;
  if (box.dataset.date !== dateEl.value) {
    const m = box.querySelector('input[name=miles]');
    box.outerHTML = tripPickHtml(dateEl.value, null, m ? m.value : '', what);
    return;
  }
  const picked = box.querySelector('input[name=tripPick]:checked');
  const nb = box.querySelector('[data-pick-new]');
  if (nb && picked) nb.hidden = picked.value !== 'new';
}

// Итог комиссий по видам — прямо в форме продажи.
function syncFeeSum(f) {
  const out = f.querySelector('[data-fee-sum]');
  if (!out) return;
  const v = (n) => L.parseNumber(f.elements.namedItem(n).value, L.NUM.money);
  const parts = ['feeFinal', 'feeOrder', 'feeAds', 'feeOther'].map(v);
  if (parts.some((p) => p.error)) { out.textContent = 'Итого комиссий: проверьте числа'; return; }
  const known = [parts[0], parts[1], parts[3]].some((p) => p.value !== null);
  const sum = parts.reduce((a, p) => a + (p.value || 0), 0);
  out.textContent = known ? `Итого комиссий: ${L.fmtMoney(Math.round(sum * 100) / 100)}` : `Итого комиссий: ≈ по % категории${parts[2].value ? ` + реклама ${L.fmtMoney(parts[2].value)}` : ''}`;
}

function openStepForm(it, step, editing) {
  openSheet(editing ? `Изменить: ${STEP_TITLE[step]}` : STEP_TITLE[step], stepFormHtml(it, step, editing));
  const f = $('#step-form');
  if (step === 'have' && f.querySelector('input[name=origin]')) {
    syncOriginFields(f);
    f.addEventListener('change', () => { syncOriginFields(f); syncTripPick(f, 'вещью'); });
  }
  if (step === 'sold') {
    syncChannelFields(f);
    syncFeeSum(f);
    f.addEventListener('change', () => syncChannelFields(f));
    f.addEventListener('input', () => syncFeeSum(f));
  }
}

function replaceItem(newItem) {
  state = { ...state, items: state.items.map((x) => (x.id === newItem.id ? newItem : x)) };
  persist();
}

function submitStepForm(f) {
  const it = state.items.find((x) => x.id === ui.itemId);
  if (!it) return closeSheet();
  const raw = formValues(f);
  const step = f.dataset.step;
  const res = f.dataset.editing === '1' ? L.editStep(it, step, raw, eff()) : L.advance(it, raw, eff());
  if (!res.ok) return setFieldErrors(f, res.errors);
  replaceItem(res.item);
  closeSheet();
  renderStock();
  toastText(L.statusLabel(res.item), 2500);
}

function submitExtraForm(f) {
  const it = state.items.find((x) => x.id === ui.itemId);
  if (!it) return closeSheet();
  const raw = formValues(f);
  const fn = { checked: L.markChecked, shipped: L.markShipped, writeoff: L.writeOff }[f.dataset.kind];
  if (!fn) return closeSheet();
  const res = fn(it, raw);
  if (!res.ok) return setFieldErrors(f, res.errors);
  replaceItem(res.item);
  closeSheet();
  renderStock();
  toastText('Сохранено', 2000);
}

// ---------- лот ----------
function lotFormHtml() {
  const evals = state.items.filter((it) => it.status === 'evaluated');
  return `<form id="lot-form" novalidate><div class="sheet-body">
    <p class="note">Цена лота делится по вещам пропорционально вашей оценке каждой вещи (до цента) — это себестоимость для налогов.</p>
    <label class="field"><span class="lbl">Заплатил за весь лот, $ <i>(всё вместе: цена, налог, комиссия аукциона)</i></span><input name="total" inputmode="decimal"></label>
    <label class="field"><span class="lbl">Дата</span><input type="date" name="date" value="${esc(L.todayLocal())}"></label>
    ${tripPickHtml(L.todayLocal(), null, '', 'лотом')}
    <div class="row2">
      <label class="field"><span class="lbl">Где купил <i>(по желанию)</i></span><input name="place" type="text" maxlength="100"></label>
      <label class="field"><span class="lbl">Продавец <i>(по желанию)</i></span><input name="seller" type="text" maxlength="100"></label>
    </div>
    ${evals.length ? `<h3>Вещи из оценённых</h3>${evals.map((it) => {
      const w = it.eval ? L.parseNumber(it.eval.input.median, L.NUM.money).value : null;
      return `<div class="lot-row" data-item="${esc(it.id)}">
        <label class="check"><input type="checkbox" name="pick"><span>${esc(it.title)}</span></label>
        <label class="field"><span class="lbl">оценка, $</span><input name="w" inputmode="decimal" value="${esc(w ?? '')}"></label><span class="alloc"></span></div>`;
    }).join('')}` : ''}
    <h3>Новые вещи в лоте</h3>
    <div id="lot-new"></div>
    <button type="button" class="btn btn-ghost" data-action="lot-add-row">+ ещё вещь</button>
    <label class="field"><span class="lbl">Категория для новых вещей</span><select name="categoryId">${state.settings.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
    <div class="form-errors"></div>
    <button type="submit" class="btn btn-main btn-big">Записать покупку лота</button>
  </div></form>`;
}

function lotNewRowHtml() {
  return `<div class="lot-row new"><label class="field"><span class="lbl">что за вещь</span><input name="nt" type="text" maxlength="200"></label>
    <label class="field"><span class="lbl">оценка, $</span><input name="nw" inputmode="decimal"></label><span class="alloc"></span></div>`;
}

function readLotForm(f) {
  const entries = [];
  const rows = [];
  $$('.lot-row[data-item]', f).forEach((row) => {
    if (row.querySelector('[name=pick]').checked) { entries.push({ itemId: row.dataset.item, weight: row.querySelector('[name=w]').value }); rows.push(row); }
  });
  $$('#lot-new .lot-row', f).forEach((row) => {
    const title = row.querySelector('[name=nt]').value;
    if (title.trim()) { entries.push({ title, weight: row.querySelector('[name=nw]').value }); rows.push(row); }
  });
  const v = (nm) => f.elements.namedItem(nm).value;
  const tp = f.querySelector('input[name=tripPick]:checked');
  return { raw: { total: v('total'), date: v('date'), miles: v('miles'), tripPick: tp ? tp.value : '', place: v('place'), seller: v('seller'), categoryId: v('categoryId'), entries }, rows };
}

function previewLot(f) {
  const { raw, rows } = readLotForm(f);
  $$('.alloc', f).forEach((a) => { a.textContent = ''; });
  const res = L.applyLot(state, raw);
  if (res.ok) rows.forEach((row, i) => { row.querySelector('.alloc').textContent = `→ себестоимость ${L.fmtMoney(res.lot.allocations[i])}`; });
}

function submitLot(f) {
  const { raw } = readLotForm(f);
  const res = L.applyLot(state, raw);
  if (!res.ok) {
    const errs = { ...res.errors };
    const shown = {};
    for (const k of ['total', 'date', 'miles', 'tripPick']) if (errs[k]) shown[k] = errs[k];
    const rest = Object.entries(errs).filter(([k]) => !(k in shown)).map(([, v]) => v);
    setFieldErrors(f, shown);
    if (rest.length) { const p = document.createElement('p'); p.className = 'err'; p.textContent = [...new Set(rest)].join('; '); f.querySelector('.form-errors').appendChild(p); }
    return;
  }
  state = res.state;
  persist();
  closeSheet();
  renderStock();
  toastText(`Лот записан: ${res.lot.itemIds.length} вещ. за ${L.fmtMoney(res.lot.total)}`);
}


// ---------- экран «Учёт»: поездки, расходы, сводка за год, реестр правил (ТЗ M4) ----------
const thisYear = () => Number(L.todayLocal().slice(0, 4));
// «не проверено» — цифра не сверена (или изменена вами); «пора перепроверить» — прошла дата следующей проверки.
const CHECK_TEXT = { unverified: 'не проверено', stale: 'пора перепроверить' };
const unvChip = (rule) => {
  if (!rule) return '';
  const st = L.ruleCheckState(rule);
  return CHECK_TEXT[st] ? ` <span class="unv" data-check="${st}">${CHECK_TEXT[st]}</span>` : '';
};
const unvChips = (rules) => [...new Set((rules || []).map((r) => L.ruleCheckState(r)))].filter((st) => CHECK_TEXT[st]).map((st) => ` <span class="unv" data-check="${st}">${CHECK_TEXT[st]}</span>`).join('');
const srcLink = (rule) => (rule && /^https:\/\//.test(rule.sourceUrl) ? ` <a class="src" href="${esc(rule.sourceUrl)}" target="_blank" rel="noopener noreferrer">источник</a>` : '');
const fmtMiles = (m) => esc(String(Math.round(m * 10) / 10));
// «1 миля», «3 мили», «12 миль», «12.5 мили»
const milesWord = (m) => {
  const v = Math.round(m * 10) / 10;
  if (!Number.isInteger(v)) return 'мили';
  const a = v % 100, b = v % 10;
  return a >= 11 && a <= 14 ? 'миль' : b === 1 ? 'миля' : b >= 2 && b <= 4 ? 'мили' : 'миль';
};
const milesTxt = (m) => `${fmtMiles(m)} ${milesWord(m)}`;
const RULE_ORDER = ['mile_rate', 'k1099_min_gross', 'k1099_min_count', 'sd_sales_tax'];

function renderLedger() {
  const root = $('#ledger-root');
  try {
    renderLedgerInner(root);
  } catch (e) {
    root.innerHTML = errorCard('Учёт', e);
  }
}

// Частые поездки (последние разные «куда + зачем + мили») — повторить одним нажатием.
function recentTrips() {
  const seen = new Set();
  const out = [];
  for (const t of state.trips || []) {
    const k = `${t.to}|${t.kind}|${t.miles}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

function renderLedgerInner(root) {
  const years = LG.ledgerYears(state);
  if (!ui.ledgerYear || !years.includes(ui.ledgerYear)) ui.ledgerYear = years.includes(thisYear()) ? thisYear() : years[0];
  const Y = ui.ledgerYear;
  const inY = (d) => d.slice(0, 4) === String(Y);
  const rows = L.tripRows(state).filter((r) => inY(r.date));
  const exps = (state.expenses || []).filter((x) => inY(x.date)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  // сумма — по каждой ставке от суммы миль (как в сводке), а не из округлённых поездок
  const mg = L.mileageGroups(rows);
  const miles = mg.miles;
  const milesAmt = mg.amount;
  const expSum = exps.reduce((a, x) => a + x.amount, 0);
  const today = L.mileRateFor(state.taxRules, L.todayLocal());
  const recent = recentTrips();
  // ставка за милю, потом 1099-K, потом налог; внутри — новые периоды первыми
  const per = (r) => r.validFrom || String(r.taxYear);
  const rules = [...state.taxRules].sort((a, b) => (RULE_ORDER.indexOf(a.key) - RULE_ORDER.indexOf(b.key)) || (per(a) < per(b) ? 1 : per(a) > per(b) ? -1 : 0));
  root.innerHTML = `
    <div class="screen">
      <h1>Учёт для налогов</h1>
      <div class="quick">
        <button type="button" class="btn btn-main btn-big" data-action="trip-new" data-testid="trip-new">+ Поездка</button>
        <button type="button" class="btn btn-soft btn-big" data-action="exp-new" data-testid="exp-new">+ Расход</button>
      </div>
      ${recent.length ? `<div class="chips" role="group" aria-label="Повторить поездку">${recent.map((t) => `<button type="button" class="chip" data-action="trip-repeat" data-id="${esc(t.id)}">↻ ${esc(t.to || L.TRIP_KINDS[t.kind])} · ${milesTxt(t.miles)}</button>`).join('')}</div>` : ''}
      <p class="note">Ставка сегодня: <b>${today ? esc(L.fmtRuleValue(today.rule)) : 'нет в реестре правил'}</b>${unvChip(today && today.rule)}${srcLink(today && today.rule)}</p>
      <div class="chips" role="group" aria-label="Год">
        ${years.map((y) => `<button type="button" class="chip" data-action="ledger-year" data-year="${esc(y)}" aria-pressed="${y === Y}">${esc(y)}</button>`).join('')}
      </div>
      <div class="sum-grid">
        <div class="sum"><span>Мили за ${esc(Y)}</span><b data-testid="l-miles">${fmtMiles(miles)}</b><i>${fm(milesAmt)} по ставке на дату</i></div>
        <div class="sum"><span>Расходы за ${esc(Y)}</span><b data-testid="l-exp">${fm(expSum)}</b><i>записей: ${esc(exps.length)}</i></div>
      </div>
      <button type="button" class="btn btn-main btn-wide" data-action="summary" data-testid="summary-btn">Сводка за ${esc(Y)} год</button>
      <div id="summary-box">${ui.summaryYear === Y ? summaryHtml(LG.yearSummary(state, Y)) : ''}</div>
      <details class="card more" data-sec="trips" ${ui.ledgerFocus === 'trips' ? 'open' : ''}><summary>Поездки за ${esc(Y)} · ${esc(rows.length)}</summary>
        ${rows.length ? `<ul class="items" data-testid="trips">${rows.map(tripRowHtml).join('')}</ul>` : '<p class="empty">Поездок нет.</p>'}
      </details>
      <details class="card more" data-sec="exps" ${ui.ledgerFocus === 'exps' ? 'open' : ''}><summary>Расходы за ${esc(Y)} · ${esc(exps.length)}</summary>
        ${exps.length ? `<ul class="items" data-testid="exps">${exps.map(expRowHtml).join('')}</ul>` : '<p class="empty">Расходов нет.</p>'}
      </details>
      <details class="card more" id="rules" data-sec="rules" ${ui.ledgerFocus === 'rules' ? 'open' : ''}><summary>Реестр правил (цифры для налогов)</summary>
        ${rules.some((r) => L.ruleCheckState(r) !== 'verified') ? '<p class="note">«Не проверено» — цифра ещё не сверена с официальным источником. «Пора перепроверить» — прошла дата следующей проверки.</p>' : ''}
        ${legacyHtml()}
        <div class="rules" data-testid="rules">${rules.map(ruleHtml).join('')}</div>
        <button type="button" class="btn btn-soft" data-action="rule-new">+ Добавить правило (новый год, новая ставка)</button>
      </details>
    </div>`;
  if (ui.ledgerFocus) {
    const el = root.querySelector(`[data-sec="${CSS.escape(ui.ledgerFocus)}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
  }
}

// Свои цифры из прошлой версии (ставка за милю, порог 1099-K) в реестр не переносятся: реестр сверен
// с первоисточниками. Показываем их, чтобы Георгий сам решил, нужно ли своё правило.
function legacyHtml() {
  const lg = L.legacyCustomRules(state.meta);
  if (!lg) return '';
  const parts = [];
  if (lg.mileRate !== undefined) parts.push(`ставка за милю $${esc(lg.mileRate)}`);
  if (lg.k1099) parts.push(`порог 1099-K ${fm(lg.k1099.minGross, { cents: false })} и ${esc(lg.k1099.minCount)} сделок`);
  return `<p class="note warn" data-testid="rules-legacy">В прошлой версии программы у вас было: ${parts.join(', ')}. В реестр не перенесено — здесь цифры, сверенные с официальным источником. Нужна своя — «+ Добавить правило».</p>`;
}

function tripRowHtml(r) {
  const src = r.src === 'trip'
    ? (r.links.length ? `<div class="item-pay">с покупкой: ${r.links.map((x) => esc(x.title)).join(', ')}</div>` : '')
    : `<div class="item-pay">записано ${r.src === 'lot' ? 'при покупке лота' : 'при покупке'} — изменить в «Складе»</div>`;
  const act = r.src === 'trip' ? `data-action="trip-edit" data-id="${esc(r.id)}"` : r.src === 'item' ? `data-action="open-item" data-id="${esc(r.id)}"` : `data-action="open-lot-item" data-id="${esc(r.id)}"`;
  return `<li><button type="button" class="item" ${act}>
    <div class="item-top"><span class="item-title">${milesTxt(r.miles)} · ${r.amount === null ? 'ставка неизвестна' : fm(r.amount)}</span><span class="st">${fd(r.date)}</span></div>
    <div class="item-meta">${esc(L.TRIP_KINDS[r.kind] || '')}${r.to ? ' · ' + esc(r.to) : ''}${r.purpose && r.src === 'trip' ? ' · ' + esc(r.purpose) : r.src !== 'trip' ? ' · ' + esc(r.purpose) : ''}</div>
    ${src}
  </button></li>`;
}

function expRowHtml(x) {
  return `<li><button type="button" class="item" data-action="exp-edit" data-id="${esc(x.id)}">
    <div class="item-top"><span class="item-title">${fm(x.amount)} · ${esc(L.EXPENSE_CATEGORIES[x.category])}</span><span class="st">${fd(x.date)}</span></div>
    ${x.note || x.receipt ? `<div class="item-meta">${esc(x.note)}${x.note && x.receipt ? ' · ' : ''}${x.receipt ? 'чек: ' + esc(x.receipt) : ''}</div>` : ''}
  </button></li>`;
}

const RULE_ST = { verified: ['st-paid', 'проверено'], stale: ['st-sold', 'пора перепроверить'], unverified: ['st-sold', 'не проверено'] };

// Своё правило рядом с правилом программы на тот же период: где действует какое.
function overlapHtml(r) {
  return L.ruleOverlaps(state.taxRules, r).map((o) => (o.wins === 'user'
    ? `<p class="note warn" data-testid="rule-override">Действует вместо правила программы ${esc(L.rulePeriod(o.builtin))}: ${esc(L.fmtRuleValue(o.builtin))}${unvChip(o.builtin) || ' (проверено)'}</p>`
    : `<p class="note">На ${esc(L.rulePeriod(o.builtin))} действует правило программы: ${esc(L.fmtRuleValue(o.builtin))}</p>`)).join('');
}

function ruleHtml(r) {
  const meta = L.RULE_KEYS[r.key];
  const unit = { rate: '$ за милю', money: '$', count: 'сделок', pct: '%' }[meta.unit];
  const [stCls, stTxt] = RULE_ST[L.ruleCheckState(r)];
  return `<div class="rule card" data-rule="${esc(r.id)}">
    <div class="rule-h"><b>${esc(meta.name)}</b> <span class="st ${stCls}" data-check="${esc(L.ruleCheckState(r))}">${esc(stTxt)}</span></div>
    <p class="note">${esc(L.rulePeriod(r))} · проверено: ${r.verifiedAt ? fd(r.verifiedAt) : '—'} · следующая проверка: ${r.nextCheck ? fd(r.nextCheck) : '—'}${srcLink(r)}</p>
    ${overlapHtml(r)}
    <label class="field"><span class="lbl">Значение, ${esc(unit)}</span><input data-rule-id="${esc(r.id)}" inputmode="decimal" value="${esc(L.ruleInputValue(r))}"></label>
    <p class="err" data-rule-err="${esc(r.id)}" hidden></p>
    ${r.edited ? `<p class="note">Изменено вами.</p><button type="button" class="btn btn-ghost" data-action="rule-reset" data-id="${esc(r.id)}">Вернуть значение программы</button>` : ''}
    ${!r.builtin ? `<p class="note">${esc(r.note || 'добавлено вами')}</p><button type="button" class="btn btn-warn" data-action="rule-del" data-id="${esc(r.id)}">Удалить правило</button>` : ''}
  </div>`;
}

// Сводка за год: цифры по разделам; правила — с пометкой «не проверено» и ссылкой на источник.
function summaryHtml(S) {
  const tr = (name, v, cls = '') => `<tr class="${cls}"><td>${name}</td><td>${v}</td></tr>`;
  const neg = (v) => (v ? '−' + fm(v) : fm(0));
  const ch = S.income.channels.map((c) => tr(`${esc(L.CHANNELS[c.channel])} · ${esc(c.count)} шт.`, fm(c.gross))).join('');
  const f = S.salesCosts.fees;
  const exp = S.expenses.byCategory.filter((c) => c.amount).map((c) => tr(esc(L.EXPENSE_CATEGORIES[c.category]), neg(c.amount))).join('');
  // у каждой ставки — свои пометки и ссылка на источник (ставок за год может быть две: смена с 1 июля)
  const rates = S.mileage.byRate.map((g) => tr(`<span data-testid="s-rate">${milesTxt(g.miles)} × $${esc(g.rate)}${unvChips(g.rules)}${srcLink(g.rules[0])}</span>`, neg(g.amount))).join('');
  const kr = S.k1099Rule;
  const ct = S.cashTax;
  const cash = ct.count ? `<h3>Наличные (свои продажи)</h3>
    <table class="smeta">
      ${tr(`Продано за наличные · ${esc(ct.count)} шт.`, fm(ct.gross))}
      ${ct.groups.map((g) => tr(`<span data-testid="s-cashtax">Налог с продаж ≈ ${esc(L.fmtRuleValue(g.rule))} · Сан-Диего${unvChip(g.rule)}${srcLink(g.rule)}</span>`, '≈ ' + fm(g.tax))).join('')}
      ${ct.unknownGross ? tr('Без ставки налога в реестре', fm(ct.unknownGross)) : ''}
    </table>
    <p class="note">Seller's permit для продаж за наличные${srcLink({ sourceUrl: L.SELLERS_PERMIT.sourceUrl })}</p>` : '';
  const k = S.k1099.map((x) => `<p class="num" data-testid="s-k1099-${esc(x.channel)}">${esc(L.CHANNELS[x.channel])}: <b>${fm(x.gross)}</b> · сделок: <b>${esc(x.count)}</b>${x.overThreshold === null ? '' : x.overThreshold ? ' — <b>порог превышен</b>' : ' — порог не превышен'}</p>`).join('');
  const warn = S.warnings.length ? `<div class="card warnbox" data-testid="s-warnings"><ul class="reasons">${S.warnings.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul>
      ${S.mileage.mismatch || S.mileage.unknown.count ? '<button type="button" class="btn btn-ghost" data-action="reapply">Пересчитать мили по реестру</button>' : ''}</div>` : '';
  return `<div class="card sumcard" data-testid="summary" data-year="${esc(S.year)}">
    <h2>Сводка за ${esc(S.year)}</h2>
    <h3>Доходы</h3>
    <table class="smeta">${ch || tr('Продаж нет', fm(0))}
      ${S.income.refunds ? tr('Возвраты покупателям', neg(S.income.refunds)) : ''}
      ${tr('Продажи за год', `<span data-testid="s-income">${fm(S.income.net)}</span>`, 'total')}
      ${S.income.personal.count ? tr(`из них свои вещи · ${esc(S.income.personal.count)} шт.`, fm(S.income.personal.gross)) : ''}
      ${S.income.taxCollected ? tr('Налог, удержанный площадкой (не доход)', fm(S.income.taxCollected)) : ''}
    </table>
    ${cash}
    <h3>Себестоимость</h3>
    <table class="smeta">
      ${tr(`Проданного · ${esc(S.cogs.soldCount)} шт.`, neg(S.cogs.sold))}
      ${S.cogs.writeoffCount ? tr(`Списано (не продано / лом) · ${esc(S.cogs.writeoffCount)} шт.`, neg(S.cogs.writeoff)) : ''}
      ${S.cogs.returnedCount ? tr(`Вернулись на склад после продажи · ${esc(S.cogs.returnedCount)} шт.`, `<span data-testid="s-cogs-returned">+${fm(S.cogs.returned)}</span>`) : ''}
      ${tr('Себестоимость всего', `<span data-testid="s-cogs">${neg(S.cogs.total)}</span>`, 'total')}
    </table>
    <h3>Комиссии и доставка</h3>
    <table class="smeta">
      ${tr('Комиссия площадки (final value fee)', neg(f.finalValue))}
      ${tr('Фикс. сбор за заказ', neg(f.perOrder))}
      ${tr('Реклама', neg(f.ads))}
      ${tr('Прочие сборы', neg(f.other))}
      ${f.estimated ? tr(`≈ по % категории · ${esc(S.salesCosts.feesEstimatedCount)} шт.`, '≈ ' + neg(f.estimated)) : ''}
      ${tr('Этикетки', neg(S.salesCosts.labels))}
      ${S.salesCosts.packaging ? tr('Упаковка (в продажах)', neg(S.salesCosts.packaging)) : ''}
      ${S.salesCosts.returnShipping ? tr('Обратная доставка при возвратах', neg(S.salesCosts.returnShipping)) : ''}
      ${S.salesCosts.feeCredits ? tr('Комиссию вернула площадка', '+' + fm(S.salesCosts.feeCredits)) : ''}
      ${tr('Всего', `<span data-testid="s-salecosts">${neg(S.salesCosts.total)}</span>`, 'total')}
    </table>
    <h3>Расходы</h3>
    <table class="smeta">${exp}${tr('Расходы всего', `<span data-testid="s-expenses">${neg(S.expenses.total)}</span>`, 'total')}</table>
    <h3>Мили</h3>
    <table class="smeta">${rates}
      ${S.mileage.unknown.count ? tr(`${milesTxt(S.mileage.unknown.miles)} без ставки`, '—') : ''}
      ${tr(`Всего ${milesTxt(S.mileage.miles)}`, `<span data-testid="s-miles">${neg(S.mileage.amount)}</span>`, 'total')}
    </table>
    <table class="smeta"><tr class="total big"><td>Прибыль по этим цифрам${S.approx ? ' ≈' : ''}</td><td data-testid="s-profit">${fm(S.profit)}</td></tr></table>
    <h3>1099-K${kr ? unvChips(kr.rules) + srcLink(kr.rules[0]) : ''}</h3>
    <p class="note">${kr ? `Порог: больше ${fm(kr.minGross, { cents: false })} и больше ${esc(kr.minCount)} сделок.` : `Порога на ${esc(S.year)} год нет в реестре.`}</p>
    ${k}
    ${warn}
    <details class="card more"><summary>Склад для бухгалтера</summary>
      <table class="smeta">
        ${tr('На 1 января (себестоимость)', fm(S.inventory.begin))}
        ${tr(`Куплено за год · ${esc(S.inventory.purchasesCount)} шт.`, fm(S.inventory.purchases))}
        ${tr('На 31 декабря (себестоимость)', fm(S.inventory.end))}
      </table>
    </details>
    <button type="button" class="btn btn-main btn-big" data-action="csv" data-year="${esc(S.year)}" data-testid="csv-btn">Скачать CSV для бухгалтера</button>
    ${canShareCsv() ? `<button type="button" class="btn btn-soft" data-action="csv-share" data-year="${esc(S.year)}">Отправить CSV (почта, Telegram…)</button>` : ''}
  </div>`;
}

function canShareCsv() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.csv', { type: 'text/csv' })] }));
  } catch {
    return false;
  }
}

function downloadCsv(year) {
  const text = LG.summaryCsv(state, year);
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = LG.csvFileName(year);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toastText(`CSV за ${year} сохранён`);
}

async function shareCsv(year) {
  const file = new File([LG.summaryCsv(state, year)], LG.csvFileName(year), { type: 'text/csv' });
  try { await navigator.share({ files: [file], title: `Перекуп: учёт за ${year}` }); } catch { /* закрыли окно */ }
}

function tripFormHtml(t) {
  const editing = !!t;
  const last = (state.trips || [])[0] || null;
  const d = t || { date: L.todayLocal(), from: last ? last.from : '', to: '', kind: last ? last.kind : 'source', purpose: '', miles: '' };
  const tos = [...new Set((state.trips || []).map((x) => x.to).filter(Boolean))].slice(0, 20);
  return `<form id="trip-form" data-id="${esc(editing ? t.id : '')}" novalidate><div class="sheet-body">
    <div class="miles-row">
      <label class="field"><span class="lbl">Мили (туда и обратно)</span><input name="miles" inputmode="decimal" enterkeyhint="done" value="${esc(d.miles)}" placeholder="12"></label>
      <button type="submit" class="btn btn-main" data-testid="trip-save-top">Сохранить</button>
    </div>
    <div class="field"><span class="lbl">Зачем ездили</span>
      <div class="seg" role="radiogroup" aria-label="Зачем ездили">${Object.entries(L.TRIP_KINDS).map(([k, nm]) => `<label><input type="radio" name="kind" value="${esc(k)}" ${d.kind === k ? 'checked' : ''}><span>${esc(nm)}</span></label>`).join('')}</div>
    </div>
    <label class="field"><span class="lbl">Куда <i>(по желанию)</i></span><input name="to" type="text" maxlength="100" list="trip-to-list" value="${esc(d.to)}" placeholder="например Father Joe's"></label>
    <datalist id="trip-to-list">${tos.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>
    <details class="card more" ${editing ? 'open' : ''}><summary>Дата, откуда, заметка</summary>
      <label class="field"><span class="lbl">Дата</span><input type="date" name="date" value="${esc(d.date)}"></label>
      <label class="field"><span class="lbl">Откуда <i>(по желанию)</i></span><input name="from" type="text" maxlength="100" value="${esc(d.from)}" placeholder="например дом"></label>
      <label class="field"><span class="lbl">Заметка <i>(по желанию)</i></span><input name="purpose" type="text" maxlength="200" value="${esc(d.purpose)}" placeholder="например аукцион, купил 2 платы"></label>
    </details>
    <p class="note" data-trip-rate data-testid="trip-rate"></p>
    <p class="note warn" data-trip-dup hidden></p>
    <div class="form-errors"></div>
    ${editing ? '<button type="button" class="btn btn-warn" data-action="trip-del">Удалить поездку</button>' : ''}
    <div class="sheet-foot"><button type="submit" class="btn btn-main btn-big">Сохранить поездку</button></div>
  </div></form>`;
}

// Ставка на дату поездки и сумма — прямо в форме; подсказка, если в этот день мили уже записаны при покупке.
function syncTripForm(f) {
  const date = f.elements.namedItem('date').value;
  const m = L.parseNumber(f.elements.namedItem('miles').value, L.NUM.miles).value;
  const r = L.mileRateFor(state.taxRules, date);
  const out = f.querySelector('[data-trip-rate]');
  if (!L.isDate(date)) out.textContent = 'Укажите дату.';
  else if (!r) out.innerHTML = `Ставки на ${fd(date)} нет в реестре правил — поездка запишется, сумма будет неизвестна.`;
  else out.innerHTML = `Ставка на ${fd(date)}: <b>${esc(L.fmtRuleValue(r.rule))}</b>${unvChip(r.rule)}${m ? ` · ${milesTxt(m)} = <b>${fm(L.mileAmount(m, r.value))}</b>` : ''}`;
  const dup = L.purchaseMilesOnDate(state, date);
  const box = f.querySelector('[data-trip-dup]');
  box.hidden = !dup.length;
  if (dup.length) box.textContent = `За ${L.fmtDate(date)} уже записано при покупке: ${dup.map((x) => `${x.miles} ${milesWord(x.miles)} (${x.purpose})`).join('; ')}. Если это та же поездка — второй раз не записывайте.`;
}

function openTripForm(t, prefill) {
  openSheet(t ? 'Изменить поездку' : 'Поездка', tripFormHtml(t));
  const f = $('#trip-form');
  if (prefill) {
    f.elements.namedItem('miles').value = String(prefill.miles);
    f.elements.namedItem('to').value = prefill.to;
    f.elements.namedItem('from').value = prefill.from;
    const k = f.querySelector(`input[name=kind][value="${CSS.escape(prefill.kind)}"]`);
    if (k) k.checked = true;
  }
  syncTripForm(f);
  f.addEventListener('input', () => syncTripForm(f));
  f.addEventListener('change', () => syncTripForm(f));
  // новая поездка: сразу поле миль (клавиатура открывается тем же нажатием «+ Поездка»), «Сохранить» — рядом с ним,
  // над клавиатурой, а не внизу шторки под ней
  if (!t && !prefill) {
    const m = f.elements.namedItem('miles');
    try { m.focus({ preventScroll: true }); } catch { m.focus(); }
  }
}

function submitTripForm(f) {
  const raw = formValues(f);
  const id = f.dataset.id;
  const res = id ? L.updateTrip(state, id, raw) : L.addTrip(state, raw);
  if (!res.ok) return setFieldErrors(f, res.errors);
  state = res.state;
  persist();
  askPersist();
  closeSheet();
  ui.ledgerYear = Number(res.trip.date.slice(0, 4));
  renderLedger();
  toastText(`Поездка записана: ${res.trip.miles} ${milesWord(res.trip.miles)}${res.trip.rateUsed === null ? ' (ставки на эту дату нет в реестре)' : ' = ' + L.fmtMoney(L.mileAmount(res.trip.miles, res.trip.rateUsed))}`);
}

function expFormHtml(x) {
  const editing = !!x;
  const last = (state.expenses || [])[0] || null;
  const d = x || { date: L.todayLocal(), category: last ? last.category : '', amount: '', note: '', receipt: '' };
  return `<form id="exp-form" data-id="${esc(editing ? x.id : '')}" novalidate><div class="sheet-body">
    <label class="field"><span class="lbl">Сумма, $</span><input name="amount" inputmode="decimal" value="${esc(d.amount)}" placeholder="например 15.50"></label>
    <div class="field"><span class="lbl">На что</span>
      <div class="seg" role="radiogroup" aria-label="На что">${Object.entries(L.EXPENSE_CATEGORIES).map(([k, nm]) => `<label><input type="radio" name="category" value="${esc(k)}" ${d.category === k ? 'checked' : ''}><span>${esc(nm)}</span></label>`).join('')}</div>
    </div>
    <label class="field"><span class="lbl">Дата</span><input type="date" name="date" value="${esc(d.date)}"></label>
    <label class="field"><span class="lbl">Что купил <i>(по желанию)</i></span><input name="note" type="text" maxlength="200" value="${esc(d.note)}" placeholder="например 20 коробок, Home Depot"></label>
    <label class="field"><span class="lbl">Чек <i>(по желанию)</i></span><input name="receipt" type="text" maxlength="200" value="${esc(d.receipt)}" placeholder="где лежит бумажный чек / «без чека»"></label>
    <p class="note">Фото чеков пока нет — запишите, где лежит бумажный чек.</p>
    <div class="form-errors"></div>
    ${editing ? '<button type="button" class="btn btn-warn" data-action="exp-del">Удалить расход</button>' : ''}
    <div class="sheet-foot"><button type="submit" class="btn btn-main btn-big">Сохранить расход</button></div>
  </div></form>`;
}

function submitExpForm(f) {
  const raw = formValues(f);
  const id = f.dataset.id;
  const res = id ? L.updateExpense(state, id, raw) : L.addExpense(state, raw);
  if (!res.ok) return setFieldErrors(f, res.errors);
  state = res.state;
  persist();
  askPersist();
  closeSheet();
  ui.ledgerYear = Number(res.expense.date.slice(0, 4));
  renderLedger();
  toastText(`Расход записан: ${L.fmtMoney(res.expense.amount)} · ${L.EXPENSE_CATEGORIES[res.expense.category]}`);
}

function ruleFormHtml() {
  return `<form id="rule-form" novalidate><div class="sheet-body">
    <label class="field"><span class="lbl">Какое правило</span><select name="key">${Object.entries(L.RULE_KEYS).map(([k, m]) => `<option value="${esc(k)}">${esc(m.name)}</option>`).join('')}</select></label>
    <label class="field"><span class="lbl">Значение <i data-rk="mile_rate">($ за милю, например 0.76)</i><i data-rk="k1099_min_gross">($)</i><i data-rk="k1099_min_count">(сделок)</i><i data-rk="sd_sales_tax">(%, например 7.75)</i></span><input name="value" inputmode="decimal"></label>
    <div class="row2" data-rk="mile_rate sd_sales_tax">
      <label class="field"><span class="lbl">С даты</span><input type="date" name="validFrom"></label>
      <label class="field"><span class="lbl">По дату <i>(пусто — без конца)</i></span><input type="date" name="validTo"></label>
    </div>
    <label class="field" data-rk="k1099_min_gross k1099_min_count"><span class="lbl">Налоговый год</span><input name="taxYear" inputmode="numeric" value="${esc(thisYear() + 1)}"></label>
    <label class="field"><span class="lbl">Ссылка на официальный источник <i>(https://…)</i></span><input name="sourceUrl" type="url" maxlength="300" placeholder="https://www.irs.gov/…"></label>
    <p class="note">Новое правило — «не проверено».</p>
    <div class="form-errors"></div>
    <button type="submit" class="btn btn-main btn-big">Добавить правило</button>
  </div></form>`;
}

function syncRuleForm(f) {
  const k = f.elements.namedItem('key').value;
  $$('[data-rk]', f).forEach((el) => { el.hidden = !el.dataset.rk.split(' ').includes(k); });
}

function submitRuleForm(f) {
  const res = L.addRule(state, formValues(f));
  if (!res.ok) return setFieldErrors(f, res.errors);
  state = res.state;
  persist();
  closeSheet();
  ui.ledgerFocus = 'rules';
  renderLedger();
  const over = L.ruleOverlaps(state.taxRules, res.rule).filter((o) => o.wins === 'user').length;
  toastText(over ? `Правило добавлено («не проверено») — действует вместо правила программы: ${over}` : 'Правило добавлено («не проверено»)', over ? 6000 : 4000);
}

function onRuleChange(el) {
  const res = L.setRuleValue(state, el.dataset.ruleId, el.value);
  const err = $(`[data-rule-err="${CSS.escape(el.dataset.ruleId)}"]`);
  if (!res.ok) {
    if (err) { err.textContent = res.error; err.hidden = false; }
    return;
  }
  if (err) err.hidden = true;
  if (!res.changed) return;
  state = res.state;
  persist();
  ui.ledgerFocus = 'rules';
  renderLedger();
  toastText('Значение правила сохранено («не проверено»)');
}

// ---------- экран «Настройки» ----------
const pct = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 10000) / 100));

function catFieldsHtml(c) {
  const f = (key, label, value, mode) => `<label class="field"><span class="lbl">${esc(label)}</span><input data-cat="${esc(c.id)}" data-key="${esc(key)}" data-mode="${esc(mode)}" ${mode === 'text' ? 'type="text" maxlength="120"' : 'inputmode="decimal"'} value="${esc(value)}"></label>`;
  return `
    ${f('name', 'Название', c.name, 'text')}
    ${f('ebayName', 'Категория eBay (по-английски)', c.ebayName || '', 'text')}
    <div class="row3">
      ${f('feePct', 'Комиссия eBay, %', pct(c.feePct), 'pct')}
      ${f('perOrderFee', 'За заказ, $', c.perOrderFee, 'money')}
      ${f('minNet', 'Мин. прибыль, $', c.minNet, 'money')}
      ${f('minSold90', 'Мин. продаж за 90 дн.', c.minSold90, 'int')}
      ${f('minStr', 'Мин. спрос STR, % (пусто — не проверять)', pct(c.minStr), 'pctnull')}
      <span></span>
      ${f('buyCeilingLow', 'Потолок покупки от медианы: осторожный, %', pct(c.buyCeilingLow), 'pct')}
      ${f('buyCeilingHigh', 'Потолок покупки: максимум, %', pct(c.buyCeilingHigh), 'pct')}
    </div>
    <p class="err" data-cat-err="${esc(c.id)}" hidden></p>
    ${state.settings.categories.length > 1 ? `<button type="button" class="btn btn-ghost" data-action="del-cat" data-id="${esc(c.id)}">Удалить категорию</button>` : ''}`;
}

const catSummary = (c) => `<span>${esc(c.name)}</span><small>${esc(pct(c.feePct))}% · от ${fm(c.minNet, { cents: false })} · ${esc(pct(c.buyCeilingLow))}–${esc(pct(c.buyCeilingHigh))}%</small>`;

function renderSettings() {
  const root = $('#settings-root');
  try {
    renderSettingsInner(root);
  } catch (e) {
    root.innerHTML = errorCard('Настройки', e);
  }
}

function renderSettingsInner(root) {
  const s = state.settings;
  const es = eff();
  const swOk = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  root.innerHTML = `
    <div class="screen">
      <h1>Настройки</h1>
      <div class="card">
        <h2>Категории и пороги</h2>
        <p class="note">Стартовые значения из ТЗ: комиссия 13,6% + $0,40, прибыль от $25, от 5 продаж за 90 дней. Меняйте по своему опыту.</p>
        ${s.categories.map((c) => `<details class="cat"><summary>${catSummary(c)}</summary><div class="cat-body">${catFieldsHtml(c)}</div></details>`).join('')}
        <button type="button" class="btn btn-soft" data-action="add-cat">+ Добавить категорию</button>
      </div>
      <div class="card">
        <h2>Общие</h2>
        <div class="note" data-testid="rules-derived">
          <p>Ставка за милю сегодня: <b>${es.mileRate === null ? 'нет в реестре' : esc(L.fmtRuleValue(es.mileRateRule))}</b>${unvChip(es.mileRateRule)}${srcLink(es.mileRateRule)}</p>
          <p>Порог 1099-K на ${esc(L.todayLocal().slice(0, 4))}: <b>${es.k1099 ? `больше ${fm(es.k1099.minGross, { cents: false })} и больше ${esc(es.k1099.minCount)} сделок` : 'нет в реестре'}</b>${es.k1099Rules ? unvChips(es.k1099Rules) + srcLink(es.k1099Rules[0]) : ''}</p>
          <p>Эти цифры берутся из реестра правил.</p>
        </div>
        <a class="btn btn-ghost" href="#ledger/rules" data-testid="open-rules">Реестр правил (ставка за милю, 1099-K)</a>
        <label class="field"><span class="lbl">Налог покупателя для комиссии eBay, % <i>(примерно)</i></span><input data-set="buyerTaxPct" data-mode="pct" inputmode="decimal" value="${esc(pct(s.buyerTaxPct))}"></label>
        <label class="field"><span class="lbl">Оценка срока выплаты — после скольких своих выплат</span><input data-set="payoutEstimateMinN" data-mode="int1" inputmode="numeric" value="${esc(s.payoutEstimateMinN)}"></label>
        <label class="field"><span class="lbl">«Подозрительно дёшево» — если просят меньше, % от медианы</span><input data-set="cheapFlagPct" data-mode="pct" inputmode="decimal" value="${esc(pct(s.cheapFlagPct))}"></label>
        <p class="err" id="set-err" hidden></p>
      </div>
      <div class="card">
        <h2>Копия данных</h2>
        <p class="note">Всё хранится только на этом телефоне, в браузере. iPhone может стереть данные сайта, если долго не открывать, — делайте копию раз в неделю и держите файл в «Файлах» или iCloud.</p>
        <p>Последняя копия: <b data-testid="last-export">${state.meta.lastExportAt ? fd(day(state.meta.lastExportAt)) : 'ещё не делали'}</b></p>
        <button type="button" class="btn btn-main" data-action="export">Сохранить копию (файл)</button>
        ${canShareFiles() ? '<button type="button" class="btn btn-soft" data-action="share-export">Отправить копию (в «Файлы», себе в Telegram…)</button>' : ''}
        <label class="btn btn-ghost" for="import-file">Загрузить копию из файла</label>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <p class="note">Загружайте только свои копии. Испорченный или чужой файл программа не примет и ваши данные не тронет.</p>
      </div>
      <div class="card">
        <h2>Сброс</h2>
        <button type="button" class="btn btn-warn" data-action="reset">Стереть все данные на телефоне</button>
      </div>
      <div class="card">
        <h2>Правила программы</h2>
        <ul class="reasons">
          <li>Цены проданных вводите сами из приложения eBay (Sold / Terapeak). Программа не открывает сайты и ничего не скачивает.</li>
          <li>Решение «брать / не брать» считает код по формулам ТЗ. Если данных не хватает — честно пишет «недостаточно данных».</li>
          <li>Нет сервера, нет регистрации, ничего не отправляется. Покупки и объявления — только вы сами.</li>
        </ul>
        <p class="note">Работа без интернета: ${swOk ? '<b>готово</b>' : 'включится после первого открытия с интернетом'}. Хранилище: ${realStorage ? 'память браузера' : '<b>недоступно — данные не сохранятся!</b>'}.</p>
      </div>
    </div>`;
}

const SETTING_PRESET = { money: L.NUM.money, rate: L.NUM.rate, int: L.NUM.count, int1: L.NUM.count, pct: L.NUM.pct, pctnull: L.NUM.pct };

function parseSetting(mode, raw) {
  const r = L.parseNumber(raw, SETTING_PRESET[mode] || L.NUM.money);
  if (r.error) return { error: r.error };
  if (r.value === null) return mode === 'pctnull' ? { value: null } : { error: 'нужно значение' };
  if (mode === 'int1' && r.value < 1) return { error: 'не меньше 1' };
  return { value: mode === 'pct' || mode === 'pctnull' ? Math.round(r.value * 100) / 10000 : r.value };
}

function onSettingsChange(e) {
  const el = e.target;
  if (el.dataset.cat) {
    const c = state.settings.categories.find((x) => x.id === el.dataset.cat);
    if (!c) return;
    let value;
    if (el.dataset.mode === 'text') value = el.value.trim();
    else {
      const p = parseSetting(el.dataset.mode, el.value);
      if (p.error) return showCatErr(c.id, p.error);
      value = p.value;
    }
    const upd = { ...c, [el.dataset.key]: value };
    const errs = L.validateCategory(upd);
    if (errs.length) return showCatErr(c.id, errs.join('; '));
    showCatErr(c.id, '');
    state = { ...state, settings: { ...state.settings, categories: state.settings.categories.map((x) => (x.id === c.id ? upd : x)) } };
    persist();
    el.closest('details').querySelector('summary').innerHTML = catSummary(upd);
    return;
  }
  if (el.dataset.set) {
    const p = parseSetting(el.dataset.mode, el.value);
    const err = $('#set-err');
    if (p.error) { err.textContent = p.error; err.hidden = false; return; }
    const s = { ...state.settings, [el.dataset.set]: p.value };
    const errs = L.validateSettings(s);
    if (errs.length) { err.textContent = errs.join('; '); err.hidden = false; return; }
    err.hidden = true;
    state = { ...state, settings: s };
    persist();
  }
  if (el.id === 'import-file' && el.files && el.files[0]) importFile(el.files[0]);
}

function showCatErr(id, msg) {
  const p = $(`[data-cat-err="${CSS.escape(id)}"]`);
  if (!p) return;
  p.textContent = msg;
  p.hidden = !msg;
}

function exportData() {
  const now = new Date();
  state = { ...state, meta: { ...state.meta, lastExportAt: now.toISOString() } };
  const text = L.exportBackup(state, now);
  persist();
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `perekup-kopiya-${L.todayLocal(now)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  renderSettings();
  toastText('Копия сохранена в файл');
}

function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));
  } catch {
    return false;
  }
}

async function shareExport() {
  const now = new Date();
  const next = { ...state, meta: { ...state.meta, lastExportAt: now.toISOString() } };
  const file = new File([L.exportBackup(next, now)], `perekup-kopiya-${L.todayLocal(now)}.json`, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'Перекуп: копия данных' });
    state = next;
    persist();
    renderSettings();
  } catch { /* пользователь закрыл окно — ничего не меняем */ }
}

function importFile(file) {
  if (file.size > 20_000_000) { $('#import-file').value = ''; return toastText('Файл слишком большой — это не копия «Перекупа».', 6000); }
  const reader = new FileReader();
  reader.onload = () => {
    const res = L.parseBackup(String(reader.result));
    $('#import-file').value = '';
    if (!res.ok) return toastText(res.error, 9000);
    const when = res.exportedAt ? L.fmtDate(day(res.exportedAt)) : 'неизвестно';
    if (!confirm(`Заменить данные на копию от ${when}?\nСейчас вещей: ${state.items.length}, поездок: ${(state.trips || []).length}, расходов: ${(state.expenses || []).length}.\nВ копии вещей: ${res.state.items.length}, поездок: ${res.state.trips.length}, расходов: ${res.state.expenses.length}.`)) return;
    state = res.state;
    persist();
    fillCategorySelect();
    renderSettings();
    ui.ledgerYear = null;
    ui.summaryYear = null;
    toastText(`Копия загружена: ${state.items.length} вещ.${res.fromVersion < L.SCHEMA_VERSION ? ' (из прошлой версии программы)' : ''}`);
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Стереть все вещи, поездки, расходы и настройки на этом телефоне (и запасные копии в памяти)?\nОтменить нельзя. Сначала сохраните копию в файл.')) return;
  // «стереть все» — и запасную копию данных среза 1 под старым ключом, и отложенные испорченные копии
  L.wipeStorage(storage);
  state = L.defaultState();
  persist();
  clearDraft();
  writeForm(null);
  fillCategorySelect();
  renderSettings();
  toastText('Все данные стёрты');
}

// ---------- события ----------
form.addEventListener('input', onEvalInput);
form.addEventListener('change', onEvalInput);
form.addEventListener('submit', (e) => e.preventDefault());

const currentItem = () => state.items.find((x) => x.id === ui.itemId);

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'own-item') {
    const on = form.dataset.own !== '1';
    form.dataset.own = on ? '1' : '0';
    form.elements.namedItem('buyPrice').value = on ? '0' : '';
    onEvalInput({ target: {} });
  } else if (act === 'label-same') {
    form.elements.namedItem('label').value = form.elements.namedItem('shipCharged').value;
    onEvalInput({ target: {} });
  } else if (act === 'save-eval') saveEval('take');
  else if (act === 'pass-eval') saveEval('pass');
  else if (act === 'clear-eval') {
    if (!L.isEvalEmpty(readForm()) && !confirm('Очистить форму без записи в журнал?')) return;
    resetEvalForm();
  } else if (act === 'to-result') $('#eval-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (act === 'open-item') { $('#toast').hidden = true; go('stock/' + a.dataset.id); }
  else if (act === 'back') go('stock');
  else if (act === 'filter') { ui.filter = a.dataset.filter; renderStock(); }
  else if (act === 'next-step') {
    const it = currentItem();
    if (it && L.nextStep(it)) openStepForm(it, L.nextStep(it), false);
  } else if (act === 'edit-step') {
    const it = currentItem();
    if (it) openStepForm(it, a.dataset.step, true);
  } else if (act === 'extra') {
    const it = currentItem();
    if (it && EXTRA_TITLE[a.dataset.kind]) openSheet(EXTRA_TITLE[a.dataset.kind], extraFormHtml(it, a.dataset.kind));
  } else if (act === 'step-back') {
    const it = currentItem();
    if (!it || !confirm(stepBackMsg(it))) return;
    const res = L.stepBackInState(state, it.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    renderStock();
    if (res.keptTrip) toastText(`Поездка за покупкой (${res.keptTrip.miles} ${milesWord(res.keptTrip.miles)}) перенесена в журнал поездок`, 5000);
  } else if (act === 'return-open') {
    const it = currentItem();
    if (it && it.sold) openSheet('Покупатель вернул вещь', returnFormHtml(it));
  } else if (act === 'undo-lot') {
    const lot = (state.lots || []).find((l) => l.id === a.dataset.lot);
    const lotTrip = lot && lot.miles > 0 ? `\nПоездка за лотом (${lot.miles} ${milesWord(lot.miles)}) перейдёт в журнал поездок.` : '';
    if (!lot || !confirm(`Отменить покупку лота за ${L.fmtMoney(lot.total)}?\nВещи, оценённые до лота, снова станут «оценены», новые вещи лота удалятся.${lotTrip}`)) return;
    const res = L.undoLot(state, lot.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    go('stock');
    toastText(res.keptTrip ? 'Покупка лота отменена, поездка перенесена в журнал поездок' : 'Покупка лота отменена', 5000);
  } else if (act === 'delete-item') {
    const it = currentItem();
    if (!it || !confirm(`Удалить «${it.title}»? Отменить нельзя.${tripKeptNote(it)}`)) return;
    const res = L.deleteItem(state, it.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    go('stock');
    if (res.keptTrip) toastText('Вещь удалена, поездка за покупкой перенесена в журнал поездок', 5000);
  } else if (act === 'close-sheet') closeSheet();
  else if (act === 'open-lot') {
    openSheet('Покупка лота', lotFormHtml());
    const f = $('#lot-form');
    $('#lot-new').insertAdjacentHTML('beforeend', lotNewRowHtml());
    f.addEventListener('input', () => previewLot(f));
    f.addEventListener('change', () => { syncTripPick(f, 'лотом'); previewLot(f); });
  } else if (act === 'lot-add-row') { $('#lot-new').insertAdjacentHTML('beforeend', lotNewRowHtml()); }
  else if (act === 'add-cat') {
    const c = { id: L.newId(), name: 'Новая категория', ebayName: '', feePct: 0.136, perOrderFee: 0.4, minNet: 25, minSold90: 5, minStr: null, buyCeilingLow: 0.25, buyCeilingHigh: 0.35 };
    state = { ...state, settings: { ...state.settings, categories: [...state.settings.categories, c] } };
    persist();
    renderSettings();
    const last = $$('#settings-root details.cat').pop();
    if (last) last.open = true;
  } else if (act === 'del-cat') {
    const c = state.settings.categories.find((x) => x.id === a.dataset.id);
    if (!c || !confirm(`Удалить категорию «${c.name}»? Сохранённые вещи останутся с её параметрами на момент оценки.`)) return;
    state = { ...state, settings: { ...state.settings, categories: state.settings.categories.filter((x) => x.id !== c.id) } };
    persist();
    renderSettings();
  } else if (act === 'trip-new') openTripForm(null);
  else if (act === 'trip-repeat') {
    const t = (state.trips || []).find((x) => x.id === a.dataset.id);
    if (t) openTripForm(null, { miles: t.miles, to: t.to, from: t.from, kind: t.kind });
  } else if (act === 'trip-edit') {
    const t = (state.trips || []).find((x) => x.id === a.dataset.id);
    if (t) openTripForm(t);
  } else if (act === 'trip-del') {
    const id = $('#trip-form') && $('#trip-form').dataset.id;
    const links = id ? L.tripLinks(state, id) : [];
    if (!id || !confirm(`Удалить поездку?${links.length ? `\nОна привязана к покупке: ${links.map((x) => x.title).join(', ')}.` : ''}`)) return;
    const res = L.deleteTrip(state, id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    closeSheet();
    renderLedger();
    toastText('Поездка удалена');
  } else if (act === 'exp-new') {
    openSheet('Расход', expFormHtml(null));
  } else if (act === 'exp-edit') {
    const x = (state.expenses || []).find((e) => e.id === a.dataset.id);
    if (x) openSheet('Изменить расход', expFormHtml(x));
  } else if (act === 'exp-del') {
    const id = $('#exp-form') && $('#exp-form').dataset.id;
    if (!id || !confirm('Удалить расход?')) return;
    const res = L.deleteExpense(state, id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    closeSheet();
    renderLedger();
    toastText('Расход удалён');
  } else if (act === 'ledger-year') {
    ui.ledgerYear = Number(a.dataset.year);
    if (ui.summaryYear !== null) ui.summaryYear = ui.ledgerYear;
    ui.ledgerFocus = null;
    renderLedger();
  } else if (act === 'summary') {
    ui.summaryYear = ui.ledgerYear;
    ui.ledgerFocus = null;
    renderLedger();
    const box = $('#summary-box');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'csv') downloadCsv(Number(a.dataset.year));
  else if (act === 'csv-share') shareCsv(Number(a.dataset.year));
  else if (act === 'reapply') {
    const res = L.reapplyRates(state);
    state = res.state;
    persist();
    renderLedger();
    toastText(res.changed ? `Ставка обновлена у поездок: ${res.changed}` : 'Нечего пересчитывать: на эти даты ставок в реестре нет');
  } else if (act === 'rule-new') {
    openSheet('Новое правило', ruleFormHtml());
    const f = $('#rule-form');
    syncRuleForm(f);
    f.addEventListener('change', () => syncRuleForm(f));
  } else if (act === 'rule-reset') {
    const res = L.resetRule(state, a.dataset.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    ui.ledgerFocus = 'rules';
    renderLedger();
  } else if (act === 'rule-del') {
    if (!confirm('Удалить ваше правило?')) return;
    const res = L.deleteRule(state, a.dataset.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    ui.ledgerFocus = 'rules';
    renderLedger();
  } else if (act === 'open-lot-item') {
    const lot = (state.lots || []).find((l) => l.id === a.dataset.id);
    if (lot && lot.itemIds.length) go('stock/' + lot.itemIds[0]);
  } else if (act === 'export') exportData();
  else if (act === 'share-export') shareExport();
  else if (act === 'reset') resetAll();
  else if (act === 'reload') location.reload();
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'step-form') { e.preventDefault(); submitStepForm(e.target); }
  if (e.target.id === 'extra-form') { e.preventDefault(); submitExtraForm(e.target); }
  if (e.target.id === 'return-form') { e.preventDefault(); submitReturnForm(e.target); }
  if (e.target.id === 'lot-form') { e.preventDefault(); submitLot(e.target); }
  if (e.target.id === 'trip-form') { e.preventDefault(); submitTripForm(e.target); }
  if (e.target.id === 'exp-form') { e.preventDefault(); submitExpForm(e.target); }
  if (e.target.id === 'rule-form') { e.preventDefault(); submitRuleForm(e.target); }
});

$('#settings-root').addEventListener('change', onSettingsChange);
$('#ledger-root').addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.ruleId) onRuleChange(e.target); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
window.addEventListener('hashchange', route);

// другая вкладка изменила данные
window.addEventListener('storage', (e) => {
  if (e.key === L.LEGACY_STORAGE_KEY) {
    syncFromLegacy();
    route();
    return;
  }
  if (e.key !== L.STORAGE_KEY) return;
  const l = L.loadState(storage);
  setAsideBroken(l);
  state = l.state;
  savedItems = state.items;
  route();
});

function netStatus() { $('#net-badge').hidden = navigator.onLine !== false; }
window.addEventListener('online', netStatus);
window.addEventListener('offline', netStatus);

// ---------- офлайн (service worker) ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showBanner('Есть новая версия программы.', 'info', '<button type="button" class="btn btn-main" data-action="reload">Обновить</button>');
  });
}

// ---------- старт ----------
// Данные среза 1 переведены в версию 2 — сразу сохраняем под новым ключом (старый ключ не трогаем), даже если
// часть записей испорчена: их полный текст остаётся под старым ключом. Испорченные данные версии 2 после того,
// как их текст отложен, тоже сразу сохраняются без плохих записей — иначе каждое открытие переводило бы
// и откладывало их заново.
if (realStorage && (loaded.migrated || (loaded.error && loaded.raw && asideOk))) persist();
if (!loaded.migrated) syncFromLegacy();
if (loaded.error) showBanner(loaded.error + ' Загрузите копию в «Настройках».');
if (!realStorage) showBanner('Память браузера недоступна (частный режим?) — данные не сохранятся. Откройте в обычном Safari.');
try {
  fillCategorySelect();
  writeForm(readDraft());
  netStatus();
  route();
} catch (e) {
  showBanner('Ошибка при запуске: ' + ((e && e.message) || e) + '. Данные не изменены.');
}
document.documentElement.dataset.ready = '1';
