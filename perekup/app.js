// «Перекуп» — интерфейс. Вся логика и формулы — в logic.js и ядре core/calc.js.
// Данные только в этом браузере (localStorage). Никаких запросов в сеть, кроме загрузки самих файлов программы.
// Правило вывода: всё, что вставляется в HTML, проходит через esc() (или берётся из закрытого списка значений).
import * as L from './logic.js';

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
const memStorage = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } };
const storage = realStorage || memStorage;

function setAsideBroken(loadedNow) {
  // Испорченные сохранённые данные не затираем молча: до первой записи откладываем их текст в отдельный ключ.
  if (loadedNow.error && loadedNow.raw) {
    try { storage.setItem(L.BROKEN_KEY_PREFIX + Date.now(), loadedNow.raw); } catch { /* места нет — останется предупреждение */ }
  }
}
const loaded = L.loadState(storage);
let state = loaded.state;
setAsideBroken(loaded);
const ui = { tab: 'eval', itemId: null, filter: 'all' };

function persist() {
  const ok = realStorage ? L.saveState(storage, state) : false;
  if (!ok) showBanner('Не получилось сохранить на телефоне (память браузера закрыта или полна). Сделайте копию в «Настройках».');
  return ok;
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

function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  const first = $('#sheet-body input:not([type=hidden]):not([type=radio]):not([type=checkbox]), #sheet-body select');
  if (first && window.matchMedia('(hover: hover)').matches) first.focus();
}
function closeSheet() {
  $('#sheet').hidden = true;
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
  ui.tab = ['eval', 'stock', 'settings'].includes(tab) ? tab : 'eval';
  ui.itemId = ui.tab === 'stock' && id ? id : null;
  $$('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== ui.tab; });
  $$('.tabs a').forEach((a) => {
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (ui.tab === 'stock') renderStock();
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
    lastResult = L.evaluate(state.settings, input);
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
  const r = L.evaluate(state.settings, input);
  const item = L.makeItem(state.settings, input, r, new Date(), decision);
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
  const kr = state.settings.k1099;
  const netNotes = [];
  if (t.net.feesEstimated) netNotes.push(`продаж с комиссией по % категории (≈): ${t.net.feesEstimated}`);
  if (t.net.incomplete) netNotes.push(`не учтены — нет цены этикетки: ${t.net.incomplete}`);
  if (t.refunds.count) netNotes.push(`возвраты учтены: ${L.fmtMoney(t.refunds.amount)}`);
  const payoutTxt = t.payout.n ? `${t.payout.medianDays} дн.` : 'неизвестно';
  const ratio = Math.max(kr.minGross > 0 ? k.gross / kr.minGross : 1, kr.minCount > 0 ? k.count / kr.minCount : 1);
  const barW = Number.isFinite(ratio) ? Math.min(100, Math.max(0, ratio * 100)) : 100;
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
        <p class="num"><b>${fm(k.gross)}</b> из ${fm(kr.minGross, { cents: false })} · <b>${esc(k.count)}</b> из ${esc(kr.minCount)} сделок</p>
        <div class="bar" aria-hidden="true"><i style="width:${barW.toFixed(1)}%"></i></div>
        <p class="note">${k.overThreshold ? '<b>Порог превышен</b> — eBay пришлёт форму 1099-K.' : 'Порог не превышен (нужно больше суммы <b>и</b> больше сделок).'} Доход учитывается в налогах в любом случае, даже без формы.</p>
        ${t.k1099.filter((x) => x.channel !== 'ebay').map((x) => `<p class="note">${esc(L.CHANNELS[x.channel])}: ${fm(x.gross)} · ${esc(x.count)} сделок${x.overThreshold ? ' — порог превышен' : ''}</p>`).join('')}
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
  if (h.miles) parts.push(`${esc(h.miles)} миль`);
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
  if (s.fees !== null && s.channel !== 'cash') parts.push(`комиссия ${fm(s.fees)}`);
  if (s.adFee) parts.push(`реклама ${fm(s.adFee)}`);
  if (s.taxCollected !== null && s.taxCollected !== undefined) parts.push(`налог удержала площадка ${fm(s.taxCollected)}`);
  if (s.refund) parts.push(`<b>возврат ${fm(s.refund)}</b>`);
  if (it.shipped) parts.push(`отправлена ${fd(it.shipped.date)}${it.shipped.tracking ? ` (трек ${esc(it.shipped.tracking)})` : ''}`);
  return parts.join(' · ');
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
    payHtml = `<div class="card payout paid" data-testid="payout"><span>Продана за наличные</span><span class="big" data-testid="payout-days">деньги на руках</span><span class="note">Местная продажа: в Калифорнии может понадобиться бесплатное разрешение продавца (seller's permit) и налог с продаж — проверьте на cdtfa.ca.gov.</span></div>`;
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
  const canBack = (si > 0 || it.status === 'writeoff') && !(it.status === 'have' && it.have && it.have.lotId);
  if (canBack) extras.push(`<button type="button" class="btn btn-ghost" data-action="step-back">${it.status === 'writeoff' ? 'Отменить списание' : 'Вернуть шаг назад'}</button>`);
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
      <label class="field"><span class="lbl">Мили за вещью <i>(по желанию)</i></span><input name="miles" inputmode="decimal" value="${val(d.miles || '')}" placeholder="пусто = не ездил"></label>
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
    body = `${date}
      <label class="field"><span class="lbl">Где продал</span><select name="channel">${Object.entries(L.CHANNELS).map(([k, nm]) => `<option value="${esc(k)}" ${ch === k ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></label>
      ${money('price', 'Цена продажи, $', editing ? val(d.price) : esc(listedPrice))}
      <div data-ch="ebay marketplace offerup" class="sheet-body">
        ${money('shipCharged', 'Доставка с покупателя, $', ship, '(0 — если бесплатная)')}
        ${money('label', 'Этикетка, $', label, '(пусто = ещё не знаю)')}
        <label class="field"><span class="lbl">Комиссия площадки, $ <i data-ch="ebay">(пусто = посчитать по % категории)</i><i data-ch="marketplace offerup">(0 — если встречались лично)</i></span><input name="fees" inputmode="decimal" value="${editing ? val(d.fees) : ''}"></label>
      </div>
      <p class="note warn" data-ch="cash">Наличные при встрече: деньги на руках сразу, шага «Деньги пришли» не будет. Местная продажа — в Калифорнии может понадобиться бесплатное разрешение продавца (seller's permit) и налог с продаж; проверьте на cdtfa.ca.gov.</p>
      <details class="card more"><summary>Ещё по продаже <i>(по желанию)</i></summary>
        <div data-ch="ebay marketplace offerup" class="sheet-body">
          ${money('adFee', 'Комиссия за рекламу (Promoted Listings), $', editing ? val(d.adFee || '') : '', '(пусто = $0)')}
          ${money('taxCollected', 'Налог с продаж, удержала площадка, $', editing ? val(d.taxCollected) : '', '(это не ваш доход)')}
        </div>
        ${money('packaging', 'Упаковка, $', editing ? val(d.packaging || '') : esc(evIn.packaging || ''), '(пусто = $0)')}
        ${money('refund', 'Возврат покупателю (refund), $', editing ? val(d.refund || '') : '', '(пусто = $0)')}
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

function openStepForm(it, step, editing) {
  openSheet(editing ? `Изменить: ${STEP_TITLE[step]}` : STEP_TITLE[step], stepFormHtml(it, step, editing));
  const f = $('#step-form');
  if (step === 'have' && f.querySelector('input[name=origin]')) { syncOriginFields(f); f.addEventListener('change', () => syncOriginFields(f)); }
  if (step === 'sold') { syncChannelFields(f); f.addEventListener('change', () => syncChannelFields(f)); }
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
  const res = f.dataset.editing === '1' ? L.editStep(it, step, raw, state.settings) : L.advance(it, raw, state.settings);
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
    <label class="field"><span class="lbl">Мили за лотом <i>(по желанию)</i></span><input name="miles" inputmode="decimal" placeholder="пусто = не ездил"></label>
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
  return { raw: { total: v('total'), date: v('date'), miles: v('miles'), place: v('place'), seller: v('seller'), categoryId: v('categoryId'), entries }, rows };
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
    for (const k of ['total', 'date', 'miles']) if (errs[k]) shown[k] = errs[k];
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
        <label class="field"><span class="lbl">Ставка за милю, $ <i>(по исследованию: 0,725 до 30.06.2026, 0,76 с 01.07.2026 — проверить на irs.gov)</i></span><input data-set="mileRate" data-mode="rate" inputmode="decimal" value="${esc(s.mileRate)}"></label>
        <label class="field"><span class="lbl">Налог покупателя для комиссии eBay, % <i>(примерно)</i></span><input data-set="buyerTaxPct" data-mode="pct" inputmode="decimal" value="${esc(pct(s.buyerTaxPct))}"></label>
        <div class="row2">
          <label class="field"><span class="lbl">1099-K: сумма больше, $</span><input data-set="k1099.minGross" data-mode="money" inputmode="decimal" value="${esc(s.k1099.minGross)}"></label>
          <label class="field"><span class="lbl">1099-K: сделок больше</span><input data-set="k1099.minCount" data-mode="int" inputmode="numeric" value="${esc(s.k1099.minCount)}"></label>
        </div>
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
    const s = { ...state.settings, k1099: { ...state.settings.k1099 } };
    const [a, b] = el.dataset.set.split('.');
    if (b) s[a][b] = p.value; else s[a] = p.value;
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
    if (!confirm(`Заменить данные на копию от ${when}?\nСейчас вещей: ${state.items.length}, в копии: ${res.state.items.length}.`)) return;
    state = res.state;
    persist();
    fillCategorySelect();
    renderSettings();
    toastText(`Копия загружена: ${state.items.length} вещ.`);
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Стереть все вещи и настройки на этом телефоне?\nОтменить нельзя. Сначала сохраните копию.')) return;
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
    const msg = it && it.status === 'writeoff' ? 'Отменить списание? Вещь вернётся на склад.' : 'Вернуть вещь на шаг назад? Данные последнего шага сотрутся.';
    if (!it || !confirm(msg)) return;
    replaceItem(L.stepBack(it));
    renderStock();
  } else if (act === 'undo-lot') {
    const lot = (state.lots || []).find((l) => l.id === a.dataset.lot);
    if (!lot || !confirm(`Отменить покупку лота за ${L.fmtMoney(lot.total)}?\nВещи, оценённые до лота, снова станут «оценены», новые вещи лота удалятся.`)) return;
    const res = L.undoLot(state, lot.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    go('stock');
    toastText('Покупка лота отменена');
  } else if (act === 'delete-item') {
    const it = currentItem();
    if (!it || !confirm(`Удалить «${it.title}»? Отменить нельзя.`)) return;
    const res = L.deleteItem(state, it.id);
    if (!res.ok) return toastText(res.error, 6000);
    state = res.state;
    persist();
    go('stock');
  } else if (act === 'close-sheet') closeSheet();
  else if (act === 'open-lot') {
    openSheet('Покупка лота', lotFormHtml());
    const f = $('#lot-form');
    $('#lot-new').insertAdjacentHTML('beforeend', lotNewRowHtml());
    f.addEventListener('input', () => previewLot(f));
    f.addEventListener('change', () => previewLot(f));
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
  } else if (act === 'export') exportData();
  else if (act === 'share-export') shareExport();
  else if (act === 'reset') resetAll();
  else if (act === 'reload') location.reload();
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'step-form') { e.preventDefault(); submitStepForm(e.target); }
  if (e.target.id === 'extra-form') { e.preventDefault(); submitExtraForm(e.target); }
  if (e.target.id === 'lot-form') { e.preventDefault(); submitLot(e.target); }
});

$('#settings-root').addEventListener('change', onSettingsChange);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
window.addEventListener('hashchange', route);

// другая вкладка изменила данные
window.addEventListener('storage', (e) => {
  if (e.key !== L.STORAGE_KEY) return;
  const l = L.loadState(storage);
  setAsideBroken(l);
  state = l.state;
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
