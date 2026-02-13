'use strict';

/* =============================================================================
  state.js — Store (mini state manager) v4.6
  ------------------------------------------------
  ✅ Estado único y predecible (single source of truth)
  ✅ Suscripciones por evento (sin frameworks, sin llorar)
  ✅ Cache opcional (localStorage) con TTL + versionado
  ✅ Whitelist persistible (nunca tokens)
  ✅ Mutaciones seguras (inmutabilidad light real)
  ✅ transaction(): batch updates con 1 sola emisión
  ✅ Derived memo: productsIndex() memoizado por referencia
  ✅ Restock Cart (pedido a proveedor)
     - restock: { supplier, notes, items[] }
     - helpers: add/update/remove/clear + totals
============================================================================= */

const KEY = 'store_manager_state_v4';
const CACHE_VERSION = 4;

// TTL cache: 6 horas
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Solo estas keys son persistibles (whitelist)
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
  const parts = Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean);
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
    if (!map.has(evt)) map.set(evt, new Set());
    map.get(evt).add(fn);
    return () => off(evt, fn);
  }

  function off(evt, fn) {
    const set = map.get(evt);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) map.delete(evt);
  }

  function emit(evt, payload) {
    const set = map.get(evt);
    if (!set || !set.size) return;

    // copia para evitar issues si alguien se desuscribe dentro del listener
    const listeners = Array.from(set);
    for (const fn of listeners) {
      try { fn(payload); }
      catch (e) { console.warn('[State] listener error:', e); }
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

  // restock cart
  restock: Object.freeze({
    supplier: '',
    notes: '',
    items: [], // [{ id, name, brand, sku, qty, cost_cop }]
  }),

  // meta
  bootedAt: nowISO(),
});

let _state = { ...DEFAULT_STATE };

// memo derivados
let _memoProductsRef = null;
let _memoProductsIndex = null;

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

function saveCache_() {
  const payload = _makeCachePayload();
  const ok = safeLSSet(KEY, JSON.stringify(payload));
  if (!ok) console.warn('[State] No se pudo guardar cache (localStorage).');
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
  });
}

/* =========================
   Internal emit
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

  if (changedKeys.length) {
    EE.emit('batch', { keys: changedKeys, prev, next: _state, meta });
  }

  EE.emit('*', { prev, next: _state, meta });
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

    // normalize “dangerous” keys
    if ('restock' in nextPatch) nextPatch = { ...nextPatch, restock: normalizeRestock_(nextPatch.restock) };
    if ('saleItems' in nextPatch) nextPatch = { ...nextPatch, saleItems: normalizeSaleItems_(nextPatch.saleItems) };

    const prev = _state;
    _invalidateMemoIfNeeded(nextPatch);
    _state = { ..._state, ...nextPatch };

    emitPatch_(prev, nextPatch, meta);

    if (shouldCache_(nextPatch)) saveCache_();
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
   *   B) return patch; (si quieres)
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

    if (shouldCache_(nextPatch)) saveCache_();
  },

  /* -------- convenience -------- */
  setBusy(on = true) { this.set({ busy: !!on }, { sys: true }); },
  setTab(tab) { this.set({ tab: String(tab || 'catalog') }, { sys: true }); },

  setUser(user) { this.set({ user: user || null }, { sys: true }); },

  setIdToken(token) {
    // NO persistir
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
    let n = totalsZeroSafe_(list, (o) => {
      const s = String(o?.status || '').toLowerCase().trim();
      return (s === 'open' || s === 'pending' || s === 'pedido' || s === 'abierto') ? 1 : 0;
    });
    return n;
  },

  /* =========================
     ✅ Restock Cart API
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
        brand: incomingBrand || cur.brand,
        sku: incomingSku || cur.sku,
      };
      nextItems = items.slice();
      nextItems[idx] = next;
    } else {
      nextItems = items.concat([{
        id,
        name: incomingName,
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
    const prev = _state;

    _memoProductsRef = null;
    _memoProductsIndex = null;

    _state = {
      ...DEFAULT_STATE,
      bootedAt: nowISO(),
    };

    EE.emit('*', { prev, next: _state, reset: true });
    EE.emit('batch', { keys: Object.keys(DEFAULT_STATE), prev, next: _state, reset: true });
  },
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
