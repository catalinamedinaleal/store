'use strict';

/* =============================================================================
  Musicala Store · state.js (mini state manager) v5.1
  ------------------------------------------------
  Estado central sin renderizado:
  - datos principales
  - cache local no sensible
  - derivados compartidos como productsIndex
============================================================================= */

/* =========================
   Cache config
========================= */
const KEY = 'store_manager_state_v5';
const CACHE_VERSION = 5;

// TTL cache: 6 horas
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Persistimos solo estas keys (whitelist). Nunca tokens.
const CACHE_KEYS = Object.freeze([
  'products',
  'inventory',
  'dashboard',
  'sales',
  'orders',
  'lastSync',
  'restock',
]);

/* =========================
   Helpers
========================= */
const safeJsonParse = (s, fallback = null) => {
  try { return JSON.parse(String(s)); } catch { return fallback; }
};

const deepClone = (x) => {
  try { return structuredClone(x); }
  catch { return safeJsonParse(JSON.stringify(x), x); }
};

const nowISO = () => new Date().toISOString();

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * shallowEqual:
 * - rápido, suficiente para decidir si emitimos por key
 * - para arrays/objetos compara referencia
 */
const shallowEqual = (a, b) => Object.is(a, b);

function safeLSGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLSSet(key, val) {
  try { localStorage.setItem(key, val); return true; } catch { return false; }
}
function safeLSRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

function clampStr(s, max = 2000) {
  const x = String(s ?? '');
  return x.length > max ? x.slice(0, max) : x;
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v).replace(/[^\d\-]/g, '').trim();
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, '.').replace(/[^\d.\-]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

function getIn(obj, path, fallback = undefined) {
  const parts = Array.isArray(path)
    ? path
    : String(path || '').split('.').filter(Boolean);

  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

/* =========================
   Emitter
========================= */
function createEmitter() {
  const map = new Map(); // evt -> Set(fn)

  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    const e = String(evt || '').trim() || '*';
    if (!map.has(e)) map.set(e, new Set());
    map.get(e).add(fn);
    return () => off(e, fn);
  }

  function off(evt, fn) {
    const e = String(evt || '').trim() || '*';
    const set = map.get(e);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) map.delete(e);
  }

  function emit(evt, payload) {
    const e = String(evt || '').trim() || '*';
    const set = map.get(e);
    if (!set || !set.size) return;

    // copia para evitar issues si alguien se desuscribe dentro del listener
    const listeners = Array.from(set);
    for (const fn of listeners) {
      try { fn(payload); }
      catch (err) { console.warn('[State] listener error:', err); }
    }
  }

  function clear() { map.clear(); }

  return { on, off, emit, clear };
}

/* =========================
   State core
========================= */
const EE = createEmitter();

const DEFAULT_STATE = Object.freeze({
  // auth/session (NO persistir tokens)
  user: null,
  idToken: '',

  // data
  products: [],
  inventory: [],
  sales: [],
  orders: [],
  dashboard: null,

  // ui
  tab: 'catalog',
  busy: false,
  lastSync: null,

  // sale session (MVP)
  saleOpen: false,
  saleItems: [],

  // restock cart (pedido a proveedor)
  restock: Object.freeze({
    supplier: '',
    notes: '',
    items: [], // [{ id, name, desc, brand, sku, qty, cost_cop }]
  }),

  // meta
  bootedAt: nowISO(),
});

let _state = { ...DEFAULT_STATE };

// memo derivados
let _memoProductsRef = null;
let _memoProductsIndex = null;

/* =========================
   Restock normalize
========================= */
function normalizeRestock_(x) {
  const r = isObj(x) ? x : {};

  const items = safeArray(r.items).map((it) => {
    const o = isObj(it) ? it : {};
    const id = String(o.id || o.product_id || o.pid || '').trim();
    return {
      id,
      name: clampStr(o.name || o.product_name || o.nombre || '', 220),
      // Importante: guardamos desc para PDF/texto.
      desc: clampStr(o.desc || o.description || o.descripcion || '', 4000),
      brand: clampStr(o.brand || '', 160),
      sku: clampStr(o.sku || '', 120),
      qty: Math.max(0, toInt(o.qty)),
      cost_cop: Math.max(0, toInt(o.cost_cop ?? o.cost ?? o.costo_cop ?? o.costo ?? o.unit_cost)),
    };
  }).filter(it => it.id);

  return {
    supplier: clampStr(r.supplier || '', 240),
    notes: clampStr(r.notes || '', 1200),
    items,
  };
}

/* =========================
   Sale normalize
========================= */
function normalizeSaleItems_(items) {
  return safeArray(items).map(it => {
    const o = isObj(it) ? it : {};
    return {
      ...o,
      product_id: clampStr(o.product_id ?? o.id ?? '', 120),
      name: clampStr(o.name ?? '', 220),
      qty: Math.max(1, toInt(o.qty)),
      unit_price: Math.max(0, toInt(o.unit_price ?? o.price_cop ?? o.price ?? 0)),
    };
  }).filter(it => String(it.product_id || '').trim());
}

/* =========================
   Persistence (optional)
========================= */
function _makeCachePayload() {
  const safe = {};
  for (const k of CACHE_KEYS) safe[k] = _state[k];

  return {
    v: CACHE_VERSION,
    savedAt: Date.now(),
    ttlMs: CACHE_TTL_MS,
    data: safe,
  };
}

function shouldCache_(patch) {
  for (const k of CACHE_KEYS) {
    if (k in patch) return true;
  }
  return false;
}

// guardamos en "micro-throttle" para no matar el main thread
let _cacheSaveT = null;
let _cacheDirty = false;
let _lastSaveAt = 0;

function saveCache_Deferred_(meta = {}) {
  // si viene de cacheSync, NO guardamos o hacemos loop cross-tab
  if (meta && meta.cacheSync) return;

  _cacheDirty = true;
  const now = Date.now();
  const minGap = 120; // ms, best-effort

  clearTimeout(_cacheSaveT);
  const wait = Math.max(0, (_lastSaveAt + minGap) - now);

  _cacheSaveT = setTimeout(() => {
    _cacheSaveT = null;
    if (!_cacheDirty) return;

    const payload = _makeCachePayload();
    const ok = safeLSSet(KEY, JSON.stringify(payload));
    _lastSaveAt = Date.now();
    _cacheDirty = false;

    if (!ok) console.warn('[State] No se pudo guardar cache (localStorage).');
  }, Math.max(30, wait));
}

function flushCacheNow_() {
  try {
    clearTimeout(_cacheSaveT);
    _cacheSaveT = null;
    if (!_cacheDirty) return;
    const payload = _makeCachePayload();
    const ok = safeLSSet(KEY, JSON.stringify(payload));
    _lastSaveAt = Date.now();
    _cacheDirty = false;
    if (!ok) console.warn('[State] No se pudo guardar cache (flush).');
  } catch {}
}

function loadCache_() {
  const raw = safeLSGet(KEY);
  if (!raw) return null;

  const cached = safeJsonParse(raw, null);
  if (!cached || !isObj(cached)) return null;
  if (cached.v !== CACHE_VERSION) return null;

  const savedAt = Number(cached.savedAt || 0);
  const ttlMs = Number(cached.ttlMs || CACHE_TTL_MS);
  const expired = savedAt > 0 && ttlMs > 0 && (Date.now() - savedAt) > ttlMs;
  if (expired) return null;

  const data = cached.data;
  if (!isObj(data)) return null;

  return {
    products: safeArray(data.products),
    inventory: safeArray(data.inventory),
    sales: safeArray(data.sales),
    orders: safeArray(data.orders),
    dashboard: data.dashboard || null,
    lastSync: data.lastSync || null,
    restock: normalizeRestock_(data.restock),
  };
}

/* =========================
   Internal emit + memo invalidation
========================= */
function _invalidateMemoIfNeeded(patch) {
  if ('products' in patch) {
    _memoProductsRef = null;
    _memoProductsIndex = null;
  }
}

function emitPatch_(prev, patch, meta) {
  const changedKeys = [];

  for (const k of Object.keys(patch)) {
    if (!shallowEqual(prev[k], _state[k])) {
      changedKeys.push(k);
      EE.emit(k, { prev: prev[k], next: _state[k], meta });
    }
  }

  if (!changedKeys.length) return;

  EE.emit('batch', { keys: changedKeys, prev, next: _state, meta });

  // wildcard solo si hubo cambios
  EE.emit('*', { prev, next: _state, meta });
}

/* =========================
   Cross-tab sync (best effort)
========================= */
let _lastSelfWriteStamp = 0;

function attachCrossTabSync_() {
  try {
    // Marcar "self write" cuando guardamos cache (para no auto-absorber lo mismo)
    const _origSet = safeLSSet;
    // No monkeypatch de localStorage global, solo registramos al guardar con flush/deferred
    // (lo hacemos marcando en flushCacheNow_/saveCache_Deferred_ vía stamp)
    // Aquí dejamos la variable lista.
    void _origSet;

    window.addEventListener('storage', (ev) => {
      if (!ev) return;
      if (ev.key !== KEY) return;

      // Evita absorber inmediatamente tu propio set en algunos browsers raros
      const now = Date.now();
      if (_lastSelfWriteStamp && (now - _lastSelfWriteStamp) < 250) return;

      const cached = loadCache_();
      if (!cached) return;

      // Solo data persistida (no UI/auth)
      State.set({
        products: cached.products || [],
        inventory: cached.inventory || [],
        sales: cached.sales || [],
        orders: cached.orders || [],
        dashboard: cached.dashboard || null,
        lastSync: cached.lastSync || null,
        restock: cached.restock || normalizeRestock_(null),
      }, { cacheSync: true });
    });
  } catch {
    // no-op
  }

  // Flush cuando la pestaña se va, para no perder cambios
  try {
    window.addEventListener('pagehide', () => flushCacheNow_());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushCacheNow_();
    });
  } catch {
    // no-op
  }
}

/* =========================
   Public API
========================= */
export const State = {
  /* -------- core access -------- */
  get() { return _state; },

  snapshot() { return deepClone(_state); },

  pick(keys = []) {
    const out = {};
    for (const k of keys) out[k] = _state[k];
    return out;
  },

  getIn(path, fallback) { return getIn(_state, path, fallback); },

  /* -------- subscriptions -------- */
  on(evt, fn) { return EE.on(evt, fn); },
  off(evt, fn) { return EE.off(evt, fn); },
  emit(evt, payload) { EE.emit(evt, payload); },

  /* -------- set / patch -------- */
  set(patch = {}, meta = {}) {
    if (!isObj(patch)) return;

    let nextPatch = patch;

    // normalize keys
    if ('restock' in nextPatch) nextPatch = { ...nextPatch, restock: normalizeRestock_(nextPatch.restock) };
    if ('saleItems' in nextPatch) nextPatch = { ...nextPatch, saleItems: normalizeSaleItems_(nextPatch.saleItems) };

    const prev = _state;

    _invalidateMemoIfNeeded(nextPatch);
    _state = { ..._state, ...nextPatch };

    emitPatch_(prev, nextPatch, meta);

    if (shouldCache_(nextPatch)) {
      // marca self write cuando efectivamente guardemos
      saveCache_Deferred_(meta);
    }
  },

  /**
   * update(fn)
   * - reducer style: fn(state) -> patch
   */
  update(fn, meta = {}) {
    if (typeof fn !== 'function') return;
    const patch = fn(_state);
    if (isObj(patch)) this.set(patch, meta);
  },

  /**
   * transaction(fn)
   * - Soporta DOS estilos:
   *   A) fn(draft, state) { draft.x=1; draft.y=2; }
   *   B) return patch;
   */
  transaction(fn, meta = {}) {
    if (typeof fn !== 'function') return;

    const draft = {};
    let ret = null;

    try {
      ret = fn(draft, _state);
    } catch (e) {
      console.warn('[State] transaction error:', e);
      return;
    }

    const patch = isObj(ret) ? ret : draft;
    if (!isObj(patch) || !Object.keys(patch).length) return;

    const prev = _state;

    let nextPatch = patch;
    if ('restock' in nextPatch) nextPatch = { ...nextPatch, restock: normalizeRestock_(nextPatch.restock) };
    if ('saleItems' in nextPatch) nextPatch = { ...nextPatch, saleItems: normalizeSaleItems_(nextPatch.saleItems) };

    _invalidateMemoIfNeeded(nextPatch);
    _state = { ..._state, ...nextPatch };

    emitPatch_(prev, nextPatch, { ...meta, tx: true });

    if (shouldCache_(nextPatch)) saveCache_Deferred_({ ...meta, tx: true });
  },

  /* -------- convenience -------- */
  setBusy(on = true) { this.set({ busy: !!on }, { sys: true }); },
  setTab(tab) { this.set({ tab: String(tab || 'catalog') }, { sys: true }); },

  setUser(user) { this.set({ user: user || null }, { sys: true }); },

  setIdToken(token) {
    // NUNCA persistir
    this.set({ idToken: clampStr(token, 8000) }, { sys: true });
  },

  /* -------- Sale session -------- */
  openSale() { this.set({ saleOpen: true, saleItems: [] }, { sys: true }); },
  closeSale() { this.set({ saleOpen: false, saleItems: [] }, { sys: true }); },
  setSaleItems(items) { this.set({ saleItems: items }, { sys: true }); },

  /* -------- data setters -------- */
  setProducts(items) { this.set({ products: safeArray(items) }, { data: true }); },
  setInventory(items) { this.set({ inventory: safeArray(items) }, { data: true }); },
  setSales(items) { this.set({ sales: safeArray(items) }, { data: true }); },
  setOrders(items) { this.set({ orders: safeArray(items) }, { data: true }); },
  setDashboard(dashboard) { this.set({ dashboard: dashboard || null }, { data: true }); },
  setLastSync(iso = nowISO()) { this.set({ lastSync: String(iso || nowISO()) }, { data: true }); },

  /* -------- derived -------- */
  productsIndex() {
    const ref = _state.products;
    if (_memoProductsRef === ref && _memoProductsIndex) return _memoProductsIndex;

    const m = new Map();
    for (const p of safeArray(ref)) {
      const id = String(p?.id ?? '').trim();
      if (id) m.set(id, p);
    }

    _memoProductsRef = ref;
    _memoProductsIndex = m;
    return m;
  },

  ordersOpenCount() {
    const list = safeArray(_state.orders);
    return totalsZeroSafe_(list, (o) => {
      const s = String(o?.status || '').toLowerCase().trim();
      return (s === 'open' || s === 'pending' || s === 'pedido' || s === 'abierto') ? 1 : 0;
    });
  },

  /* =========================
     Restock Cart API
  ========================= */
  getRestock() { return _state.restock; },

  setRestockMeta({ supplier, notes } = {}) {
    const r = normalizeRestock_(_state.restock);
    this.set({
      restock: {
        ...r,
        supplier: clampStr(supplier ?? r.supplier ?? '', 240),
        notes: clampStr(notes ?? r.notes ?? '', 1200),
      },
    }, { sys: true });
  },

  restockMergeMeta(meta = {}) {
    const r = normalizeRestock_(_state.restock);
    this.set({
      restock: {
        ...r,
        supplier: meta.supplier !== undefined ? clampStr(meta.supplier, 240) : r.supplier,
        notes: meta.notes !== undefined ? clampStr(meta.notes, 1200) : r.notes,
      },
    }, { sys: true });
  },

  restockAddProduct(product, qty = 1) {
    const p = isObj(product) ? product : {};
    const id = String(p.id || p.product_id || '').trim();
    if (!id) return false;

    const r = normalizeRestock_(_state.restock);
    const items = safeArray(r.items);

    const idx = items.findIndex(x => String(x.id) === id);
    const addQty = Math.max(1, toInt(qty));

    const incomingCost = Math.max(0, toInt(p.cost_cop ?? p.cost ?? p.costo_cop ?? p.costo));
    const incomingName = clampStr(p.name ?? '', 220);
    const incomingDesc = clampStr(p.desc ?? p.description ?? p.descripcion ?? '', 4000);
    const incomingBrand = clampStr(p.brand ?? '', 160);
    const incomingSku = clampStr(p.sku ?? '', 120);

    let nextItems;
    if (idx >= 0) {
      const cur = items[idx];
      const next = {
        ...cur,
        qty: Math.max(0, toInt(cur.qty) + addQty),
        cost_cop: incomingCost > 0 ? incomingCost : Math.max(0, toInt(cur.cost_cop)),
        name: incomingName || cur.name,
        desc: incomingDesc || cur.desc,
        brand: incomingBrand || cur.brand,
        sku: incomingSku || cur.sku,
      };
      nextItems = items.slice();
      nextItems[idx] = next;
    } else {
      nextItems = items.concat([{
        id,
        name: incomingName,
        desc: incomingDesc,
        brand: incomingBrand,
        sku: incomingSku,
        qty: addQty,
        cost_cop: incomingCost,
      }]);
    }

    this.set({ restock: { ...r, items: nextItems } }, { data: true, restock: true });
    return true;
  },

  restockUpsertItem(item) {
    const it = isObj(item) ? item : {};
    const id = String(it.id || it.product_id || '').trim();
    if (!id) return false;

    const r = normalizeRestock_(_state.restock);
    const items = safeArray(r.items);
    const idx = items.findIndex(x => String(x.id) === id);

    const next = {
      id,
      name: clampStr(it.name || it.product_name || '', 220),
      desc: clampStr(it.desc || it.description || it.descripcion || '', 4000),
      brand: clampStr(it.brand || '', 160),
      sku: clampStr(it.sku || '', 120),
      qty: Math.max(0, toInt(it.qty)),
      cost_cop: Math.max(0, toInt(it.cost_cop ?? it.cost ?? it.costo_cop ?? it.costo)),
    };

    let nextItems;
    if (idx >= 0) {
      nextItems = items.slice();
      nextItems[idx] = { ...items[idx], ...next, id };
    } else {
      nextItems = items.concat([next]);
    }

    this.set({ restock: { ...r, items: nextItems } }, { data: true, restock: true });
    return true;
  },

  restockSetQty(productId, qty) {
    const id = String(productId || '').trim();
    if (!id) return;

    const r = normalizeRestock_(_state.restock);
    const items = safeArray(r.items);
    const idx = items.findIndex(x => String(x.id) === id);
    if (idx < 0) return;

    const nextItems = items.slice();
    nextItems[idx] = { ...nextItems[idx], qty: Math.max(0, toInt(qty)) };

    this.set({ restock: { ...r, items: nextItems } }, { data: true, restock: true });
  },

  restockSetCost(productId, cost) {
    const id = String(productId || '').trim();
    if (!id) return;

    const r = normalizeRestock_(_state.restock);
    const items = safeArray(r.items);
    const idx = items.findIndex(x => String(x.id) === id);
    if (idx < 0) return;

    const nextItems = items.slice();
    nextItems[idx] = { ...nextItems[idx], cost_cop: Math.max(0, toInt(cost)) };

    this.set({ restock: { ...r, items: nextItems } }, { data: true, restock: true });
  },

  restockSetDesc(productId, desc) {
    const id = String(productId || '').trim();
    if (!id) return;

    const r = normalizeRestock_(_state.restock);
    const items = safeArray(r.items);
    const idx = items.findIndex(x => String(x.id) === id);
    if (idx < 0) return;

    const nextItems = items.slice();
    nextItems[idx] = { ...nextItems[idx], desc: clampStr(desc ?? '', 4000) };

    this.set({ restock: { ...r, items: nextItems } }, { data: true, restock: true });
  },

  restockRemove(productId) {
    const id = String(productId || '').trim();
    if (!id) return;

    const r = normalizeRestock_(_state.restock);
    const nextItems = safeArray(r.items).filter(x => String(x.id) !== id);

    this.set({ restock: { ...r, items: nextItems } }, { data: true, restock: true });
  },

  restockClear(keepMeta = true) {
    const r = normalizeRestock_(_state.restock);
    const next = keepMeta
      ? { ...r, items: [] }
      : { supplier: '', notes: '', items: [] };

    this.set({ restock: next }, { data: true, restock: true });
  },

  restockTotals() {
    const r = normalizeRestock_(_state.restock);
    let units = 0;
    let cost = 0;
    for (const it of safeArray(r.items)) {
      const q = Math.max(0, toInt(it.qty));
      const c = Math.max(0, toInt(it.cost_cop));
      units += q;
      cost += q * c;
    }
    return { items: safeArray(r.items).length, units, cost_cop: cost };
  },

  restockFromProductsIndex(ids = []) {
    const list = safeArray(ids).map(x => String(x || '').trim()).filter(Boolean);
    if (!list.length) return 0;

    const idx = this.productsIndex();
    let added = 0;
    for (const id of list) {
      const p = idx.get(id);
      if (p) {
        if (this.restockAddProduct(p, 1)) added++;
      }
    }
    return added;
  },

  /* -------- cache controls -------- */
  hydrateFromCache() {
    const cached = loadCache_();
    if (!cached) return false;

    // Importante: solo data, no UI ni auth
    this.set({
      products: cached.products || [],
      inventory: cached.inventory || [],
      sales: cached.sales || [],
      orders: cached.orders || [],
      dashboard: cached.dashboard || null,
      lastSync: cached.lastSync || null,
      restock: cached.restock || normalizeRestock_(null),
    }, { cache: true });

    return true;
  },

  clearCache() { safeLSRemove(KEY); },

  resetAll() {
    this.clearCache();

    _memoProductsRef = null;
    _memoProductsIndex = null;

    const prev = _state;
    _state = {
      ...DEFAULT_STATE,
      bootedAt: nowISO(),
    };

    EE.emit('*', { prev, next: _state, reset: true });
    EE.emit('batch', { keys: Object.keys(DEFAULT_STATE), prev, next: _state, reset: true });
  },

  /* -------- init hook (opcional) -------- */
  init() {
    if (this._inited) return;
    this._inited = true;
    attachCrossTabSync_();
  },

  // interno: si alguien quiere forzar flush (debug)
  _flushCacheNow() { flushCacheNow_(); },
};

/* =========================
   tiny helpers (local)
========================= */
function totalsZeroSafe_(arr, fn) {
  let n = 0;
  for (const x of safeArray(arr)) {
    try { n += Math.max(0, toInt(fn(x))); } catch {}
  }
  return n;
}

/* Auto-init (sin explotar en entornos raros) */
try { State.init(); } catch {}

/* Marca self-write stamp cuando realmente hacemos flush/deferred-save */
(function hookSelfWriteStamp_() {
  const origFlush = flushCacheNow_;
  flushCacheNow_ = function () {
    _lastSelfWriteStamp = Date.now();
    return origFlush();
  };

  const origDeferred = saveCache_Deferred_;
  saveCache_Deferred_ = function (meta = {}) {
    // stamp solo cuando se programe (best-effort)
    _lastSelfWriteStamp = Date.now();
    return origDeferred(meta);
  };
})();
