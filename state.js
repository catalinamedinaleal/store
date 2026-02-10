'use strict';

/* =============================================================================
  state.js — Store (mini state manager)
  ------------------------------------------------
  Objetivo:
  ✅ Estado único y predecible (single source of truth)
  ✅ Suscripciones por evento (sin frameworks)
  ✅ Cache opcional (localStorage) para “carga instantánea”
  ✅ Helpers para mutar estado sin romper renders
  ✅ Sin guardar secretos (tokens) en localStorage
  ✅ Mutaciones seguras (inmutabilidad light) + utilidades

  Uso típico:
    import { State } from './state.js';
    State.on('products', ({next}) => renderProducts(next));
    State.set({ products: [...] });
============================================================================= */

const KEY = 'store_manager_state_v2';

/* =========================
   Helpers
========================= */
const safeJsonParse = (s, fallback=null) => {
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
 * - para arrays/objetos, compara referencia (como antes)
 */
const shallowEqual = (a,b) => Object.is(a,b);

function safeLSGet(key){
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLSSet(key, val){
  try { localStorage.setItem(key, val); return true; } catch { return false; }
}
function safeLSRemove(key){
  try { localStorage.removeItem(key); } catch {}
}

function clampStr(s, max=2000){
  const x = String(s ?? '');
  return x.length > max ? x.slice(0, max) : x;
}

/* =========================
   Emitter
========================= */
function createEmitter(){
  const map = new Map(); // evt -> Set(fn)

  function on(evt, fn){
    if(typeof fn !== 'function') return () => {};
    if(!map.has(evt)) map.set(evt, new Set());
    map.get(evt).add(fn);
    return () => off(evt, fn);
  }

  function off(evt, fn){
    const set = map.get(evt);
    if(!set) return;
    set.delete(fn);
    if(set.size === 0) map.delete(evt);
  }

  function emit(evt, payload){
    const set = map.get(evt);
    if(!set || !set.size) return;

    // copia para evitar líos si alguien se desuscribe dentro del callback
    const listeners = Array.from(set);
    for(const fn of listeners){
      try{ fn(payload); }
      catch(e){ console.warn("State listener error:", e); }
    }
  }

  function clear(){
    map.clear();
  }

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
  dashboard: null,

  // ui
  tab: 'catalog',
  busy: false,
  lastSync: null,

  // sale session (MVP)
  saleOpen: false,
  saleItems: [],

  // meta
  bootedAt: nowISO(),
});

let _state = { ...DEFAULT_STATE };

/* =========================
   Persistence (optional)
   - solo “datos”, nunca auth
========================= */
function loadCache_(){
  const raw = safeLSGet(KEY);
  if(!raw) return null;

  const cached = safeJsonParse(raw, null);
  if(!cached || !isObj(cached)) return null;

  // Mantenemos solo cosas seguras y esperadas
  return {
    products: Array.isArray(cached.products) ? cached.products : [],
    inventory: Array.isArray(cached.inventory) ? cached.inventory : [],
    dashboard: cached.dashboard || null,
    lastSync: cached.lastSync || null,
  };
}

function saveCache_(){
  const safe = {
    products: _state.products,
    inventory: _state.inventory,
    dashboard: _state.dashboard,
    lastSync: _state.lastSync,
  };

  const ok = safeLSSet(KEY, JSON.stringify(safe));
  if(!ok){
    // cuando localStorage se pone dramático (quota, bloqueo, etc.)
    // no tumbamos la app por eso, solo avisamos.
    console.warn("No se pudo guardar cache state (localStorage).");
  }
}

/* =========================
   Internal setters
========================= */
function emitPatch_(prev, patch, meta){
  // Emit granular: por cada key del patch que cambió
  for(const k of Object.keys(patch)){
    if(!shallowEqual(prev[k], _state[k])){
      EE.emit(k, { prev: prev[k], next: _state[k], meta });
    }
  }
  // Emit general
  EE.emit('*', { prev, next: _state, meta });
}

function shouldCache_(patch){
  return (
    ('products' in patch) ||
    ('inventory' in patch) ||
    ('dashboard' in patch) ||
    ('lastSync' in patch)
  );
}

/* =========================
   Public API
========================= */
export const State = {

  /* -------- core access -------- */
  get(){
    return _state;
  },

  snapshot(){
    return deepClone(_state);
  },

  pick(keys=[]){
    const out = {};
    for(const k of keys){
      out[k] = _state[k];
    }
    return out;
  },

  /* -------- subscriptions -------- */
  on(evt, fn){
    return EE.on(evt, fn);
  },

  off(evt, fn){
    return EE.off(evt, fn);
  },

  emit(evt, payload){
    EE.emit(evt, payload);
  },

  /* -------- set / patch -------- */
  set(patch={}, meta={}){
    if(!isObj(patch)) return;

    const prev = _state;
    _state = { ..._state, ...patch };

    emitPatch_(prev, patch, meta);

    if(shouldCache_(patch)){
      saveCache_();
    }
  },

  /**
   * update(fn)
   * - estilo “reducer”: te paso el state actual (snapshot por referencia),
   *   tú devuelves un patch.
   */
  update(fn, meta={}){
    if(typeof fn !== 'function') return;
    const patch = fn(_state);
    if(isObj(patch)) this.set(patch, meta);
  },

  /* -------- convenience -------- */
  setBusy(on=true){
    this.set({ busy: !!on }, { sys: true });
  },

  setTab(tab){
    this.set({ tab: String(tab || 'catalog') }, { sys: true });
  },

  setUser(user){
    // nunca persistimos user en cache
    this.set({ user: user || null }, { sys: true });
  },

  setIdToken(token){
    // ojo: esto NO se persiste a localStorage
    this.set({ idToken: clampStr(token, 8000) }, { sys: true });
  },

  openSale(){
    this.set({
      saleOpen: true,
      saleItems: [],
    }, { sys: true });
  },

  closeSale(){
    this.set({
      saleOpen: false,
      saleItems: [],
    }, { sys: true });
  },

  setSaleItems(items){
    this.set({ saleItems: Array.isArray(items) ? items : [] }, { sys: true });
  },

  /* -------- data helpers -------- */
  setProducts(items){
    this.set({ products: Array.isArray(items) ? items : [] }, { data: true });
  },

  setInventory(items){
    this.set({ inventory: Array.isArray(items) ? items : [] }, { data: true });
  },

  setDashboard(dashboard){
    this.set({ dashboard: dashboard || null }, { data: true });
  },

  setLastSync(iso=nowISO()){
    this.set({ lastSync: String(iso || nowISO()) }, { data: true });
  },

  /**
   * indexers: útiles para UI (Map id -> obj)
   * - NO se guardan en state para no mezclar data + derivados
   */
  productsIndex(){
    const m = new Map();
    for(const p of (_state.products || [])){
      const id = String(p?.id ?? '').trim();
      if(id) m.set(id, p);
    }
    return m;
  },

  /* -------- cache controls -------- */
  hydrateFromCache(){
    const cached = loadCache_();
    if(!cached) return false;

    this.set({
      products: cached.products || [],
      inventory: cached.inventory || [],
      dashboard: cached.dashboard || null,
      lastSync: cached.lastSync || null,
    }, { cache: true });

    return true;
  },

  clearCache(){
    safeLSRemove(KEY);
  },

  resetAll(){
    this.clearCache();
    const prev = _state;

    _state = {
      ...DEFAULT_STATE,
      // bootedAt nuevo cada reset
      bootedAt: nowISO(),
    };

    EE.emit('*', { prev, next: _state, reset: true });
  },
};
