'use strict';

/* ============================================================================
   api.js — Store API Client (CORS-proof for Apps Script)
   ------------------------------------------------------
   Objetivo real (2026, humanos…):
   ✅ Obtener idToken desde Firebase
   ✅ Evitar CORS/preflight (NO Authorization header, NO custom headers)
   ✅ Requests unificadas y robustas
   ✅ Manejo consistente de errores (Apps Script + JSON/text)
   ✅ Timeout + mensajes claros
   ✅ Shortcuts para endpoints (StoreAPI)

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

// Timeout para no quedarse colgado si Apps Script se queda pensando en su vida
const DEFAULT_TIMEOUT_MS = 25_000;

// En Apps Script, lo más estable es POST always.
// Si más adelante montas un backend real con CORS bien, puedes reactivar GET real.
const FORCE_POST = true;

// Token cache (evita refrescar token todo el tiempo)
let _tokenCache = { token: '', expMs: 0 };

/* =========================
   Utils
========================= */

const nowMs = () => Date.now();
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function safeJsonParse(s, fallback = null) {
  try { return JSON.parse(String(s)); } catch { return fallback; }
}

function makeRequestId() {
  // suficientemente único para logs sin meternos con crypto
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAbortError(err) {
  return err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('aborted'));
}

function normalizeApiError(data, fallbackMsg) {
  // Apps Script típico: { ok:false, error:"..." } o { message:"..." }
  if (isObj(data)) {
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.details === 'string' && data.details.trim()) return data.details.trim();
  }
  return fallbackMsg || 'Error desconocido API';
}

/* =========================
   Auth token
========================= */

async function getToken({ forceRefresh = false } = {}) {
  const user = FB.auth?.currentUser;
  if (!user) throw new Error('No hay sesión activa');

  // Cache corto para no spamear getIdToken
  if (!forceRefresh && _tokenCache.token && _tokenCache.expMs > nowMs()) {
    return _tokenCache.token;
  }

  // getIdToken(false) usa cache de Firebase si está vigente
  const token = await user.getIdToken(!!forceRefresh);
  if (!token) throw new Error('No se pudo obtener token de sesión');

  // Cache ~45s: suficiente para UX y reduce llamadas
  _tokenCache.token = token;
  _tokenCache.expMs = nowMs() + 45_000;
  return token;
}

/* =========================
   Networking (CORS-proof)
========================= */

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));

  try {
    // Nota: NO metemos headers para evitar preflight.
    // Body string => browser manda text/plain;charset=UTF-8 (bien para Apps Script)
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function readResponseJson(res) {
  // Apps Script a veces devuelve texto; intentamos JSON igual.
  const txt = await res.text().catch(() => '');

  // Si viene vacío, devolvemos algo estable
  if (!String(txt || '').trim()) {
    return { ok: false, error: 'Respuesta vacía del servidor', raw: txt };
  }

  const data = safeJsonParse(txt, null);
  if (data) return data;

  // Si no es JSON, devolvemos "pseudo-json"
  return { ok: false, error: 'Respuesta inválida del servidor', raw: txt };
}

/**
 * request()
 * - Evita preflight: NO headers custom, NO content-type application/json forzado.
 * - Pasa token en el body: { token, action, ... }
 * - Usa POST siempre (recomendado para Apps Script).
 *
 * Retorna el objeto "data" completo (incluye data.* que defina tu backend)
 */
async function request(action, payload = {}, opts = {}) {
  if (!API_BASE) throw new Error('API_BASE no configurado (STORE_CFG.API_BASE)');
  if (!action) throw new Error("request() requiere 'action'");

  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const forceRefreshToken = !!opts.forceRefreshToken;
  const requestId = opts.requestId || makeRequestId();

  // token (sin header)
  const token = await getToken({ forceRefresh: forceRefreshToken });

  // Body final
  const bodyObj = {
    action: String(action),
    token,
    requestId,
    ts: nowMs(),
    ...((isObj(payload) ? payload : {})),
  };

  const started = nowMs();

  let res;
  try {
    res = await fetchWithTimeout(API_BASE, {
      method: 'POST',
      body: JSON.stringify(bodyObj),
      // headers: NO (evita preflight)
    }, timeoutMs);
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(`Timeout (${timeoutMs} ms) hablando con el servidor`);
    }
    throw err;
  }

  const data = await readResponseJson(res);

  // Si HTTP no es ok, extraemos error útil del body si se puede
  if (!res.ok) {
    const msg = normalizeApiError(data, `HTTP ${res.status} (${res.statusText || 'error'})`);
    throw new Error(msg);
  }

  // Convención: ok === true
  if (!data || data.ok !== true) {
    const msg = normalizeApiError(data, 'Error desconocido API');
    throw new Error(msg);
  }

  // Adjuntamos metadatos útiles (sin romper nada: es un extra)
  // Si tu backend ya manda estos campos, no lo pisamos.
  if (isObj(data) && !data._meta) {
    data._meta = {
      requestId,
      ms: nowMs() - started,
    };
  }

  return data;
}

/* =========================
   Public API
========================= */

/**
 * apiGet:
 * - Mantiene firma para compatibilidad.
 * - Internamente usa POST (evita CORS).
 */
export async function apiGet(action, params = {}) {
  if (FORCE_POST) {
    return await request(action, { params: isObj(params) ? params : {} });
  }

  // GET real (NO recomendado en Apps Script si usas auth sin headers)
  // Lo dejo acá como “futuro”, pero bloqueado para que no haya llamadas inseguras.
  throw new Error('apiGet(GET real) deshabilitado por CORS. Usa POST.');
}

/**
 * apiPost:
 * - Igual que antes, pero robusto y CORS-proof.
 * - payload: { action:"...", ... }
 */
export async function apiPost(payload = {}) {
  if (!payload || !payload.action) throw new Error("apiPost requiere 'action'");

  const { action, ...rest } = payload;
  return await request(action, rest);
}

/* =========================
   Shortcuts (nivel pro)
   👉 para no repetir strings en app.js
========================= */

export const StoreAPI = {
  ping() {
    return apiPost({ action: 'ping' });
  },

  /* PRODUCTS */
  listProducts(q) {
    return apiPost({ action: 'products.list', q });
  },

  upsertProduct(product) {
    return apiPost({
      action: 'products.upsert',
      product
    });
  },

  setProductActive(id, active) {
    return apiPost({
      action: 'products.setActive',
      id,
      active
    });
  },

  /* INVENTORY */
  listInventory() {
    return apiPost({ action: 'inventory.list' });
  },

  adjustStock(data) {
    return apiPost({
      action: 'inventory.adjust',
      ...(isObj(data) ? data : {})
    });
  },

  /* SALES */
  createSale(data) {
    return apiPost({
      action: 'sale.create',
      ...(isObj(data) ? data : {})
    });
  },

  /* DASHBOARD */
  dashboard() {
    return apiPost({ action: 'dashboard.summary' });
  },
};
