'use strict';

/* ============================================================================
   api.js — Store API Client (CORS-proof for Apps Script) — PRO++ v6
   ---------------------------------------------------------------------------
   Objetivo:
   ✅ Obtener idToken desde Firebase
   ✅ Evitar CORS/preflight (NO Authorization header, NO custom headers)
   ✅ Requests unificadas, robustas, con timeout
   ✅ Errores consistentes (Apps Script + JSON/text)
   ✅ Retry inteligente: si el token expiró, refresca 1 vez y reintenta
   ✅ Shortcuts de endpoints (StoreAPI) incluyendo MOVIMIENTOS ✅
   ✅ (Opcional) Anti-spam: coalesce requests iguales en vuelo
   ✅ (Opcional) JSONP fallback (si tu backend lo soporta)

   Requiere:
   - window.STORE_CFG.API_BASE   (URL del Web App /exec)
   - window.__FB__              (Firebase refs: auth)
============================================================================ */

const CFG = window.STORE_CFG || {};
const API_BASE = String(CFG.API_BASE || '').trim();
const FB = window.__FB__ || {};

if (!API_BASE) console.warn('⚠️ API_BASE no configurado (STORE_CFG.API_BASE)');
if (!FB || !FB.auth) console.warn('⚠️ Firebase no disponible en api.js (window.__FB__.auth)');

/* =========================
   Const / Config
========================= */

// Timeout para no quedarse colgado si Apps Script se queda pensando en su existencia
const DEFAULT_TIMEOUT_MS = 25_000;

// En Apps Script, lo más estable es POST always.
const FORCE_POST = true;

// (Opcional) Coalesce: si haces el mismo request (action+payload) varias veces en paralelo,
// se resuelve con la misma promesa y reduces doble carga.
const ENABLE_COALESCE = true;
const _inflight = new Map(); // key -> Promise

// Cache de token
let _tokenCache = { token: '', expMs: 0 };

// JSONP opcional (solo si lo activas desde opts o CFG)
const ENABLE_JSONP_FALLBACK = !!CFG.API_JSONP_FALLBACK;

/* =========================
   Errors
========================= */
class ApiError extends Error {
  constructor(message, extra = {}) {
    super(message || 'Error API');
    this.name = 'ApiError';
    this.code = extra.code || 'API_ERROR';
    this.http = extra.http || null;
    this.raw = extra.raw || null;
    this.meta = extra.meta || null;
    this.requestId = extra.requestId || null;
  }
}

/* =========================
   Utils
========================= */
const nowMs = () => Date.now();
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function safeJsonParse(s, fallback = null) {
  try { return JSON.parse(String(s)); } catch { return fallback; }
}

function makeRequestId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAbortError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return err && (err.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout'));
}

function normalizeApiError(data, fallbackMsg) {
  if (isObj(data)) {
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.details === 'string' && data.details.trim()) return data.details.trim();
    if (typeof data.msg === 'string' && data.msg.trim()) return data.msg.trim();
  }
  return fallbackMsg || 'Error desconocido API';
}

function looksLikeAuthError(msg) {
  const s = String(msg || '').toLowerCase();
  return (
    (s.includes('token') && (s.includes('expir') || s.includes('expired') || s.includes('invalid') || s.includes('invalido') || s.includes('venc'))) ||
    s.includes('unauthorized') || s.includes('no autorizado') ||
    s.includes('forbidden') || s.includes('permission') ||
    s.includes('auth') && (s.includes('fail') || s.includes('error'))
  );
}

function stableStringify(value) {
  // stringify estable recursivo, sin ciclos (no mandes ciclos 🙃)
  const seen = new WeakSet();

  const walk = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(walk);

    if (seen.has(v)) return '[Circular]';
    seen.add(v);

    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = walk(v[k]);
    return out;
  };

  return JSON.stringify(walk(value));
}

function makeCoalesceKey(action, payload, opts) {
  const t = Number.isFinite(opts?.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const fr = !!opts?.forceRefreshToken;
  return `${String(action)}|t=${t}|fr=${fr}|${stableStringify(isObj(payload) ? payload : {})}`;
}

function decodeJwtPayload(token) {
  // No valida firma (no es necesario), solo saca exp si se puede.
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(b64 + pad);
    return safeJsonParse(json, null);
  } catch {
    return null;
  }
}

/* =========================
   Auth token
========================= */
async function getToken({ forceRefresh = false } = {}) {
  const user = FB.auth?.currentUser;
  if (!user) throw new ApiError('No hay sesión activa', { code: 'NO_SESSION' });

  // Si tenemos token y exp, úsalo si está vigente con un margen
  if (!forceRefresh && _tokenCache.token && _tokenCache.expMs > nowMs()) {
    return _tokenCache.token;
  }

  const token = await user.getIdToken(!!forceRefresh);
  if (!token) throw new ApiError('No se pudo obtener token de sesión', { code: 'NO_TOKEN' });

  // Cache basado en exp (si se puede), si no, cache corto
  const payload = decodeJwtPayload(token);
  if (payload?.exp) {
    // exp viene en segundos
    const expMs = (Number(payload.exp) * 1000) - 30_000; // margen 30s
    _tokenCache = { token, expMs: Math.max(nowMs() + 10_000, expMs) };
  } else {
    _tokenCache = { token, expMs: nowMs() + 45_000 };
  }
  return token;
}

export function apiResetTokenCache() {
  _tokenCache = { token: '', expMs: 0 };
}

/* =========================
   Networking (CORS-proof)
========================= */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));

  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function readResponse(res) {
  const txt = await res.text().catch(() => '');
  const trimmed = String(txt || '').trim();

  if (!trimmed) return { ok: false, error: 'Respuesta vacía del servidor', raw: txt };

  const data = safeJsonParse(trimmed, null);
  if (data) return data;

  // Si no es JSON, devolvemos "pseudo-json"
  return { ok: false, error: 'Respuesta inválida del servidor', raw: txt };
}

/* =========================
   JSONP (Opcional)
========================= */
function jsonpRequest(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const cbName = `__jsonp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => cleanup(new ApiError(`Timeout JSONP (${timeoutMs} ms)`, { code: 'TIMEOUT' })), timeoutMs);

    function cleanup(err, data) {
      clearTimeout(timer);
      try { delete window[cbName]; } catch {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
      if (err) reject(err);
      else resolve(data);
    }

    window[cbName] = (data) => cleanup(null, data);

    script.onerror = () => cleanup(new ApiError('Error cargando JSONP', { code: 'JSONP_ERROR' }));
    script.src = url + (url.includes('?') ? '&' : '?') + `callback=${encodeURIComponent(cbName)}`;
    document.head.appendChild(script);
  });
}

/* =========================
   Core request()
========================= */
/**
 * request()
 * - Evita preflight: NO headers custom, NO content-type application/json forzado.
 * - Pasa token en el body: { token, action, ... }
 * - Usa POST siempre (recomendado para Apps Script).
 *
 * Retorna el objeto "data" completo (incluye data.* que defina tu backend)
 */
async function request(action, payload = {}, opts = {}) {
  if (!API_BASE) throw new ApiError('API_BASE no configurado (STORE_CFG.API_BASE)', { code: 'NO_API_BASE' });
  if (!action) throw new ApiError("request() requiere 'action'", { code: 'NO_ACTION' });

  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const requestId = opts.requestId || makeRequestId();
  const allowAuthRetry = (opts.allowAuthRetry !== false);
  const allowJsonp = (opts.allowJsonp === true) || (ENABLE_JSONP_FALLBACK && opts.allowJsonp !== false);

  const doOnce = async ({ forceRefreshToken = false } = {}) => {
    const token = await getToken({ forceRefresh: !!forceRefreshToken });

    const bodyObj = {
      action: String(action),
      token,
      requestId,
      ts: nowMs(),
      ...((isObj(payload) ? payload : {})),
    };

    const started = nowMs();

    // Normal: POST text/plain (sin headers)
    try {
      const res = await fetchWithTimeout(API_BASE, {
        method: 'POST',
        body: JSON.stringify(bodyObj),
      }, timeoutMs);

      const data = await readResponse(res);

      if (!res.ok) {
        throw new ApiError(
          normalizeApiError(data, `HTTP ${res.status} (${res.statusText || 'error'})`),
          { code: 'HTTP_ERROR', http: { status: res.status, statusText: res.statusText }, raw: data, requestId }
        );
      }

      if (!data || data.ok !== true) {
        throw new ApiError(
          normalizeApiError(data, 'Error desconocido API'),
          { code: 'API_NOT_OK', raw: data, requestId }
        );
      }

      if (isObj(data) && !data._meta) data._meta = { requestId, ms: nowMs() - started };
      return data;

    } catch (err) {
      // Timeout / Abort
      if (isAbortError(err)) {
        throw new ApiError(`Timeout (${timeoutMs} ms) hablando con el servidor`, {
          code: 'TIMEOUT',
          requestId,
          meta: { timeoutMs }
        });
      }

      // Si fue ApiError ya armado, lo devolvemos
      if (err instanceof ApiError) throw err;

      // Fallback: error genérico
      throw new ApiError(String(err?.message || 'Error de red'), {
        code: 'NETWORK_ERROR',
        requestId
      });
    }
  };

  // Coalesce (si aplica)
  const key = (ENABLE_COALESCE && opts.coalesce !== false)
    ? makeCoalesceKey(action, payload, opts)
    : null;

  if (key && _inflight.has(key)) return _inflight.get(key);

  const runner = (async () => {
    try {
      // primer intento
      return await doOnce({ forceRefreshToken: !!opts.forceRefreshToken });
    } catch (err1) {
      // Retry de auth/token (1 vez)
      if (allowAuthRetry && looksLikeAuthError(err1?.message)) {
        apiResetTokenCache();
        return await doOnce({ forceRefreshToken: true });
      }

      // JSONP fallback opcional (si tu backend lo soporta: doGet + callback)
      if (allowJsonp && (err1?.code === 'HTTP_ERROR' || err1?.code === 'NETWORK_ERROR' || err1?.code === 'TIMEOUT')) {
        try {
          const token = await getToken({ forceRefresh: false });
          const qs = new URLSearchParams();
          qs.set('action', String(action));
          qs.set('token', token);
          qs.set('requestId', requestId);
          qs.set('ts', String(nowMs()));
          const p = isObj(payload) ? payload : {};
          for (const [k, v] of Object.entries(p)) {
            // JSONP via query, si el payload es grande, obvio se muere. No abuses.
            qs.set(k, typeof v === 'string' ? v : stableStringify(v));
          }
          const url = API_BASE + (API_BASE.includes('?') ? '&' : '?') + qs.toString();
          const data = await jsonpRequest(url, timeoutMs);

          if (!data || data.ok !== true) {
            throw new ApiError(normalizeApiError(data, 'Error desconocido API (JSONP)'), {
              code: 'API_NOT_OK',
              raw: data,
              requestId
            });
          }
          if (isObj(data) && !data._meta) data._meta = { requestId, ms: null, via: 'jsonp' };
          return data;
        } catch (err2) {
          throw (err2 instanceof ApiError) ? err2 : new ApiError(String(err2?.message || 'Error JSONP'), { code: 'JSONP_ERROR', requestId });
        }
      }

      throw err1;
    } finally {
      if (key) _inflight.delete(key);
    }
  })();

  if (key) _inflight.set(key, runner);
  return runner;
}

/* =========================
   Public API
========================= */

/**
 * apiGet:
 * - Mantiene firma para compatibilidad.
 * - Internamente usa POST (evita CORS).
 */
export async function apiGet(action, params = {}, opts = {}) {
  if (FORCE_POST) {
    return await request(action, { params: isObj(params) ? params : {} }, opts);
  }
  throw new ApiError('apiGet(GET real) deshabilitado por CORS. Usa POST.', { code: 'GET_DISABLED' });
}

/**
 * apiPost:
 * - payload: { action:"...", ... }
 */
export async function apiPost(payload = {}, opts = {}) {
  if (!payload || !payload.action) throw new ApiError("apiPost requiere 'action'", { code: 'NO_ACTION' });
  const { action, ...rest } = payload;
  return await request(action, rest, opts);
}

/**
 * loadAll:
 * - Helper para endpoints paginados por cursor
 * - Espera respuesta tipo: { ok:true, items:[...], cursor:"" }
 */
export async function loadAll(fnPage, { limit = 200, maxPages = 20, cursor = '' } = {}) {
  const all = [];
  let cur = String(cursor || '');
  for (let i = 0; i < maxPages; i++) {
    const res = await fnPage({ limit, cursor: cur });
    const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res?.data?.items) ? res.data.items : []);
    all.push(...items);

    const next = String(res?.cursor || res?.data?.cursor || '').trim();
    if (!next) break;
    cur = next;
  }
  return all;
}

/* =========================
   Shortcuts (nivel pro)
========================= */
export const StoreAPI = {
  /* META */
  ping(opts) {
    return apiPost({ action: 'ping' }, opts);
  },

  /* PRODUCTS */
  listProducts(q = '', opts) {
    return apiPost({ action: 'products.list', q: String(q ?? '') }, opts);
  },

  upsertProduct(product, opts) {
    return apiPost({
      action: 'products.upsert',
      product: (isObj(product) ? product : {})
    }, opts);
  },

  setProductActive(id, active, opts) {
    return apiPost({
      action: 'products.setActive',
      id: String(id ?? '').trim(),
      active: !!active
    }, opts);
  },

  /* INVENTORY */
  listInventory(opts) {
    return apiPost({ action: 'inventory.list' }, opts);
  },

  adjustStock(data, opts) {
    return apiPost({
      action: 'inventory.adjust',
      ...(isObj(data) ? data : {})
    }, opts);
  },

  /* MOVES (AUDITORÍA) ✅ */
  listMoves(q = '', limit = 200, cursor = '', opts) {
    return apiPost({
      action: 'moves.list',
      q: String(q ?? ''),
      limit: Number.isFinite(limit) ? limit : 200,
      cursor: String(cursor ?? '')
    }, opts);
  },

  /* SALES / ORDERS */
  createSale(data, opts) {
    return apiPost({
      action: 'sale.create',
      ...(isObj(data) ? data : {})
    }, opts);
  },

  listSales(status = 'pending', include_items = false, limit = 200, cursor = '', opts) {
    return apiPost({
      action: 'sales.list',
      status: String(status ?? 'pending'),
      include_items: !!include_items,
      limit: Number.isFinite(limit) ? limit : 200,
      cursor: String(cursor ?? '')
    }, opts);
  },

  getSale(id, opts) {
    return apiPost({
      action: 'sale.get',
      id: String(id ?? '').trim()
    }, opts);
  },

  updateSaleStatus(id, status, opts) {
    return apiPost({
      action: 'sale.updateStatus',
      id: String(id ?? '').trim(),
      status: String(status ?? '').trim()
    }, opts);
  },

  /* DASHBOARD */
  dashboard(opts) {
    return apiPost({ action: 'dashboard.summary' }, opts);
  },
};
