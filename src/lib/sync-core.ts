// Ядро синхронизации «Формана». Без импортов React Native, поэтому этот же файл
// запускает Node-тест (tests/sync.test.mjs). Приложение берёт готовый экземпляр из ./sync.ts.
//
// Модель: всё сначала пишется на устройство (offline-first), потом, если команда
// подключена, отправляется в общую базу Supabase через функции базы (RPC).
// Каждая функция базы сама проверяет пару «команда + код». Ошибки в UI не бросаются.

export type DocData = Record<string, unknown>;
export type Doc<T extends DocData = DocData> = { id: string; data: T; updatedAt: string | null };

// Хранилище «ключ → строка» (AsyncStorage в приложении, Map в тесте)
export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type Team = { space: string; code: string; name?: string };

// off — команда не подключена (данные только на устройстве)
// noconfig — в сборке нет адреса/ключа базы
// syncing — идёт обмен с базой
// ok — всё отправлено
// pending — есть неотправленные изменения
// offline — нет связи, данные сохранены на устройстве
// denied — неверный код команды
// error — база отклонила запрос (не связь и не код)
export type SyncState = 'off' | 'noconfig' | 'syncing' | 'ok' | 'pending' | 'offline' | 'denied' | 'error';

export type SyncStatus = {
  state: SyncState;
  team: { space: string; name: string } | null;
  pending: number;          // сколько документов ждут отправки
  lastSyncAt: number | null; // время последнего успешного обмена (мс)
};

export type ConnectResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'invalid' | 'denied' | 'offline' | 'noconfig' | 'error' };

export type SaveResult = { ok: boolean; synced: boolean };

export type SyncOptions = {
  url?: string;               // https://<project>.supabase.co
  key?: string;               // publishable key
  storage: KV;
  fetchFn?: typeof fetch;     // для теста: можно подменить (имитация «нет связи»)
  colPrefix?: string;         // префикс коллекций в базе, чтобы не пересекаться со «Складом»
};

// --- внутреннее ---
type Entry = { d: DocData | null; t: string | null; dirty?: 1; del?: 1; rev?: number };
type ColMap = Record<string, Entry>;
type RpcError = { kind: 'offline' | 'denied' | 'error'; status?: number; message?: string };

const K_TEAM = 'fm.team';
const K_COLS = 'fm.cols';
const kCol = (col: string) => 'fm.col.' + col;
const PAGE = 1000;
const COL_RE = /^[A-Za-z0-9_-]{1,60}$/;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// Разбор «кода команды»: ссылка …#s=<команда>&k=<код>, строка «s=…&k=…»
// или два слова «<команда> <код>». Возвращает null, если не похоже на код.
export function parseTeamCode(text: string): Team | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const sm = raw.match(/(?:^|[#?&])s=([^&#\s]+)/);
  const km = raw.match(/(?:^|[#?&])k=([^&#\s]+)/);
  if (sm || km) {
    if (!sm || !km) return null;
    try {
      const space = decodeURIComponent(sm[1]).trim();
      const code = decodeURIComponent(km[1]).trim();
      return space && code ? { space, code } : null;
    } catch { return null; }
  }
  const parts = raw.split(/\s+/);
  if (parts.length === 2) return { space: parts[0], code: parts[1] };
  return null;
}

export function createSyncClient(opts: SyncOptions) {
  const url = (opts.url || '').replace(/\/+$/, '');
  const key = opts.key || '';
  const kv = opts.storage;
  const doFetch: typeof fetch = opts.fetchFn || ((...a) => fetch(...a));
  const prefix = opts.colPrefix ?? 'fm_';
  const configured = !!(url && key);

  let team: Team | null = null;
  let pending = 0;
  let busy = 0;
  let lastError: RpcError['kind'] | null = null;
  let lastSyncAt: number | null = null;
  let status: SyncStatus = makeStatus();
  const subs = new Set<(s: SyncStatus) => void>();

  // ---------- статус ----------
  function makeStatus(): SyncStatus {
    let state: SyncState;
    if (!configured) state = 'noconfig';
    else if (!team) state = 'off';
    else if (lastError === 'denied') state = 'denied';
    else if (busy > 0) state = 'syncing';
    else if (lastError === 'offline') state = 'offline';
    else if (lastError === 'error') state = 'error';
    else if (pending > 0) state = 'pending';
    else state = 'ok';
    return {
      state,
      team: team ? { space: team.space, name: team.name || '' } : null,
      pending,
      lastSyncAt,
    };
  }
  function emit() {
    const next = makeStatus();
    const same = next.state === status.state && next.pending === status.pending &&
      next.lastSyncAt === status.lastSyncAt && JSON.stringify(next.team) === JSON.stringify(status.team);
    if (same) return;
    status = next; // новый объект только при изменении (нужно для useSyncExternalStore)
    for (const fn of Array.from(subs)) { try { fn(status); } catch { /* подписчик не должен ронять синхронизацию */ } }
  }

  // ---------- локальное хранилище ----------
  // Записи на устройство идут строго по очереди, чтобы параллельные сохранения не затирали друг друга.
  let chain: Promise<unknown> = Promise.resolve();
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  }
  async function readJSON<T>(k: string, fallback: T): Promise<T> {
    try { const s = await kv.getItem(k); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
  }
  async function writeJSON(k: string, v: unknown): Promise<void> {
    try { await kv.setItem(k, JSON.stringify(v)); } catch { /* память переполнена или недоступна */ }
  }
  const readCol = (col: string) => readJSON<ColMap>(kCol(col), {});
  const writeCol = (col: string, m: ColMap) => writeJSON(kCol(col), m);
  async function rememberCol(col: string) {
    const cols = await readJSON<string[]>(K_COLS, []);
    if (!cols.includes(col)) { cols.push(col); await writeJSON(K_COLS, cols); }
  }
  async function countPending(): Promise<number> {
    let n = 0;
    for (const col of await readJSON<string[]>(K_COLS, [])) {
      const m = await readCol(col);
      for (const id in m) if (m[id].dirty) n++;
    }
    return n;
  }
  async function refreshPending() { pending = await countPending(); emit(); }

  // ---------- база (RPC) ----------
  async function rpc<T>(name: string, args: Record<string, unknown>, query = '', who: Team | null = team): Promise<T> {
    if (!configured || !who) throw { kind: 'error', message: 'not connected' } as RpcError;
    let r: Response;
    try {
      r = await doFetch(url + '/rest/v1/rpc/' + name + query, {
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_space: who.space, p_code: who.code, ...args }),
      });
    } catch {
      throw { kind: 'offline' } as RpcError;
    }
    const text = await r.text().catch(() => '');
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (r.status >= 300) {
      const code = body && typeof body === 'object' ? body.code : undefined;
      if (code === '28000' || code === 'permission_denied') throw { kind: 'denied', status: r.status } as RpcError;
      // 5xx и «шлюз недоступен» считаем проблемой связи — попробуем позже
      if (r.status >= 500 || r.status === 0) throw { kind: 'offline', status: r.status } as RpcError;
      throw { kind: 'error', status: r.status, message: String(body?.message || text).slice(0, 200) } as RpcError;
    }
    return body as T;
  }
  const errKind = (e: unknown): RpcError['kind'] => (e && typeof e === 'object' && 'kind' in e ? (e as RpcError).kind : 'error');
  // Запуск обмена: счётчик «занято» + итоговый статус
  async function online<T>(fn: () => Promise<T>): Promise<T> {
    busy++; emit();
    try {
      const v = await fn();
      lastError = null; lastSyncAt = Date.now();
      return v;
    } catch (e) {
      lastError = errKind(e);
      throw e;
    } finally {
      busy--; emit();
    }
  }
  const remoteCol = (col: string) => prefix + col;
  const checkCol = (col: string) => COL_RE.test(col);
  const checkId = (id: string) => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/');

  // ---------- публичные функции ----------

  // Загрузить сохранённую команду и число неотправленных изменений
  async function init(): Promise<SyncStatus> {
    try {
      const t = await readJSON<Team | null>(K_TEAM, null);
      team = t && t.space && t.code ? t : null;
      await refreshPending();
    } catch { /* остаёмся без команды */ }
    return status;
  }

  // Проверить код через space_info и запомнить команду. Не бросает.
  async function connectTeam(space: string, code: string): Promise<ConnectResult> {
    const s = String(space || '').trim();
    const c = String(code || '').trim();
    if (!configured) return { ok: false, reason: 'noconfig' };
    if (!s || !c) return { ok: false, reason: 'invalid' };
    const who: Team = { space: s, code: c };
    busy++; emit();
    try {
      const rows = await rpc<{ name: string | null }[] | { name: string | null }>('space_info', {}, '', who);
      const info = Array.isArray(rows) ? rows[0] : rows;
      team = { space: s, code: c, name: (info && info.name) || '' };
      lastError = null; lastSyncAt = Date.now();
      await writeJSON(K_TEAM, team);
      return { ok: true, name: team.name || '' };
    } catch (e) {
      const kind = errKind(e);
      return { ok: false, reason: kind === 'denied' ? 'denied' : kind === 'offline' ? 'offline' : 'error' };
    } finally {
      busy--; emit();
      if (team && team.space === s) void pushPending(); // отправить то, что накопилось без команды
    }
  }

  // Отключить команду. Данные на устройстве остаются.
  async function disconnectTeam(): Promise<void> {
    team = null; lastError = null; lastSyncAt = null;
    try { await kv.removeItem(K_TEAM); } catch { /* ignore */ }
    emit();
  }

  // Проверка связи с базой (space_info) — обновляет статус и название команды
  async function ping(): Promise<boolean> {
    if (!team) return false;
    try {
      const rows = await online(() => rpc<{ name: string | null }[]>('space_info', {}));
      const name = (Array.isArray(rows) && rows[0]?.name) || '';
      if (team && name !== team.name) { team = { ...team, name }; await writeJSON(K_TEAM, team); emit(); }
      return true;
    } catch { return false; }
  }

  // Сохранить документ: сразу на устройство, затем в базу (если подключено).
  async function saveDoc(col: string, id: string, data: DocData): Promise<SaveResult> {
    if (!checkCol(col) || !checkId(id) || !data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, synced: false };
    try {
      await locked(async () => {
        const m = await readCol(col);
        const prev = m[id];
        m[id] = { d: clone(data), t: new Date().toISOString(), dirty: 1, rev: (prev?.rev || 0) + 1 };
        await writeCol(col, m);
        await rememberCol(col);
      });
      await refreshPending();
    } catch { return { ok: false, synced: false }; }
    await pushPending();
    return { ok: true, synced: !!team && !(await isDirty(col, id)) };
  }

  // Удалить документ (на устройстве сразу, в базе — при связи)
  async function deleteDoc(col: string, id: string): Promise<SaveResult> {
    if (!checkCol(col) || !checkId(id)) return { ok: false, synced: false };
    try {
      await locked(async () => {
        const m = await readCol(col);
        const prev = m[id];
        m[id] = { d: null, t: new Date().toISOString(), dirty: 1, del: 1, rev: (prev?.rev || 0) + 1 };
        await writeCol(col, m);
        await rememberCol(col);
      });
      await refreshPending();
    } catch { return { ok: false, synced: false }; }
    await pushPending();
    return { ok: true, synced: !!team && !(await isDirty(col, id)) };
  }

  async function isDirty(col: string, id: string): Promise<boolean> {
    const m = await readCol(col);
    return !!m[id]?.dirty;
  }

  // Прочитать документ. Если есть связь — свежая версия из базы (кроме неотправленных правок).
  async function getDoc<T extends DocData = DocData>(col: string, id: string): Promise<T | null> {
    if (!checkCol(col) || !checkId(id)) return null;
    const local = (await readCol(col))[id];
    if (team && !local?.dirty) {
      try {
        const remote = await online(() => rpc<DocData | null>('doc_get', { p_col: remoteCol(col), p_id: id }));
        await locked(async () => {
          const m = await readCol(col);
          if (m[id]?.dirty) return; // пока ждали ответ, появилась локальная правка — она важнее
          if (remote && typeof remote === 'object') m[id] = { d: remote, t: m[id]?.t || null };
          else delete m[id];
          await writeCol(col, m);
          await rememberCol(col);
        });
        return remote && typeof remote === 'object' ? (clone(remote) as T) : null;
      } catch { /* нет связи — отдаём локальную копию */ }
    }
    return local && !local.del && local.d ? (clone(local.d) as T) : null;
  }

  // Список документов коллекции. С базой сливается так: неотправленные локальные правки важнее.
  async function listDocs<T extends DocData = DocData>(col: string): Promise<Doc<T>[]> {
    if (!checkCol(col)) return [];
    if (team) {
      try {
        const rows = await online(async () => {
          const all: { id: string; data: DocData; updated_at: string }[] = [];
          for (let from = 0; ; from += PAGE) {
            const page = await rpc<typeof all>('doc_list', { p_col: remoteCol(col) }, `?order=id&limit=${PAGE}&offset=${from}`);
            all.push(...(page || []));
            if (!page || page.length < PAGE) break;
          }
          return all;
        });
        await locked(async () => {
          const m = await readCol(col);
          const seen = new Set<string>();
          for (const r of rows) {
            seen.add(r.id);
            if (!m[r.id]?.dirty) m[r.id] = { d: r.data, t: r.updated_at };
          }
          // нет в базе и нет локальных правок — значит удалено с другого устройства
          for (const id of Object.keys(m)) if (!seen.has(id) && !m[id].dirty) delete m[id];
          await writeCol(col, m);
          await rememberCol(col);
        });
      } catch { /* нет связи — покажем локальное */ }
    }
    const m = await readCol(col);
    return Object.keys(m).sort()
      .filter(id => !m[id].del && m[id].d)
      .map(id => ({ id, data: clone(m[id].d) as T, updatedAt: m[id].t }));
  }

  // Отправить все неотправленные изменения. Возвращает, сколько осталось.
  // Отправки идут по одной; если отправка уже идёт, ставим ещё одну следом (она увидит новые правки).
  let pushTail: Promise<number> = Promise.resolve(0);
  let waiting: Promise<number> | null = null;
  function pushPending(): Promise<number> {
    if (waiting) return waiting;
    const run = pushTail.then(() => { waiting = null; return doPush(); });
    waiting = run;
    pushTail = run.catch(() => pending);
    return run;
  }
  async function doPush(): Promise<number> {
    if (!team) { await refreshPending(); return pending; }
    const cols = await readJSON<string[]>(K_COLS, []);
    try {
      for (const col of cols) {
        const m = await readCol(col);
        for (const id of Object.keys(m)) {
          const e = m[id];
          if (!e.dirty) continue;
          const rev = e.rev || 0;
          if (e.del) await online(() => rpc('doc_delete', { p_col: remoteCol(col), p_id: id }));
          else await online(() => rpc('doc_set', { p_col: remoteCol(col), p_id: id, p_data: e.d }));
          // снять отметку, только если запись не менялась, пока шла отправка
          await locked(async () => {
            const cur = await readCol(col);
            const c = cur[id];
            if (!c || (c.rev || 0) !== rev) return;
            if (c.del) delete cur[id];
            else cur[id] = { d: c.d, t: c.t };
            await writeCol(col, cur);
          });
        }
      }
    } catch {
      // нет связи, неверный код или база отклонила запрос: изменения остаются в очереди,
      // статус уже выставлен в online(); отправим при следующей попытке
    }
    await refreshPending();
    return pending;
  }

  return {
    init,
    connectTeam,
    disconnectTeam,
    ping,
    saveDoc,
    getDoc,
    listDocs,
    deleteDoc,
    pushPending,
    getStatus: (): SyncStatus => status,
    subscribe(fn: (s: SyncStatus) => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; },
    isConfigured: () => configured,
    // Часть ссылки «#s=…&k=…», чтобы открыть «Склад» той же команды ('' — команда не подключена)
    teamFragment: (): string => (team ? '#s=' + encodeURIComponent(team.space) + '&k=' + encodeURIComponent(team.code) : ''),
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;
