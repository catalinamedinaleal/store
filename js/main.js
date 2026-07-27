'use strict';
/* =============================================================================
Musicala Store · main.js (GitHub Pages) — PRO++ v6.17

Mejoras sobre v6.16 (sin romper tu HTML/IDs):
✅ FIX: Cerrar modal ya NO “guarda” por accidente (submit solo si el submitter es el botón Guardar)
✅ Campo opcional “precio de competencia” (manual) sin romper nada:
   - Si existe un input con id p_competitor_price (o alias), lo lee/guarda
   - Si no existe, el sistema ignora el campo y sigue normal
✅ Catálogo: si hay precio de competencia, lo muestra discretamente en la sublínea
✅ Más null-safety y defensivo en delegación de eventos

Mantiene TODO:
- Lazy loading por tabs
- Refresh parcial por acción
- Restock PDF (jsPDF + autoTable)
- Orders server-first + fallback local
- Pricing helpers + auto ID productos
============================================================================= */

import { StoreAPI } from './firebase-store.js';
import { State } from './state.js';
import { STORE_CFG, ALLOWED_EMAILS } from './config.js';
import { FirebaseAuth, initFirebase } from './firebase.js';
import { Roles } from './roles.js';
import {
  DEFAULT_PRICING,
  normalizePricing,
  priceFromCost,
  marginFromCostPrice,
  describeTiers,
  describeRounding,
  tierWarnings,
  isPricingConfigured,
} from './pricing.js';
/* =========================
   CFG helpers (compat layer)
========================= */
function getCfg_(key, fallback = undefined) {
  const cfg =
    (globalThis.CFG && typeof globalThis.CFG === 'object' ? globalThis.CFG : null) ||
    STORE_CFG ||
    (window.STORE_CFG && typeof window.STORE_CFG === 'object' ? window.STORE_CFG : null) ||
    {};
  return (key in cfg) ? cfg[key] : fallback;
}
function getCfgBool_(key, fallback = false) {
  const v = getCfg_(key, fallback);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on', 'si', 'sí'].includes(s)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  }
  return !!v;
}
function getCfgNum_(key, fallback = 0) {
  const v = getCfg_(key, fallback);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function getCfgStr_(key, fallback = '') {
  const v = getCfg_(key, fallback);
  return (v === null || v === undefined) ? fallback : String(v);
}

globalThis.getCfg_ = globalThis.getCfg_ || getCfg_;
globalThis.getCfgBool_ = globalThis.getCfgBool_ || getCfgBool_;
globalThis.getCfgNum_ = globalThis.getCfgNum_ || getCfgNum_;
globalThis.getCfgStr_ = globalThis.getCfgStr_ || getCfgStr_;

/* =========================
   Product ID auto helpers
========================= */
function slug_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
}
function genProductId_({ name, category } = {}) {
  const base = slug_(name) || slug_(category) || 'prod';
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `${base}-${stamp}${rand}`;
}

/* =========================
   Tiny perf utils
========================= */
function rafBatch_(fn) {
  let raf = 0;
  return (...args) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn(...args);
    });
  };
}

/* =========================
   CSS.escape fallback (old browsers)
========================= */
function cssEscape_(s) {
  const str = String(s ?? '');
  try {
    if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(str);
  } catch {}
  return str.replace(/["\\]/g, '\\$&').replace(/\s/g, '\\ ');
}

/* Focus keeper: evita que un render te saque del input en el que estás */
function captureFocus_() {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement)) return null;

  const ds = a.dataset || {};
  const key =
    ds.restockQty ?? ds.restockCost ??
    ds.saleQty ?? ds.salePrice ??
    null;

  if (key === null) return null;

  return {
    key: String(key),
    type:
      (ds.restockQty !== undefined ? 'restockQty' :
      (ds.restockCost !== undefined ? 'restockCost' :
      (ds.saleQty !== undefined ? 'saleQty' :
      (ds.salePrice !== undefined ? 'salePrice' : '')))),
    selStart: (typeof a.selectionStart === 'number') ? a.selectionStart : null,
    selEnd: (typeof a.selectionEnd === 'number') ? a.selectionEnd : null,
  };
}
function restoreFocus_(snapshot) {
  if (!snapshot) return;
  const { key, type, selStart, selEnd } = snapshot;

  let q = null;
  if (type === 'restockQty') q = `input[data-restock-qty="${cssEscape_(key)}"]`;
  else if (type === 'restockCost') q = `input[data-restock-cost="${cssEscape_(key)}"]`;
  else if (type === 'saleQty') q = `input[data-sale-qty="${cssEscape_(key)}"]`;
  else if (type === 'salePrice') q = `input[data-sale-price="${cssEscape_(key)}"]`;

  if (!q) return;
  const el = document.querySelector(q);
  if (!(el instanceof HTMLInputElement)) return;

  el.focus({ preventScroll: true });
  if (selStart !== null && selEnd !== null) {
    try { el.setSelectionRange(selStart, selEnd); } catch {}
  }
}

/* =========================
   Boot
========================= */
export function boot() {
  // Anti doble-boot duro (por si el módulo se evalúa más de una vez)
  try {
    if (window.__STORE_APP_BOOTED_V617__) return;
    window.__STORE_APP_BOOTED_V617__ = true;
  } catch {}

  const CFG =
    STORE_CFG ||
    (window.STORE_CFG && typeof window.STORE_CFG === 'object' ? window.STORE_CFG : null) ||
    (globalThis.CFG && typeof globalThis.CFG === 'object' ? globalThis.CFG : null) ||
    {};


  /* =========================
     DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const on = (node, ev, fn, opts) => node && node.addEventListener(ev, fn, opts);

  // Para arreglar el “cierro y se guarda”: solo guardamos si el submitter fue el botón Guardar.
  function submitterId_(ev) {
    // submitter soportado en la mayoría de browsers modernos
    const s = ev?.submitter;
    if (s && s.id) return String(s.id);
    // fallback: si el activeElement es botón dentro del form
    const a = document.activeElement;
    if (a && a instanceof HTMLElement && a.id) return String(a.id);
    return '';
  }

  /* =========================
     Elements (NO invento IDs)
  ========================= */
  const el = {
    // views
    viewLoading: $('viewLoading'),
    viewAuth: $('viewAuth'),
    viewApp: $('viewApp'),

    // pills
    netPill: $('netPill'),
    netLabel: $('netLabel'),
    userPill: $('userPill'),
    userEmail: $('userEmail'),
    btnLogout: $('btnLogout'),

    // auth
    btnGoogle: $('btnGoogle'),
    authStatus: $('authStatus'),

    // app top
    btnRefresh: $('btnRefresh'),

    // KPIs
    kpiToday: $('kpiToday'),
    kpiProducts: $('kpiProducts'),
    kpiLowStock: $('kpiLowStock'),
    dashToday: $('dashToday'),
    lowStockBody: $('lowStockBody'),

    // tabs
    toast: $('toast'),
    tabs: $$('.tab'),

    // catalog
    qCatalog: $('qCatalog'),
    btnNewProduct: $('btnNewProduct'),
    catalogBody: $('catalogBody'),

    // inventory
    qInventory: $('qInventory'),
    btnAdjustStock: $('btnAdjustStock'),
    inventoryBody: $('inventoryBody'),

    // sales
    btnNewSale: $('btnNewSale'),
    salesEmpty: $('salesEmpty'),
    salePane: $('salePane'),
    saleSearch: $('saleSearch'),
    saleProductsList: $('saleProductsList'),
    btnAddToSale: $('btnAddToSale'),
    saleItemsBody: $('saleItemsBody'),
    saleTotal: $('saleTotal'),
    saleCustomer: $('saleCustomer'),
    salePay: $('salePay'),
    saleStatus: $('saleStatus'),
    saleInitialPayment: $('saleInitialPayment'),
    saleInitialPaymentField: $('saleInitialPaymentField'),
    saleNotes: $('saleNotes'),
    btnSaveSale: $('btnSaveSale'),
    btnCancelSale: $('btnCancelSale'),

    // orders
    btnRefreshOrders: $('btnRefreshOrders'),
    ordersBody: $('ordersBody'),
    ordersMeta: $('ordersMeta'),
    ordersPane: $('ordersPane'),
    ordersFilter: $('ordersFilter'),

    // sale detail modal
    modalSaleDetail: $('modalSaleDetail'),
    sd_id: $('sd_id'),
    sd_created: $('sd_created'),
    sd_customer: $('sd_customer'),
    sd_pay: $('sd_pay'),
    sd_notes: $('sd_notes'),
    sd_summary: $('sd_summary'),
    sd_itemsBody: $('sd_itemsBody'),
    sd_paymentsBody: $('sd_paymentsBody'),
    sd_addPaymentRow: $('sd_addPaymentRow'),
    sd_newPayment: $('sd_newPayment'),
    btnAddPaymentDetail: $('btnAddPaymentDetail'),
    btnSaveSaleDetail: $('btnSaveSaleDetail'),
    btnDeleteSale: $('btnDeleteSale'),

    // ✅ Interesados (leads)
    qLeads: $('qLeads'),
    onlyLeadsDue: $('onlyLeadsDue'),
    btnNewLead: $('btnNewLead'),
    leadsBody: $('leadsBody'),
    leadsBadge: $('leadsBadge'),
    modalLead: $('modalLead'),
    leadForm: $('leadForm'),
    leadTitle: $('leadTitle'),
    l_id: $('l_id'),
    l_name: $('l_name'),
    l_phone: $('l_phone'),
    l_product_query: $('l_product_query'),
    l_product_id: $('l_product_id'),
    l_product_hint: $('l_product_hint'),
    l_interest: $('l_interest'),
    l_next_contact: $('l_next_contact'),
    l_status: $('l_status'),
    l_notes: $('l_notes'),
    l_historyWrap: $('l_historyWrap'),
    l_historyBody: $('l_historyBody'),
    btnSaveLead: $('btnSaveLead'),
    btnDeleteLead: $('btnDeleteLead'),

    modalFollowUp: $('modalFollowUp'),
    fu_lead_id: $('fu_lead_id'),
    fu_who: $('fu_who'),
    fu_note: $('fu_note'),
    fu_next: $('fu_next'),
    btnSaveFollowUp: $('btnSaveFollowUp'),

    // moves
    qMoves: $('qMoves'),
    movesBody: $('movesBody'),

    // modals
    modalProduct: $('modalProduct'),
    productForm: $('productForm'),
    productTitle: $('productTitle'),
    btnSaveProduct: $('btnSaveProduct'),
    p_id: $('p_id'),
    p_active: $('p_active'),
    p_name: $('p_name'),
    p_brand: $('p_brand'),
    p_category: $('p_category'),
    p_sku: $('p_sku'),
    p_price: $('p_price'),
    p_margin: $('p_margin'),
    p_cost: $('p_cost'),
    p_desc: $('p_desc'),
    p_image: $('p_image'),

    // ✅ Nuevo opcional: precio de competencia (manual)
    // Si no existe en tu HTML, queda null y no molesta.
    p_competitor_price:
      $('p_competitor_price') ||
      $('p_comp_price') ||
      $('p_price_comp') ||
      $('p_competencia') ||
      $('p_precio_competencia') ||
      null,

    // ✅ Roles: campos y pistas del modal de producto
    f_margin: $('f_margin'),               // contenedor del % de ganancia (admin)
    f_comp: $('f_comp'),                   // contenedor del precio competencia (admin)
    p_cost_note: $('p_cost_note'),         // "sin costo registrado" / "solo admin ve el costo"
    p_price_hint: $('p_price_hint'),       // "precio sugerido automático"
    p_profit_note: $('p_profit_note'),     // utilidad estimada (admin)
    btnRecalcPrice: $('btnRecalcPrice'),

    // ✅ Roles: pill y regla de precios
    rolePill: $('rolePill'),
    btnPricingRules: $('btnPricingRules'),
    modalPricing: $('modalPricing'),
    pricingTiersBody: $('pricingTiersBody'),
    pricingRoundTo: $('pricingRoundTo'),
    pricingRoundMode: $('pricingRoundMode'),
    pricingPreviewCost: $('pricingPreviewCost'),
    pricingPreviewOut: $('pricingPreviewOut'),
    btnPricingAddTier: $('btnPricingAddTier'),
    btnSavePricing: $('btnSavePricing'),
    btnMigrateCosts: $('btnMigrateCosts'),
    pricingStatus: $('pricingStatus'),

    // ✅ Catálogo: filtro "sin precio"
    onlyMissingPrice: $('onlyMissingPrice'),

    // ✅ Dashboard admin (utilidades)
    dashProfitToday: $('dashProfitToday'),
    dashProfitTotal: $('dashProfitTotal'),
    dashProfitNote: $('dashProfitNote'),

    modalStock: $('modalStock'),
    stockForm: $('stockForm'),
    btnSaveStock: $('btnSaveStock'),
    s_product_query: $('s_product_query'),
    inventoryProductsList: $('inventoryProductsList'),
    stockProductPreview: $('stockProductPreview'),
    s_product_id: $('s_product_id'),
    s_mode: $('s_mode'),
    s_qty_label: $('s_qty_label'),
    s_type: $('s_type'),
    s_qty: $('s_qty'),
    s_ref: $('s_ref'),
    s_note: $('s_note'),

    modalInventoryMeta: $('modalInventoryMeta'),
    inventoryMetaPreview: $('inventoryMetaPreview'),
    im_product_id: $('im_product_id'),
    im_min_stock: $('im_min_stock'),
    im_location: $('im_location'),
    btnSaveInventoryMeta: $('btnSaveInventoryMeta'),

    // ✅ Restock
    btnRestockOpen: $('btnRestockOpen'),
    modalRestock: $('modalRestock'),
    restockSupplier: $('restockSupplier'),
    restockNotes: $('restockNotes'),
    restockBody: $('restockBody'),
    restockTotalUnits: $('restockTotalUnits'),
    restockTotalCost: $('restockTotalCost'),
    btnClearRestock: $('btnClearRestock'),
    btnPrintRestock: $('btnPrintRestock'),
    btnCloseRestock: $('btnCloseRestock'), // optional
  };

  /* =========================
     Sanity / Info
  ========================= */

  /* =========================
     Utils
  ========================= */
  const fmtCOP = (n) => {
    const v = Number.isFinite(n) ? n : 0;
    try {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
    } catch {
      return '$' + String(Math.round(v));
    }
  };

  const toInt = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
    const s = String(v).replace(/[^\d\-]/g, '').trim();
    if (!s) return 0;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  };

  const toFloat = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v).replace(/,/g, '.').replace(/[^\d\.\-]/g, '').trim();
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const roundInt = (n) => Math.round(Number.isFinite(n) ? n : 0);

  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function debounce(fn, ms = 180) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  function sleep_(ms) { return new Promise(r => setTimeout(r, ms)); }

  function normStatus_(s) {
    const x = String(s || '').toLowerCase().trim();
    if (!x) return 'pending';
    if (x === 'paid' || x === 'pending' || x === 'cancelled') return x;
    if (x === 'installments') return 'installments';
    if (x === 'pagado') return 'paid';
    if (x === 'pendiente') return 'pending';
    if (x === 'cancelado') return 'cancelled';
    return x;
  }

  function syncInstallmentFields_() {
    const isInstallment = el.saleStatus?.value === 'installments';
    if (el.saleInitialPaymentField) el.saleInitialPaymentField.hidden = !isInstallment;
    if (!isInstallment && el.saleInitialPayment) el.saleInitialPayment.value = '0';
  }

  function safeStr_(v, max = 4000) {
    const s = String(v ?? '').trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  function pickPriceCOP_(p) { return toInt(p?.price_cop ?? p?.price ?? p?.precio_cop ?? p?.precio); }
  function pickCostCOP_(p) { return toInt(p?.cost_cop ?? p?.cost ?? p?.costo_cop ?? p?.costo); }
  function pickCompetitorCOP_(p) {
    return toInt(
      p?.competitor_price_cop ??
      p?.competitor_price ??
      p?.precio_competencia ??
      p?.precio_competencia_cop ??
      p?.precioCompetencia ??
      p?.precioCompetenciaCOP
    );
  }

  /* Fecha y hora claras, en hora local (es-CO) */
  function fmtDatePart_(v) {
    const d = new Date(v);
    if (!v || isNaN(d)) return String(v || '—');
    try {
      return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(d);
    } catch { return d.toLocaleDateString(); }
  }
  function fmtTimePart_(v) {
    const d = new Date(v);
    if (!v || isNaN(d)) return '';
    try {
      return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    } catch { return d.toLocaleTimeString(); }
  }
  function fmtDateTime_(v) {
    const t = fmtTimePart_(v);
    return t ? `${fmtDatePart_(v)}, ${t}` : fmtDatePart_(v);
  }

  function nowLocalStamp_() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function restockDesc_(it) {
    const d = String(it?.desc || it?.description || '').trim();
    if (d) return d;
    const brand = String(it?.brand || '').trim();
    const sku = String(it?.sku || '').trim();
    const fallback = [brand, sku].filter(Boolean).join(' · ');
    return fallback || '—';
  }

  /* =========================
     Toast + fatal (NEEDED EARLY)
  ========================= */
  function toast(msg, ok = true) {
    if (!el.toast) return;
    el.toast.hidden = false;
    el.toast.textContent = String(msg || '');
    el.toast.classList.toggle('is-bad', !ok);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { if (el.toast) el.toast.hidden = true; }, 2600);
  }

  function setNet(ok, label) {
    if (!el.netLabel) return;
    el.netLabel.textContent = label || (ok ? 'Conectado' : 'Sin conexión');
    el.netPill?.classList.toggle('is-bad', !ok);
  }

  function fatal_(msg) {
    console.error('[STORE:FATAL]', msg);
    toast(msg, false);
    setNet(false, 'Error');
  }

  /* =========================
     View + Busy
  ========================= */
  function setView(name) {
    document.body.dataset.view = name;

    if (el.viewLoading) el.viewLoading.hidden = (name !== 'loading');
    if (el.viewAuth) el.viewAuth.hidden = (name !== 'auth');
    if (el.viewApp) el.viewApp.hidden = (name !== 'app');

    if (el.btnRestockOpen) el.btnRestockOpen.hidden = (name !== 'app');
  }

  /* =========================
     Firebase refs (AFTER fatal_)
  ========================= */
  const FB = FirebaseAuth;
  if (!FB || !FB.auth) {
    fatal_('Firebase no inicializado. Revisa index.html (__FB__).');
    setView('auth');
    return;
  }

  /* =========================
     Restock PDF behavior
  ========================= */
  const RESTOCK_PDF_HIDE_PRICES = getCfgBool_('RESTOCK_PDF_HIDE_PRICES', true);

  /* El PDF oculta precios por configuración y, además, siempre para quien no
     tenga permiso de ver costos. */
  function hideRestockPrices_() {
    return RESTOCK_PDF_HIDE_PRICES || !Roles.can('see_costs');
  }

  /* =========================
     Roles + regla de precios
     -------------------------
     - PRICING.settings: rangos de ganancia por costo (Firestore settings/pricing)
     - COSTS: costos por producto. Solo se carga si el usuario es admin;
       para asesoras Firestore rechaza la lectura y el mapa queda vacío.
  ========================= */
  const PRICING = {
    settings: normalizePricing(DEFAULT_PRICING), // sin rangos hasta que Firestore responda
    draft: null,                                 // borrador del modal (no toca settings hasta guardar)
    loaded: false,
    inflight: null,
  };

  function pricingReady_() { return isPricingConfigured(PRICING.settings); }

  const COSTS = {
    map: new Map(),   // product_id -> { cost_cop, competitor_price_cop, margin_pct }
    loaded: false,
    inflight: null,
  };

  async function ensurePricingLoaded_(force = false) {
    if (!force && PRICING.loaded) return PRICING.settings;
    if (PRICING.inflight) return PRICING.inflight;

    PRICING.inflight = (async () => {
      try {
        const res = await StoreAPI.getPricingSettings();
        PRICING.settings = normalizePricing(res?.settings || DEFAULT_PRICING);
      } catch {
        // Sin documento o sin permisos: seguimos con la regla por defecto.
        PRICING.settings = normalizePricing(DEFAULT_PRICING);
      }
      PRICING.loaded = true;
      return PRICING.settings;
    })().finally(() => { PRICING.inflight = null; });

    return PRICING.inflight;
  }

  async function ensureCostsLoaded_(force = false) {
    if (!Roles.can('see_costs')) { COSTS.map = new Map(); COSTS.loaded = true; return COSTS.map; }
    if (!force && COSTS.loaded) return COSTS.map;
    if (COSTS.inflight) return COSTS.inflight;

    COSTS.inflight = (async () => {
      try {
        const res = await StoreAPI.listProductCosts();
        const m = new Map();
        for (const c of (res?.items || [])) {
          const pid = String(c.product_id || c.id || '').trim();
          if (pid) m.set(pid, c);
        }
        COSTS.map = m;
      } catch {
        COSTS.map = new Map();
      }
      COSTS.loaded = true;
      return COSTS.map;
    })().finally(() => { COSTS.inflight = null; });

    return COSTS.inflight;
  }

  function costFor_(productId) {
    const c = COSTS.map.get(String(productId || '').trim());
    return c ? toInt(c.cost_cop) : 0;
  }

  function competitorFor_(productId) {
    const c = COSTS.map.get(String(productId || '').trim());
    return c ? toInt(c.competitor_price_cop) : 0;
  }

  /* Precio de venta sugerido a partir del costo del proveedor. */
  function suggestPrice_(cost) {
    return priceFromCost(cost, PRICING.settings);
  }

  /* Muestra/oculta todo lo marcado como data-role="admin" en el HTML. */
  function applyRoleUI_() {
    const admin = Roles.isAdmin();

    $$('[data-role="admin"]').forEach((node) => {
      if (!node || node === document.body) return; // nunca ocultar la página entera
      node.hidden = !admin;
    });

    if (el.rolePill) {
      el.rolePill.textContent = Roles.label();
      el.rolePill.hidden = !Roles.isStaff();
    }

    // La asesora nunca escribe el precio a mano: sale del costo.
    if (el.p_price) {
      const locked = !Roles.can('override_price');
      el.p_price.readOnly = locked;
      el.p_price.classList.toggle('is-locked', locked);
    }

    // Si estaba parada en una pestaña que ya no le corresponde, la devolvemos.
    if (!admin && currentTab_() === 'dashboard') showTab('catalog');
  }

  /* =========================
     Token / API plumbing
  ========================= */
  function getToken_() {
    const st = State.get();
    return String(st?.idToken || '');
  }

  async function apiPostAuthed_(payload) {
    const p = payload || {};
    if (p.action === 'sales.list') return StoreAPI.listSales(p.status, p.include_items, p.limit);
    if (p.action === 'sale.get') return StoreAPI.getSale(p.id);
    if (p.action === 'sale.create') return StoreAPI.createSale({ sale: p.sale, items: p.items });
    if (p.action === 'sale.updateStatus') return StoreAPI.updateSaleStatus(p.id, p.status);
    throw new Error(`Acción Firebase no soportada: ${p.action || ''}`);
  }

  function setStoreApiToken_(token) {
    try {
      if (StoreAPI && typeof StoreAPI.setToken === 'function') StoreAPI.setToken(token || '');
    } catch {}
  }

  /* =========================
     Busy overlay (dialog)
  ========================= */
  let BUSY_DLG = null;

  function ensureBusyDialog_() {
    if (BUSY_DLG) return BUSY_DLG;

    const d = document.createElement('dialog');
    d.setAttribute('aria-label', 'Procesando');
    d.style.border = '0';
    d.style.padding = '0';
    d.style.background = 'transparent';
    d.style.maxWidth = 'min(520px, 92vw)';
    d.style.width = 'min(520px, 92vw)';
    d.style.margin = '0';
    d.style.borderRadius = '18px';
    d.style.boxShadow = '0 18px 60px rgba(11,16,32,.18)';
    d.style.overflow = 'visible';

    const card = document.createElement('div');
    card.style.background = 'rgba(255,255,255,.92)';
    card.style.backdropFilter = 'blur(10px)';
    card.style.border = '1px solid rgba(11,16,32,.10)';
    card.style.borderRadius = '18px';
    card.style.padding = '14px 16px';
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.gap = '12px';

    const spin = document.createElement('div');
    spin.style.width = '18px';
    spin.style.height = '18px';
    spin.style.borderRadius = '999px';
    spin.style.border = '2px solid rgba(11,16,32,.18)';
    spin.style.borderTopColor = 'rgba(11,16,32,.60)';
    spin.style.animation = 'storeSpin 0.8s linear infinite';

    const txt = document.createElement('div');
    txt.className = 'mono';
    txt.style.fontSize = '14px';
    txt.style.color = 'rgba(11,16,32,.86)';
    txt.textContent = 'Procesando…';

    const sub = document.createElement('div');
    sub.style.marginLeft = 'auto';
    sub.style.fontSize = '12px';
    sub.style.color = 'rgba(11,16,32,.55)';
    sub.textContent = 'No cierres esto 🙃';

    card.appendChild(spin);
    card.appendChild(txt);
    card.appendChild(sub);
    d.appendChild(card);
    document.body.appendChild(d);

    const st = document.createElement('style');
    st.textContent = `
      @keyframes storeSpin { to { transform: rotate(360deg); } }
      dialog::backdrop{ background: rgba(11,16,32,.18); backdrop-filter: blur(2px); }
    `;
    document.head.appendChild(st);

    BUSY_DLG = d;
    BUSY_DLG._textEl = txt;

    d.addEventListener('cancel', (ev) => { if (State.get()?.busy) ev.preventDefault(); });

    return BUSY_DLG;
  }

  function busyShow(msg = 'Procesando…') {
    const d = ensureBusyDialog_();
    if (d._textEl) d._textEl.textContent = msg;
    if (!d.open) d.showModal();
  }
  function busyHide() {
    if (BUSY_DLG && BUSY_DLG.open) BUSY_DLG.close();
  }

  function setBusy_(onFlag = true, msg = 'Procesando…') {
    State.setBusy(!!onFlag);

    const dis = !!onFlag;
    if (el.btnRefresh) el.btnRefresh.disabled = dis;
    if (el.btnNewProduct) el.btnNewProduct.disabled = dis;
    if (el.btnAdjustStock) el.btnAdjustStock.disabled = dis;
    if (el.btnNewSale) el.btnNewSale.disabled = dis;
    if (el.btnSaveSale) el.btnSaveSale.disabled = dis;
    if (el.btnSaveProduct) el.btnSaveProduct.disabled = dis;
    if (el.btnSaveStock) el.btnSaveStock.disabled = dis;
    if (el.btnSaveInventoryMeta) el.btnSaveInventoryMeta.disabled = dis;
    if (el.btnRefreshOrders) el.btnRefreshOrders.disabled = dis;
    if (el.btnLogout) el.btnLogout.disabled = dis;
    if (el.btnPrintRestock) el.btnPrintRestock.disabled = dis;
    if (el.btnClearRestock) el.btnClearRestock.disabled = dis;

    if (onFlag) busyShow(msg);
    else busyHide();
  }

  /* =========================
     Auth flows
  ========================= */
  async function loginGoogle_() {
    await FB.signInWithPopup(FB.auth, FB.googleProvider);
  }
  async function logout_() {
    await FB.signOut(FB.auth);
  }

  /* =========================
     Tabs (tolerantes)
  ========================= */
  const TAB_IDS = ['catalog', 'inventory', 'sales', 'leads', 'moves', 'dashboard', 'restock'];

  function tabSection_(name) {
    return $('tab-' + name);
  }

  function currentTab_() {
    const st = State.get();
    const t = String(st.tab || '').trim();
    return TAB_IDS.includes(t) ? t : 'catalog';
  }

  let RENDER_GUARD = 0;

  function showTab(tabName) {
    let next = TAB_IDS.includes(tabName) ? tabName : 'catalog';

    // Dashboard = ganancias. Solo admin.
    if (next === 'dashboard' && !Roles.can('see_dashboard')) next = 'catalog';

    const prev = currentTab_();

    if (prev === next) {
      renderActive_();
      return;
    }

    State.setTab(next);

    if (Array.isArray(el.tabs) && el.tabs.length) {
      el.tabs.forEach(btn => {
        const t = btn?.dataset?.tab;
        if (!t) return;
        btn.classList.toggle('is-active', t === next);
      });
    }

    TAB_IDS.forEach(n => {
      const sec = tabSection_(n);
      if (sec) sec.hidden = (n !== next);
    });

    const after = () => renderActive_();

    if (next === 'catalog') ensureProductsLoaded_().finally(after);
    else if (next === 'inventory') Promise.all([
      ensureProductsLoaded_(),
      ensureInventoryLoaded_(),
    ]).then(() => buildInventoryProductDatalist_()).finally(after);
    else if (next === 'sales') ensureProductsLoaded_().finally(() => { syncSalesUI_(); after(); });
    else if (next === 'leads') Promise.all([
      ensureProductsLoaded_().catch(() => {}),
      ensureLeadsLoaded_().catch(() => {}),
    ]).finally(after);
    else if (next === 'moves') { after(); loadMoves_(State.get().movesQuery || ''); }
    else if (next === 'restock') ensureProductsLoaded_().finally(after);
    else if (next === 'dashboard') ensureDashboardLoaded_().finally(after);
    else after();
  }

  /* =========================
     Sales UI sync
  ========================= */
  function syncSalesUI_() {
    const st = State.get();
    const isOpen = !!st.saleOpen;
    const hasOrders = Array.isArray(st.orders) && st.orders.length > 0;

    if (el.salePane) el.salePane.hidden = !isOpen;
    if (el.salesEmpty) el.salesEmpty.hidden = isOpen || hasOrders;

    if (el.ordersPane) el.ordersPane.hidden = false;
  }

  /* =========================
     Local orders fallback
  ========================= */
  const ORDERS_KEY = 'store_pending_orders_v2';

  function readLocalOrders_() {
    try {
      const raw = localStorage.getItem(ORDERS_KEY);
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function writeLocalOrders_(arr) {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(Array.isArray(arr) ? arr : [])); }
    catch {}
  }

  /* =========================
     Orders: server first
  ========================= */
  async function loadOrders_() {
    try {
      const res = await StoreAPI.listSales('all', false, 500);
      const items = (res.items || []).filter(x => normStatus_(x.status) !== 'cancelled');

      const orders = items.map(x => ({
        id: String(x.id || '').trim(),
        created_at: x.created_at || '',
        customer_id: x.customer_id || '',
        payment_method: x.payment_method || '',
        total_cop: toInt(x.total_cop),
        notes: x.notes || '',
        status: normStatus_(x.status || 'pending'),
        paid_cop: toInt(x.paid_cop),
        balance_cop: toInt(x.balance_cop),
        posted: !!x.posted,
        source: 'api',
        items: null,
      })).filter(o => o.id);

      State.setOrders(orders);
      State.set({ ordersSource: 'api', ordersHydrated: false }, { data: true });
      return;
    } catch {
      const local = readLocalOrders_();
      State.setOrders(local);
      State.set({ ordersSource: 'local', ordersHydrated: true }, { data: true });
    }
  }

  function ordersFilterValue_() {
    const v = String(el.ordersFilter?.value || 'open');
    return ['open', 'paid', 'all'].includes(v) ? v : 'open';
  }

  function renderOrders_() {
    if (!el.ordersBody) return;

    const st = State.get();
    const all = Array.isArray(st.orders) ? st.orders : [];
    const filter = ordersFilterValue_();
    const rows = all.filter(o => {
      const s = normStatus_(o.status);
      if (filter === 'open') return s === 'pending' || s === 'installments';
      if (filter === 'paid') return s === 'paid';
      return true;
    });

    if (!rows.length) {
      el.ordersBody.innerHTML = `<tr><td colspan="5" class="muted">No hay ventas en este filtro.</td></tr>`;
      if (el.ordersMeta) {
        el.ordersMeta.textContent = (st.ordersSource === 'api')
          ? 'Fuente: servidor'
          : 'Fuente: local (este dispositivo)';
      }
      syncSalesUI_();
      return;
    }

    const sorted = rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    el.ordersBody.innerHTML = sorted.map(o => {
      const cust = String(o.customer_id || '').trim() || '—';
      const total = fmtCOP(toInt(o.total_cop));
      const notes = String(o.notes || '').trim();
      const status = normStatus_(o.status);
      const isApi = st.ordersSource === 'api';

      const oid = escapeHtml(String(o.id || ''));
      const balance = toInt(o.balance_cop);

      const openBtn = (status !== 'paid')
        ? `<button class="btn btn--tiny btn--ghost" data-order-open="${oid}">Abrir</button>` : '';
      const payBtn = status === 'installments'
        ? `<button class="btn btn--tiny btn--primary" data-order-payment="${oid}">Abonar</button>`
        : (status === 'pending'
          ? `<button class="btn btn--tiny btn--primary" data-order-pay="${oid}">Marcar pagado</button>`
          : '');
      const detailBtn = isApi
        ? `<button class="btn btn--tiny btn--ghost" data-order-detail="${oid}">✏️ Editar</button>` : '';
      const delBtn = isApi
        ? `<button class="btn btn--tiny btn--ghost" data-order-delete="${oid}" title="Eliminar venta" style="color:#b42318;">Eliminar</button>`
        : `<button class="btn btn--tiny btn--ghost" data-order-del="${oid}">Eliminar</button>`;

      const statusLine = status === 'installments'
        ? `<span class="orderBalance">Saldo: ${escapeHtml(fmtCOP(balance))}</span>`
        : (status === 'paid'
          ? `<span class="orderStatus">Pagada ✅</span>`
          : `<span class="orderStatus">Pedido por confirmar</span>`);

      return `
        <tr>
          <td class="tiny">
            <div>${escapeHtml(fmtDatePart_(o.created_at))}</div>
            <div class="muted mono">${escapeHtml(fmtTimePart_(o.created_at))}</div>
          </td>
          <td>${escapeHtml(cust)}</td>
          <td class="num mono">${escapeHtml(total)}</td>
          <td class="tiny">${escapeHtml(notes)}${notes ? '<br>' : ''}${statusLine}</td>
          <td class="num" style="white-space:nowrap;">
            <div class="row" style="gap:8px; justify-content:flex-end;">
              ${openBtn}
              ${payBtn}
              ${detailBtn}
              ${delBtn}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (el.ordersMeta) {
      el.ordersMeta.textContent = (st.ordersSource === 'api')
        ? `Fuente: servidor · ${rows.length} venta(s) en este filtro`
        : `Fuente: local (este dispositivo) · ${rows.length} pedido(s)`;
    }

    syncSalesUI_();
  }

  function findLocalOrderById_(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const arr = readLocalOrders_();
    return arr.find(o => String(o.id || '').trim() === key) || null;
  }

  function removeLocalOrder_(id) {
    const key = String(id || '').trim();
    const arr = readLocalOrders_().filter(o => String(o.id || '').trim() !== key);
    writeLocalOrders_(arr);
    State.setOrders(arr);
    State.set({ ordersSource: 'local' }, { data: true });
    syncSalesUI_();
  }

  async function hydrateOrderFromServer_(id) {
    const key = String(id || '').trim();
    if (!key) throw new Error('ID inválido');

    const res = await apiPostAuthed_({ action: 'sale.get', id: key });
    const sale = res.sale || {};
    const items = Array.isArray(res.items) ? res.items : [];

    return {
      id: String(sale.id || key).trim(),
      created_at: sale.created_at || '',
      customer_id: sale.customer_id || '',
      payment_method: sale.payment_method || '',
      total_cop: toInt(sale.total_cop),
      notes: sale.notes || '',
      status: normStatus_(sale.status || 'pending'),
      posted: !!sale.posted,
      source: 'api',
      items: items.map(it => ({
        product_id: String(it.product_id || '').trim(),
        qty: toInt(it.qty),
        unit_price: toInt(it.unit_price),
        subtotal: toInt(it.subtotal),
      })).filter(x => x.product_id && x.qty > 0),
    };
  }

  function openOrderAsSale_(order, forceStatus) {
    if (!order || !Array.isArray(order.items) || !order.items.length) {
      toast('Ese pedido no tiene detalle para reabrir', false);
      return;
    }

    const idx = State.productsIndex();
    State.openSale();

    if (el.saleCustomer) el.saleCustomer.value = String(order.customer_id || '').trim();
    if (el.salePay) el.salePay.value = String(order.payment_method || 'cash').trim() || 'cash';
    if (el.saleNotes) el.saleNotes.value = String(order.notes || '').trim();
    if (el.saleStatus) el.saleStatus.value = String(forceStatus || order.status || 'pending').trim();

    const items = order.items.map(it => {
      const pid = String(it.product_id || '').trim();
      const p = idx.get(pid);
      return {
        product_id: pid,
        name: String(p?.name || pid),
        qty: Math.max(1, toInt(it.qty)),
        unit_price: Math.max(0, toInt(it.unit_price ?? pickPriceCOP_(p) ?? 0)),
      };
    }).filter(x => x.product_id);

    State.setSaleItems(items);
    scheduleSaleRender_();
    syncSalesUI_();
    toast('Pedido cargado en la venta ✅', true);
  }

  async function openOrder_(id) {
    const key = String(id || '').trim();
    if (!key) return;

    await ensureProductsLoaded_().catch(() => {});

    setBusy_(true, 'Cargando pedido…');
    try {
      const st = State.get();
      if (st.ordersSource === 'api') {
        const full = await hydrateOrderFromServer_(key);
        openOrderAsSale_(full, 'pending');
      } else {
        const o = findLocalOrderById_(key);
        if (!o) { toast('No encontré ese pedido', false); return; }
        openOrderAsSale_(o, 'pending');
      }
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Dashboard retry
  ========================= */
  async function loadDashboardWithRetry_() {
    try {
      return await StoreAPI.dashboard();
    } catch {
      await sleep_(350);
      try { return await StoreAPI.dashboard(); } catch { return null; }
    }
  }

  /* =========================
     PERF: Lazy loaders + refresh parcial
  ========================= */
  const LOAD = {
    productsInflight: null,
    inventoryInflight: null,
    dashboardInflight: null,
    ordersInflight: null,
    productsLoadedAt: 0,
    inventoryLoadedAt: 0,
    dashboardLoadedAt: 0,
    ordersLoadedAt: 0,
    productsSig: '',
  };

  function markSync_() {
    State.setLastSync(new Date().toISOString());
  }

  function productsSignature_(items) {
    const arr = Array.isArray(items) ? items : [];
    const parts = [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p) continue;
      const id = String(p.id || '');
      const name = String(p.name || '');
      const active = (p.active !== false) ? '1' : '0';
      parts.push(id + '|' + name + '|' + active);
      if (parts.length > 600) break;
    }
    return String(arr.length) + '::' + parts.join('~');
  }

  async function ensureProductsLoaded_(force = false) {
    const st = State.get();
    const has = Array.isArray(st.products) && st.products.length > 0;

    if (!force && has) {
      // Productos desde caché: los datalists de búsqueda pueden estar vacíos aún
      if (el.saleProductsList && !el.saleProductsList.children.length) buildSaleDatalist_();
      if (el.inventoryProductsList && !el.inventoryProductsList.children.length) buildInventoryProductDatalist_();
      return;
    }
    if (LOAD.productsInflight) return LOAD.productsInflight;

    LOAD.productsInflight = (async () => {
      const res = await StoreAPI.listProducts('');
      const items = Array.isArray(res?.items) ? res.items : [];
      State.setProducts(items);

      const sig = productsSignature_(items);
      if (sig !== LOAD.productsSig) {
        LOAD.productsSig = sig;
        buildSaleDatalist_();
        buildInventoryProductDatalist_();
      }

      LOAD.productsLoadedAt = Date.now();
    })().finally(() => { LOAD.productsInflight = null; });

    return LOAD.productsInflight;
  }

  async function ensureInventoryLoaded_(force = false) {
    const st = State.get();
    const has = Array.isArray(st.inventory) && st.inventory.length > 0;

    if (!force && has) return;
    if (LOAD.inventoryInflight) return LOAD.inventoryInflight;

    LOAD.inventoryInflight = (async () => {
      const res = await StoreAPI.listInventory();
      State.setInventory(Array.isArray(res?.items) ? res.items : []);
      buildInventoryProductDatalist_();
      LOAD.inventoryLoadedAt = Date.now();
    })().finally(() => { LOAD.inventoryInflight = null; });

    return LOAD.inventoryInflight;
  }

  async function ensureDashboardLoaded_(force = false) {
    const st = State.get();
    const has = !!st.dashboard;

    if (!force && has) return;
    if (LOAD.dashboardInflight) return LOAD.dashboardInflight;

    LOAD.dashboardInflight = (async () => {
      const d = await loadDashboardWithRetry_();
      State.setDashboard(d || null);
      // Utilidades (admin): se salta solo si el rol no puede verlas.
      await ensureProfitLoaded_(true).catch(() => {});
      LOAD.dashboardLoadedAt = Date.now();
    })().finally(() => { LOAD.dashboardInflight = null; });

    return LOAD.dashboardInflight;
  }

  async function ensureOrdersLoaded_(force = false) {
    const st = State.get();
    if (!force && st.ordersLoadedOnce) return;
    if (LOAD.ordersInflight) return LOAD.ordersInflight;

    LOAD.ordersInflight = (async () => {
      await loadOrders_().catch(() => {});
      State.set({ ordersLoadedOnce: true }, { sys: true });
      LOAD.ordersLoadedAt = Date.now();
    })().finally(() => { LOAD.ordersInflight = null; });

    return LOAD.ordersInflight;
  }

  async function refreshAfterSale_() {
    await Promise.allSettled([
      ensureOrdersLoaded_(true),
      ensureInventoryLoaded_(true),
      ensureDashboardLoaded_(true),
    ]);
    markSync_();
    renderActive_();
  }

  async function refreshAfterStock_() {
    await Promise.allSettled([
      ensureInventoryLoaded_(true),
      ensureDashboardLoaded_(true),
    ]);
    markSync_();
    renderActive_();
  }

  async function refreshAfterProductChange_() {
    await Promise.allSettled([
      ensureProductsLoaded_(true),
      ensureCostsLoaded_(true),
      ensureDashboardLoaded_(true),
    ]);
    markSync_();
    renderActive_();
  }

  async function refreshAfterOrderPaid_() {
    await Promise.allSettled([
      ensureOrdersLoaded_(true),
      ensureInventoryLoaded_(true),
      ensureDashboardLoaded_(true),
    ]);
    markSync_();
    renderActive_();
  }

  /* =========================
     Full load (solo manual refresh o login)
  ========================= */
  async function loadAll_(opts = {}) {
    const force = !!opts.force;
    setBusy_(true, 'Cargando…');
    setNet(true, 'Cargando…');

    try {
      await ensureOrdersLoaded_(force).catch(() => {});
      renderOrders_();
      syncSalesUI_();

      const tab = currentTab_();
      const wantsProducts = ['catalog', 'sales', 'restock'].includes(tab);
      const wantsInventory = ['inventory', 'dashboard'].includes(tab);

      // Los interesados se cargan siempre: el contador de la pestaña ("por
      // contactar") debe estar bien aunque no estés parada en esa sección.
      const tasks = [ensureDashboardLoaded_(force), ensurePricingLoaded_(force), ensureLeadsLoaded_(force)];
      if (wantsProducts) tasks.push(ensureProductsLoaded_(force), ensureCostsLoaded_(force));
      if (wantsInventory) tasks.push(ensureInventoryLoaded_(force));

      await Promise.allSettled(tasks);

      markSync_();
      renderActive_();
      setNet(true, 'Conectado');
    } catch (e) {
      fatal_(e?.message || String(e));
      setNet(false, 'API error');
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     PERF: Render only active tab
  ========================= */
  function renderActive_() {
    const my = ++RENDER_GUARD;
    Promise.resolve().then(() => {
      if (my !== RENDER_GUARD) return;

      renderKPIs_();

      renderLeadsBadge_();

      const tab = currentTab_();
      if (tab === 'catalog') renderCatalog_();
      else if (tab === 'inventory') renderInventory_();
      else if (tab === 'dashboard') renderDashboard_();
      else if (tab === 'sales') { renderOrders_(); scheduleSaleRender_(); syncSalesUI_(); }
      else if (tab === 'leads') renderLeads_();
      else if (tab === 'moves') renderMoves_();
      else if (tab === 'restock') scheduleRestockRender_();
    });
  }

  function renderKPIs_() {
    const st = State.get();
    const dash = st.dashboard || {};
    const productsCount = (st.products || []).length;
    const low = (dash.low_stock || []).length;

    if (el.kpiToday) el.kpiToday.textContent = st.dashboard ? fmtCOP(toInt(dash.today_total_cop)) : '—';
    if (el.kpiProducts) el.kpiProducts.textContent = String(productsCount || 0);
    if (el.kpiLowStock) el.kpiLowStock.textContent = st.dashboard ? String(low) : '—';
    if (el.dashToday) el.dashToday.textContent = st.dashboard ? fmtCOP(toInt(dash.today_total_cop)) : '—';
  }

  /* Utilidades: solo admin (necesita leer productCosts). */
  const PROFIT = { data: null, loaded: false, inflight: null };

  async function ensureProfitLoaded_(force = false) {
    if (!Roles.can('see_profit')) { PROFIT.data = null; return null; }
    if (!force && PROFIT.loaded) return PROFIT.data;
    if (PROFIT.inflight) return PROFIT.inflight;

    PROFIT.inflight = (async () => {
      try { PROFIT.data = await StoreAPI.profitReport(); }
      catch { PROFIT.data = null; }
      PROFIT.loaded = true;
      return PROFIT.data;
    })().finally(() => { PROFIT.inflight = null; });

    return PROFIT.inflight;
  }

  function renderProfit_() {
    if (!Roles.can('see_profit')) return;
    const p = PROFIT.data;

    if (el.dashProfitToday) el.dashProfitToday.textContent = p ? fmtCOP(toInt(p.profit_today_cop)) : '—';
    if (el.dashProfitTotal) el.dashProfitTotal.textContent = p ? fmtCOP(toInt(p.profit_cop)) : '—';

    if (el.dashProfitNote) {
      if (!p) {
        el.dashProfitNote.textContent = 'Sin datos de utilidad todavía.';
      } else if (toInt(p.units_without_cost) > 0) {
        el.dashProfitNote.textContent = `Ojo: ${toInt(p.units_without_cost)} unidad(es) vendidas sin costo registrado. La utilidad real es menor a la mostrada.`;
      } else {
        el.dashProfitNote.textContent = 'Calculado sobre ventas pagadas, precio de venta menos costo del proveedor.';
      }
    }
  }

  function renderDashboard_() {
    renderProfit_();
    if (!el.lowStockBody) return;

    const dash = State.get().dashboard || null;

    if (!dash) {
      el.lowStockBody.innerHTML = `<tr><td colspan="3" class="muted">—</td></tr>`;
      return;
    }

    const rows = (dash.low_stock || []);
    if (!rows.length) {
      el.lowStockBody.innerHTML = `<tr><td colspan="3" class="muted">Sin alertas 🎉</td></tr>`;
      return;
    }

    el.lowStockBody.innerHTML = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.name || r.id)}</td>
        <td class="num mono">${toInt(r.stock)}</td>
        <td class="num mono">${toInt(r.min_stock)}</td>
      </tr>
    `).join('');
  }

  function renderCatalog_() {
    if (!el.catalogBody) return;

    const st = State.get();
    const rawQ = el.qCatalog?.value || '';
    const q = String(rawQ).toLowerCase().trim();

    const showCosts = Roles.can('see_costs');
    const colCount = 7 + (showCosts ? 2 : 0);

    const src = Array.isArray(st.products) ? st.products : [];
    let list = q
      ? src.filter(p => p && (
          String(p.id || '').toLowerCase().includes(q) ||
          String(p.name || '').toLowerCase().includes(q) ||
          String(p.brand || '').toLowerCase().includes(q) ||
          String(p.category || '').toLowerCase().includes(q) ||
          String(p.sku || '').toLowerCase().includes(q)
        ))
      : src;

    // ✅ Filtro "solo pendientes": lo que aún no tiene precio o no tiene costo.
    if (el.onlyMissingPrice?.checked) {
      list = list.filter(p => !pickPriceCOP_(p) || !(p?.has_cost || pickCostCOP_(p) > 0));
    }

    if (!list.length) {
      el.catalogBody.innerHTML = `<tr><td colspan="${colCount}" class="muted">No hay resultados.</td></tr>`;
      return;
    }

    el.catalogBody.innerHTML = list.map(p => {
      const active = (p.active !== false);
      const badge = active
        ? `<span class="badge">Activo</span>`
        : `<span class="badge badge--off">Oculto</span>`;

      const stock = toInt(p.stock);
      const minStock = toInt(p.min_stock);
      const stockBadge = (minStock > 0 && stock <= minStock)
        ? `<span class="badge badge--warn">Bajo</span>`
        : '';

      const price = pickPriceCOP_(p);
      const pid = String(p.id || '').trim();
      const cost = showCosts ? (costFor_(pid) || pickCostCOP_(p)) : 0;
      const hasCost = !!p.has_cost || pickCostCOP_(p) > 0 || cost > 0;

      // ✅ Precio de competencia: solo admin
      const comp = Roles.can('see_competitor') ? (competitorFor_(pid) || pickCompetitorCOP_(p)) : 0;
      const compLine = comp > 0 ? ` · <span class="mono">Comp:</span> <span class="mono">${escapeHtml(fmtCOP(comp))}</span>` : '';
      const desc = String(p.desc || p.description || '').trim();
      const sku = String(p.sku || '').trim();
      const internalId = String(p.id || '').trim();
      const productMeta = [
        desc,
        sku ? `SKU: ${sku}` : (internalId ? `ID interno: ${internalId}` : ''),
      ].filter(Boolean).join(' · ');

      const restockBtn = `<button class="btn btn--tiny btn--ghost" data-act="restock_add" data-id="${escapeHtml(p.id)}">Restock</button>`;

      // Lo que la asesora necesita ver de un vistazo: qué falta por precificar.
      const priceCell = price > 0
        ? fmtCOP(price)
        : `<span class="badge badge--warn">Sin precio</span>`;
      const missingCostBadge = (!hasCost && price > 0)
        ? ` <span class="badge badge--warn" title="Falta registrar el costo del proveedor">Sin costo</span>`
        : '';

      const costCells = showCosts
        ? `<td class="num mono">${cost > 0 ? fmtCOP(cost) : '—'}</td>
           <td class="num mono">${(cost > 0 && price > 0) ? fmtCOP(Math.max(0, price - cost)) : '—'}</td>`
        : '';

      return `
        <tr>
          <td>
            <div class="cellTitle">${escapeHtml(p.name || '')}</div>
            <div class="cellSub muted tiny">
              ${escapeHtml(productMeta)}${compLine}
            </div>
          </td>
          <td>${escapeHtml(p.brand || '')}</td>
          <td>${escapeHtml(p.category || '')}</td>
          <td class="num mono">${priceCell}${missingCostBadge}</td>
          ${costCells}
          <td class="num mono">${toInt(stock)} ${stockBadge}</td>
          <td>${badge}</td>
          <td class="num actionsCell">
            <button class="btn btn--tiny btn--ghost" data-act="edit" data-id="${escapeHtml(p.id)}">Editar</button>
            <button class="btn btn--tiny btn--ghost" data-act="toggle" data-id="${escapeHtml(p.id)}" data-active="${active ? '1' : '0'}">
              ${active ? 'Ocultar' : 'Activar'}
            </button>
            ${restockBtn}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderInventory_() {
    if (!el.inventoryBody) return;

    const st = State.get();
    const idx = State.productsIndex();

    const rawQ = el.qInventory?.value || '';
    const q = String(rawQ).toLowerCase().trim();

    const src = Array.isArray(st.inventory) ? st.inventory : [];
    const list = q
      ? src.filter(r => {
          const pid = String(r?.product_id || '').toLowerCase();
          const p = idx.get(String(r?.product_id || '').trim());
          const name = String(p?.name || '').toLowerCase();
          const brand = String(p?.brand || '').toLowerCase();
          const cat = String(p?.category || '').toLowerCase();
          const sku = String(p?.sku || '').toLowerCase();
          const loc = String(r?.location || '').toLowerCase();
          const stock = String(toInt(r?.stock));
          const minStock = String(toInt(r?.min_stock));
          return pid.includes(q) || name.includes(q) || brand.includes(q) || cat.includes(q) ||
            sku.includes(q) || loc.includes(q) || stock.includes(q) || minStock.includes(q);
        })
      : src;

    if (!list.length) {
      el.inventoryBody.innerHTML = `<tr><td colspan="6" class="muted">No hay resultados.</td></tr>`;
      return;
    }

    el.inventoryBody.innerHTML = list.map(r => {
      const pid = String(r.product_id || '').trim();
      const p = idx.get(pid);

      const productCell = p ? (() => {
        const meta = [
          String(p.brand || '').trim(),
          String(p.category || '').trim(),
          String(p.sku || '').trim() ? `SKU: ${String(p.sku || '').trim()}` : '',
        ].filter(Boolean).join(' · ');

        return `
          <div class="productCell">
            <div class="productCell__title">${escapeHtml(safeStr_(p.name || pid, 120))}</div>
            ${meta ? `<div class="productCell__meta">${escapeHtml(meta)}</div>` : ''}
            <div class="productCell__id">ID interno: ${escapeHtml(pid)}</div>
          </div>
        `;
      })() : `
        <div class="productCell">
          <div class="productCell__title">Producto no encontrado</div>
          <div class="productCell__id">${escapeHtml(pid)}</div>
        </div>
      `;

      const actions = `
        <button class="btn btn--tiny btn--ghost" data-act="inventory_adjust" data-id="${escapeHtml(pid)}">Ajustar</button>
        <button class="btn btn--tiny btn--ghost" data-act="inventory_meta" data-id="${escapeHtml(pid)}">Mínimo/ubicación</button>
        ${p ? `<button class="btn btn--tiny btn--ghost" data-act="edit" data-id="${escapeHtml(pid)}">Editar producto</button>` : ''}
        ${p ? `<button class="btn btn--tiny btn--ghost" data-act="restock_add" data-id="${escapeHtml(pid)}">Restock</button>` : ''}
      `;

      return `
        <tr>
          <td>${productCell}</td>
          <td class="num mono">${toInt(r.stock)}</td>
          <td class="num mono">${toInt(r.min_stock)}</td>
          <td>${escapeHtml(r.location || '')}</td>
          <td class="tiny muted">${escapeHtml(String(r.updated_at || ''))}</td>
          <td class="num actionsCell">${actions}</td>
        </tr>
      `;
    }).join('');
  }

  /* =========================
     Movimientos (latest-wins)
  ========================= */
  const MOVES = { lastKey: '', reqId: 0, inflight: null };

  function renderMoves_() {
    if (!el.movesBody) return;

    const st = State.get();
    const idx = State.productsIndex();
    const rows = Array.isArray(st.moves) ? st.moves : [];

    if (!rows.length) {
      el.movesBody.innerHTML = `<tr><td colspan="6" class="muted">Usa el buscador para cargar movimientos.</td></tr>`;
      return;
    }

    el.movesBody.innerHTML = rows.map(m => {
      const pid = String(m.product_id || '').trim();
      const p = idx.get(pid);
      const name = (m.product_name || p?.name || pid || '—');
      const type = String(m.type || '').trim();
      const qty = toInt(m.qty);
      const ref = String(m.ref || '').trim();
      const date = String(m.date || m.created_at || '').trim();
      const pidLabel = pid ? `(${escapeHtml(pid)})` : '';

      return `
        <tr>
          <td class="mono">${escapeHtml(m.move_id || m.id || '')}</td>
          <td>${escapeHtml(name)} <span class="tiny muted mono">${pidLabel}</span></td>
          <td class="mono">${escapeHtml(type)}</td>
          <td class="num mono">${qty}</td>
          <td class="mono">${escapeHtml(ref)}</td>
          <td class="mono">${escapeHtml(date)}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadMoves_(q = '') {
    if (!el.movesBody) return;

    const query = String(q ?? '').trim();
    State.set({ movesQuery: query }, { sys: true });

    const key = `q=${query}|limit=200`;
    if (MOVES.inflight && MOVES.lastKey === key) return MOVES.inflight;

    MOVES.lastKey = key;
    const myId = ++MOVES.reqId;

    el.movesBody.innerHTML = `<tr><td colspan="6" class="muted">Cargando…</td></tr>`;

    const p = (async () => {
      try {
        const res = await StoreAPI.listMoves(query, 200);
        if (myId !== MOVES.reqId) return;

        State.set({ moves: Array.isArray(res?.items) ? res.items : [], movesLoaded: true }, { data: true });
        renderMoves_();
      } catch (e) {
        if (myId !== MOVES.reqId) return;
        console.error(e);
        el.movesBody.innerHTML = `<tr><td colspan="6" class="muted">Error cargando movimientos: ${escapeHtml(e?.message || String(e))}</td></tr>`;
        toast(e?.message || 'Error cargando movimientos', false);
      } finally {
        if (myId === MOVES.reqId) MOVES.inflight = null;
      }
    })();

    MOVES.inflight = p;
    return p;
  }

  /* =========================
     Sales (MVP)
  ========================= */
  function openNewSale_() {
    State.openSale();
    // Venta nueva "limpia": si venía de un interesado, quien la abre lo vuelve a enlazar.
    LEAD_LINK.leadId = '';
    if (el.saleSearch) el.saleSearch.value = '';
    if (el.saleCustomer) el.saleCustomer.value = '';
    if (el.saleNotes) el.saleNotes.value = '';
    if (el.salePay) el.salePay.value = 'cash';
    if (el.saleStatus) el.saleStatus.value = 'paid';
    syncInstallmentFields_();

    scheduleSaleRender_();
    syncSalesUI_();
  }

  function closeSale_() {
    State.closeSale();
    LEAD_LINK.leadId = '';
    scheduleSaleRender_();
    syncSalesUI_();
  }

  function parseProductIdFromInput_(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';

    const st = State.get();
    const exact = (st.products || []).find(p => String(p.id || '').trim().toLowerCase() === s.toLowerCase());
    if (exact) return String(exact.id || '').trim();

    const m = s.match(/\(([^)]+)\)\s*$/);
    if (m && m[1]) return String(m[1]).trim();

    return '';
  }

  function buildSaleDatalist_() {
    const dl = el.saleProductsList;
    if (!dl) return;

    const st = State.get();
    const list = (st.products || []).filter(p => p && (p.active !== false));
    dl.innerHTML = list
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .map(p => {
        const name = String(p.name || '').trim() || String(p.id || '').trim();
        const brand = String(p.brand || '').trim();
        const id = String(p.id || '').trim();
        const label = `${name}${brand ? ' — ' + brand : ''} (${id})`;
        return `<option value="${escapeHtml(label)}"></option>`;
      }).join('');
  }

  function inventoryByProductId_(productId) {
    const pid = String(productId || '').trim();
    if (!pid) return null;
    const rows = Array.isArray(State.get().inventory) ? State.get().inventory : [];
    return rows.find(r => String(r?.product_id || '').trim() === pid) || null;
  }

  function buildProductOptionLabel_(p) {
    const id = String(p?.id || '').trim();
    const name = String(p?.name || '').trim() || id;
    const brand = String(p?.brand || '').trim();
    const sku = String(p?.sku || '').trim();
    const middle = [brand, sku ? `SKU: ${sku}` : ''].filter(Boolean).join(' · ');
    return `${name}${middle ? ' — ' + middle : ''} (${id})`;
  }

  function buildInventoryProductDatalist_() {
    const dl = el.inventoryProductsList;
    if (!dl) return;

    const st = State.get();
    const inventoryIds = new Set((Array.isArray(st.inventory) ? st.inventory : [])
      .map(r => String(r?.product_id || '').trim())
      .filter(Boolean));

    const list = (Array.isArray(st.products) ? st.products : [])
      .filter(p => p && String(p.id || '').trim() && (p.active !== false || inventoryIds.has(String(p.id || '').trim())));

    dl.innerHTML = list
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .map(p => `<option value="${escapeHtml(buildProductOptionLabel_(p))}"></option>`)
      .join('');
  }

  function resolveProductIdFromQuery_(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';

    const pid = parseProductIdFromInput_(s);
    if (pid) return pid;

    const needle = s.toLowerCase();
    const invExact = (Array.isArray(State.get().inventory) ? State.get().inventory : [])
      .find(r => String(r?.product_id || '').trim().toLowerCase() === needle);
    if (invExact) return String(invExact.product_id || '').trim();

    const list = Array.isArray(State.get().products) ? State.get().products : [];

    const exactSku = list.find(p => String(p?.sku || '').trim().toLowerCase() === needle);
    if (exactSku) return String(exactSku.id || '').trim();

    const exactName = list.find(p => String(p?.name || '').trim().toLowerCase() === needle);
    if (exactName) return String(exactName.id || '').trim();

    const partial = list.find(p =>
      String(p?.name || '').toLowerCase().includes(needle) ||
      String(p?.brand || '').toLowerCase().includes(needle) ||
      String(p?.sku || '').toLowerCase().includes(needle) ||
      String(p?.category || '').toLowerCase().includes(needle)
    );
    return partial ? String(partial.id || '').trim() : '';
  }

  function renderStockProductPreview_(productId) {
    if (!el.stockProductPreview) return;

    const pid = String(productId || '').trim();
    if (!pid) {
      el.stockProductPreview.hidden = false;
      el.stockProductPreview.innerHTML = `<div class="productPreview__meta">Selecciona un producto de la lista.</div>`;
      return;
    }

    const p = State.productsIndex().get(pid);
    const inv = inventoryByProductId_(pid);

    if (!p) {
      el.stockProductPreview.hidden = false;
      el.stockProductPreview.innerHTML = `
        <div class="productPreview__title">Producto no encontrado</div>
        <div class="productPreview__meta mono">${escapeHtml(pid)}</div>
      `;
      return;
    }

    const meta = [
      String(p.brand || '').trim(),
      String(p.category || '').trim(),
      String(p.sku || '').trim() ? `SKU: ${String(p.sku || '').trim()}` : '',
    ].filter(Boolean).join(' · ');

    const stockLine = inv
      ? `Stock actual: ${toInt(inv.stock)} · Mínimo: ${toInt(inv.min_stock)} · Ubicación: ${String(inv.location || '—')}`
      : 'Sin registro de inventario todavía. El ajuste creará movimiento.';

    el.stockProductPreview.hidden = false;
    el.stockProductPreview.innerHTML = `
      <div class="productPreview__title">${escapeHtml(p.name || pid)}</div>
      <div class="productPreview__stock">${escapeHtml(stockLine)}</div>
      ${meta ? `<div class="productPreview__meta">${escapeHtml(meta)}</div>` : ''}
    `;
  }

  function syncStockProductSelection_() {
    const pid = resolveProductIdFromQuery_(el.s_product_query?.value || '');
    if (el.s_product_id) el.s_product_id.value = pid;
    renderStockProductPreview_(pid);
    return pid;
  }

  function syncStockModeUI_() {
    const mode = String(el.s_mode?.value || 'delta');
    if (el.s_qty_label) {
      el.s_qty_label.textContent = mode === 'set' ? 'Stock real contado' : 'Cantidad (+ / -)';
    }
    if (mode === 'set' && el.s_note && !String(el.s_note.value || '').trim()) {
      el.s_note.value = 'Conteo físico / ajuste a stock real';
    }
  }

  function findProductByQuery_(q) {
    const needle = String(q || '').toLowerCase().trim();
    if (!needle) return null;

    const pid = parseProductIdFromInput_(q);
    if (pid) return State.productsIndex().get(pid) || null;

    const list = State.get().products || [];
    const exact = list.find(p => String(p.id || '').toLowerCase() === needle);
    if (exact) return exact;

    return list.find(p =>
      String(p.name || '').toLowerCase().includes(needle) ||
      String(p.brand || '').toLowerCase().includes(needle) ||
      String(p.sku || '').toLowerCase().includes(needle) ||
      String(p.category || '').toLowerCase().includes(needle)
    ) || null;
  }

  function addToSale_() {
    const q = el.saleSearch?.value || '';
    const p = findProductByQuery_(q);

    if (!p) { toast('No encontré ese producto', false); return; }

    const st = State.get();
    const pid = String(p.id || '').trim();
    const unit = pickPriceCOP_(p);

    const items = Array.isArray(st.saleItems) ? st.saleItems : [];
    const i = items.findIndex(x => String(x.product_id || '') === pid);

    const next = (i >= 0)
      ? items.map((it, idx) => (idx === i ? { ...it, qty: Math.max(1, toInt(it.qty) + 1) } : it))
      : items.concat([{ product_id: pid, name: p.name || pid, qty: 1, unit_price: unit }]);

    State.setSaleItems(next);

    if (el.saleSearch) el.saleSearch.value = '';
    scheduleSaleRender_();
  }

  let SALE_RAF = 0;
  const scheduleSaleRender_ = () => {
    cancelAnimationFrame(SALE_RAF);
    SALE_RAF = requestAnimationFrame(() => {
      renderSaleItems_();
      SALE_RAF = 0;
    });
  };

  function updateSaleTotalOnly_(items) {
    if (!el.saleTotal) return;
    const total = (items || []).reduce((acc, it) => acc + (Math.max(1, toInt(it.qty)) * Math.max(0, toInt(it.unit_price))), 0);
    el.saleTotal.textContent = fmtCOP(total);
  }

  function renderSaleItems_() {
    if (!el.saleItemsBody || !el.saleTotal) return;

    const snap = captureFocus_();

    const st = State.get();
    const items = Array.isArray(st.saleItems) ? st.saleItems : [];

    if (!items.length) {
      el.saleItemsBody.innerHTML = `<tr><td colspan="5" class="muted">Aún no hay productos. Búscalos arriba y pulsa “Agregar”.</td></tr>`;
      el.saleTotal.textContent = fmtCOP(0);
      restoreFocus_(snap);
      return;
    }

    let total = 0;

    el.saleItemsBody.innerHTML = items.map((it, idx) => {
      const qty = Math.max(1, toInt(it.qty));
      const unit = Math.max(0, toInt(it.unit_price));
      const subtotal = qty * unit;
      total += subtotal;

      return `
        <tr>
          <td>${escapeHtml(it.name || it.product_id)}</td>
          <td class="num mono">
            <input class="miniNum" type="number" min="1" step="1" value="${qty}" data-sale-qty="${idx}" />
          </td>
          <td class="num mono">
            <input class="miniNum" type="number" min="0" step="1" value="${unit}" data-sale-price="${idx}" />
          </td>
          <td class="num mono">${fmtCOP(subtotal)}</td>
          <td class="num">
            <button class="btn btn--tiny btn--ghost" data-sale-del="${idx}" title="Quitar">✕</button>
          </td>
        </tr>
      `;
    }).join('');

    el.saleTotal.textContent = fmtCOP(total);
    restoreFocus_(snap);
  }

  async function saveSale_() {
    const st = State.get();
    const saleItems = Array.isArray(st.saleItems) ? st.saleItems : [];
    if (!saleItems.length) { toast('No hay items para guardar', false); return; }

    const items = saleItems.map(it => ({
      product_id: String(it.product_id || '').trim(),
      qty: toInt(it.qty),
      unit_price: toInt(it.unit_price),
    })).filter(x => x.product_id && x.qty > 0 && x.unit_price >= 0);

    const sale = {
      customer_id: safeStr_(el.saleCustomer?.value, 180),
      payment_method: safeStr_(el.salePay?.value, 40),
      status: normStatus_(String(el.saleStatus?.value || 'paid').trim()),
      notes: safeStr_(el.saleNotes?.value, 1200),
      initial_payment_cop: Math.max(0, toInt(el.saleInitialPayment?.value)),
    };

    const computedTotal = items.reduce((acc, it) => acc + (toInt(it.qty) * toInt(it.unit_price)), 0);
    if (sale.status === 'installments' && sale.initial_payment_cop > computedTotal) {
      toast('El abono inicial no puede superar el total.', false); return;
    }

    setBusy_(true, sale.status === 'pending' ? 'Guardando pedido…' : 'Guardando venta…');
    try {
      const res = await apiPostAuthed_({ action: 'sale.create', sale, items });

      if (sale.status === 'pending') {
        const local = readLocalOrders_();
        const id = String(res?.id || ('local_' + Date.now() + '_' + Math.random().toString(16).slice(2)));
        local.unshift({
          id,
          created_at: new Date().toISOString(),
          customer_id: sale.customer_id || '',
          payment_method: sale.payment_method || '',
          status: 'pending',
          notes: sale.notes || '',
          total_cop: computedTotal,
          items: saleItems.map(it => ({
            product_id: String(it.product_id || '').trim(),
            name: String(it.name || '').trim(),
            qty: toInt(it.qty),
            unit_price: toInt(it.unit_price),
          })).filter(x => x.product_id && x.qty > 0),
          source: 'local',
        });
        writeLocalOrders_(local.slice(0, 200));
      }

      toast(`${sale.status === 'pending' ? 'Pedido' : 'Venta'} guardada ✅ (${fmtCOP(toInt(res?.total_cop ?? computedTotal))})`, true);

      const pendingLeadId = LEAD_LINK.leadId; // closeSale_ lo limpia
      closeSale_();
      if (pendingLeadId) await closeLeadAfterSale_(res?.id, pendingLeadId);

      await refreshAfterSale_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  async function markOrderPaid_(id) {
    const key = String(id || '').trim();
    if (!key) { toast('ID inválido', false); return; }

    const st = State.get();

    if (st.ordersSource === 'api') {
      setBusy_(true, 'Marcando pagado…');
      try {
        await apiPostAuthed_({ action: 'sale.updateStatus', id: key, status: 'paid' });
        toast('Pedido convertido a pagado ✅', true);
        await refreshAfterOrderPaid_();
        return;
      } catch (e) {
        toast(e?.message || String(e), false);
        return;
      } finally {
        setBusy_(false);
      }
    }

    const o = findLocalOrderById_(key);
    if (!o) { toast('No encontré ese pedido', false); return; }
    if (!Array.isArray(o.items) || !o.items.length) { toast('Ese pedido no tiene items', false); return; }

    const items = o.items.map(it => ({
      product_id: String(it.product_id || '').trim(),
      qty: toInt(it.qty),
      unit_price: toInt(it.unit_price),
    })).filter(x => x.product_id && x.qty > 0 && x.unit_price >= 0);

    const sale = {
      customer_id: String(o.customer_id || '').trim(),
      payment_method: String(o.payment_method || 'cash').trim() || 'cash',
      status: 'paid',
      notes: String(o.notes || '').trim(),
      from_order: String(o.id || '').trim(),
    };

    const computedTotal = items.reduce((acc, it) => acc + (toInt(it.qty) * toInt(it.unit_price)), 0);

    setBusy_(true, 'Convirtiendo a venta…');
    try {
      const res = await apiPostAuthed_({ action: 'sale.create', sale, items });
      removeLocalOrder_(key);
      renderOrders_();
      toast(`Venta guardada ✅ (${fmtCOP(toInt(res.total_cop ?? computedTotal))})`, true);
      await refreshAfterOrderPaid_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function addInstallmentPayment_(id) {
    const order = State.get().orders.find(x => String(x.id) === String(id));
    const balance = toInt(order?.balance_cop);
    const raw = prompt(`Saldo pendiente: ${fmtCOP(balance)}\nValor del abono:`, '');
    if (raw === null) return;
    const amount = toInt(String(raw).replace(/[^0-9]/g, ''));
    setBusy_(true, 'Registrando abono…');
    try { await StoreAPI.addPayment(id, amount, order?.payment_method || 'cash'); toast('Abono registrado ✅', true); await refreshAfterOrderPaid_(); }
    catch (e) { toast(e?.message || String(e), false); }
    finally { setBusy_(false); }
  }

  /* =========================
     Detalle de venta (editar / eliminar / abonos)
  ========================= */
  const SALE_DETAIL = { id: '', sale: null };

  function statusLabel_(s) {
    const x = normStatus_(s);
    if (x === 'paid') return 'Pagada ✅';
    if (x === 'installments') return 'A cuotas';
    if (x === 'pending') return 'Pendiente';
    if (x === 'cancelled') return 'Cancelada';
    return x || '—';
  }

  function payLabel_(m) {
    const x = String(m || '').toLowerCase();
    if (x === 'cash') return 'Efectivo';
    if (x === 'transfer') return 'Transferencia';
    if (x === 'card') return 'Tarjeta';
    if (x === 'mixed') return 'Mixto';
    return m || '—';
  }

  function renderSaleDetail_() {
    const sale = SALE_DETAIL.sale;
    if (!sale) return;

    if (el.sd_id) el.sd_id.value = String(sale.id || '');
    if (el.sd_created) el.sd_created.textContent = `Registrada: ${fmtDateTime_(sale.created_at)} · ID: ${String(sale.id || '')}`;
    if (el.sd_customer) el.sd_customer.value = String(sale.customer_id || '');
    if (el.sd_pay) el.sd_pay.value = String(sale.payment_method || 'cash') || 'cash';
    if (el.sd_notes) el.sd_notes.value = String(sale.notes || '');

    const total = toInt(sale.total_cop);
    const paid = toInt(sale.paid_cop);
    const balance = toInt(sale.balance_cop);

    if (el.sd_summary) {
      el.sd_summary.innerHTML = `
        <b>Estado:</b> ${escapeHtml(statusLabel_(sale.status))}
        &nbsp;·&nbsp; <b>Total:</b> <span class="mono">${escapeHtml(fmtCOP(total))}</span>
        &nbsp;·&nbsp; <b>Pagado:</b> <span class="mono">${escapeHtml(fmtCOP(paid))}</span>
        &nbsp;·&nbsp; <b>Saldo:</b> <span class="mono">${escapeHtml(fmtCOP(balance))}</span>
      `;
    }

    if (el.sd_itemsBody) {
      const idx = State.productsIndex();
      const items = Array.isArray(sale.items) ? sale.items : [];
      el.sd_itemsBody.innerHTML = items.length ? items.map(it => {
        const pid = String(it.product_id || '').trim();
        const name = idx.get(pid)?.name || pid || '—';
        const qty = toInt(it.qty);
        const unit = toInt(it.unit_price);
        return `
          <tr>
            <td>${escapeHtml(name)}</td>
            <td class="num mono">${qty}</td>
            <td class="num mono">${escapeHtml(fmtCOP(unit))}</td>
            <td class="num mono">${escapeHtml(fmtCOP(qty * unit))}</td>
          </tr>
        `;
      }).join('') : `<tr><td colspan="4" class="muted">Sin detalle de productos.</td></tr>`;
    }

    if (el.sd_paymentsBody) {
      const payments = Array.isArray(sale.payments) ? sale.payments : [];
      el.sd_paymentsBody.innerHTML = payments.length ? payments.map((p, i) => `
        <tr>
          <td class="tiny">
            <div>${escapeHtml(fmtDatePart_(p.date))}</div>
            <div class="muted mono">${escapeHtml(fmtTimePart_(p.date))}</div>
          </td>
          <td class="num mono">${escapeHtml(fmtCOP(toInt(p.amount_cop)))}</td>
          <td class="tiny">${escapeHtml(payLabel_(p.method))}</td>
          <td class="tiny">${escapeHtml(String(p.note || ''))}${p.edited_at ? ` <span class="muted">(editado)</span>` : ''}</td>
          <td class="num" style="white-space:nowrap;">
            <button class="btn btn--tiny btn--ghost" data-pay-edit="${i}" type="button">Editar</button>
            <button class="btn btn--tiny btn--ghost" data-pay-del="${i}" type="button" style="color:#b42318;">Eliminar</button>
          </td>
        </tr>
      `).join('') : `<tr><td colspan="5" class="muted">Aún no hay abonos registrados.</td></tr>`;
    }

    if (el.sd_addPaymentRow) el.sd_addPaymentRow.hidden = (balance <= 0);
    if (el.sd_newPayment) el.sd_newPayment.value = '';
  }

  async function openSaleDetail_(id) {
    const key = String(id || '').trim();
    if (!key) return;

    await ensureProductsLoaded_().catch(() => {});

    setBusy_(true, 'Cargando venta…');
    try {
      const res = await StoreAPI.getSale(key);
      SALE_DETAIL.id = key;
      SALE_DETAIL.sale = { ...(res.sale || {}), items: res.items || [] };
      renderSaleDetail_();
      el.modalSaleDetail?.showModal?.();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function reloadSaleDetail_() {
    const key = SALE_DETAIL.id;
    if (!key) return;
    try {
      const res = await StoreAPI.getSale(key);
      SALE_DETAIL.sale = { ...(res.sale || {}), items: res.items || [] };
      renderSaleDetail_();
    } catch {
      el.modalSaleDetail?.close?.();
    }
  }

  async function saveSaleDetail_() {
    const key = SALE_DETAIL.id;
    if (!key) return;

    setBusy_(true, 'Guardando cambios…');
    try {
      await StoreAPI.updateSale(key, {
        customer_id: safeStr_(el.sd_customer?.value, 180),
        payment_method: safeStr_(el.sd_pay?.value, 40),
        notes: safeStr_(el.sd_notes?.value, 1200),
      });
      toast('Venta actualizada ✅', true);
      await reloadSaleDetail_();
      await refreshAfterOrderPaid_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function deleteSaleDetail_(id) {
    const key = String(id || SALE_DETAIL.id || '').trim();
    if (!key) return;

    const ok = confirm('¿Eliminar esta venta definitivamente?\nSi ya descontó inventario, el stock se devolverá automáticamente.');
    if (!ok) return;

    setBusy_(true, 'Eliminando venta…');
    try {
      await StoreAPI.deleteSale(key);
      toast('Venta eliminada 🗑️ (stock devuelto si aplicaba)', true);
      if (el.modalSaleDetail?.open) el.modalSaleDetail.close();
      SALE_DETAIL.id = ''; SALE_DETAIL.sale = null;
      await refreshAfterOrderPaid_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function editPaymentDetail_(index) {
    const sale = SALE_DETAIL.sale;
    const payments = Array.isArray(sale?.payments) ? sale.payments : [];
    const p = payments[index];
    if (!p) return;

    const raw = prompt(`Nuevo valor del abono (actual: ${fmtCOP(toInt(p.amount_cop))}):`, String(toInt(p.amount_cop)));
    if (raw === null) return;
    const amount = toInt(String(raw).replace(/[^0-9]/g, ''));
    if (amount <= 0) { toast('Valor inválido', false); return; }

    setBusy_(true, 'Actualizando abono…');
    try {
      await StoreAPI.updatePayment(SALE_DETAIL.id, index, { amount });
      toast('Abono actualizado ✅', true);
      await reloadSaleDetail_();
      await refreshAfterOrderPaid_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function deletePaymentDetail_(index) {
    const sale = SALE_DETAIL.sale;
    const payments = Array.isArray(sale?.payments) ? sale.payments : [];
    const p = payments[index];
    if (!p) return;

    const ok = confirm(`¿Eliminar el abono de ${fmtCOP(toInt(p.amount_cop))} del ${fmtDateTime_(p.date)}?`);
    if (!ok) return;

    setBusy_(true, 'Eliminando abono…');
    try {
      await StoreAPI.deletePayment(SALE_DETAIL.id, index);
      toast('Abono eliminado 🗑️', true);
      await reloadSaleDetail_();
      await refreshAfterOrderPaid_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function addPaymentFromDetail_() {
    const key = SALE_DETAIL.id;
    if (!key) return;
    const amount = toInt(el.sd_newPayment?.value);
    if (amount <= 0) { toast('Ingresa un valor de abono válido', false); return; }

    setBusy_(true, 'Registrando abono…');
    try {
      await StoreAPI.addPayment(key, amount, SALE_DETAIL.sale?.payment_method || 'cash');
      toast('Abono registrado ✅', true);
      await reloadSaleDetail_();
      await refreshAfterOrderPaid_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Pricing helpers (modal producto)
     -------------------------
     Asesora : escribe el costo → el precio de venta sale solo (readonly).
     Admin   : igual, pero puede ver/ajustar el % y sobrescribir el precio.
  ========================= */
  const PRICE_SYNC = { lock: false, manualMargin: false };

  function computePriceFromCostMargin_(cost, margin) {
    const c = Math.max(0, toInt(cost));
    const m = Math.max(0, toFloat(margin));
    if (!c) return 0;
    return Math.max(0, roundInt(c * (1 + (m / 100))));
  }

  function computeMarginFromCostPrice_(cost, price) {
    return marginFromCostPrice(cost, price);
  }

  /* Costo → precio, usando la regla por rangos (o el % manual si el admin lo tocó). */
  function applyPriceRule_({ manual = false } = {}) {
    if (PRICE_SYNC.lock) return;
    PRICE_SYNC.lock = true;

    try {
      const cost = toInt(el.p_cost?.value);

      if (!cost) {
        if (el.p_price && !Roles.can('override_price')) el.p_price.value = '';
        if (el.p_margin) el.p_margin.value = '';
        renderPriceHint_(0, toInt(el.p_price?.value), null);
        return;
      }

      // Sin regla de precios configurada no inventamos un precio.
      if (!pricingReady_() && !(manual && Roles.can('see_margin'))) {
        renderPriceHint_(cost, toInt(el.p_price?.value), null);
        return;
      }

      const useManualMargin = manual && Roles.can('see_margin') && String(el.p_margin?.value || '').trim() !== '';

      let price, marginPct, tierLabel = '';
      if (useManualMargin) {
        marginPct = Math.max(0, toFloat(el.p_margin.value));
        price = computePriceFromCostMargin_(cost, marginPct);
      } else {
        const sug = suggestPrice_(cost);
        price = sug.price_cop;
        marginPct = sug.margin_pct;
        tierLabel = sug.tier_label;
        if (el.p_margin) el.p_margin.value = String(marginPct);
      }

      if (el.p_price) el.p_price.value = String(price);
      renderPriceHint_(cost, price, tierLabel);
    } finally {
      PRICE_SYNC.lock = false;
    }
  }

  /* El admin escribió un precio a mano: recalculamos el % real. */
  function syncMarginFromCostPrice_() {
    if (PRICE_SYNC.lock) return;
    PRICE_SYNC.lock = true;
    try {
      const cost = toInt(el.p_cost?.value);
      const price = toInt(el.p_price?.value);
      if (el.p_margin) el.p_margin.value = cost ? String(computeMarginFromCostPrice_(cost, price)) : '';
      renderPriceHint_(cost, price, null);
    } finally {
      PRICE_SYNC.lock = false;
    }
  }

  function renderPriceHint_(cost, price, tierLabel) {
    const c = Math.max(0, toInt(cost));
    const p = Math.max(0, toInt(price));

    if (el.p_price_hint) {
      if (!c) {
        el.p_price_hint.textContent = 'Escribe el costo del proveedor y el precio de venta se calcula solo.';
      } else if (!pricingReady_()) {
        el.p_price_hint.textContent = Roles.can('edit_pricing')
          ? '⚠ Todavía no hay regla de precios guardada. Configúrala en ⚙️ Precios (o escribe el precio a mano).'
          : '⚠ Falta configurar la regla de precios. Avísale a un admin para que la guarde.';
      } else if (Roles.can('see_margin')) {
        const pct = computeMarginFromCostPrice_(c, p);
        const rango = tierLabel ? ` · rango ${tierLabel}` : '';
        el.p_price_hint.textContent = `Regla aplicada: +${pct}%${rango}`;
      } else {
        el.p_price_hint.textContent = 'Precio de venta al público calculado automáticamente ✅';
      }
    }

    if (el.p_profit_note) {
      const show = Roles.can('see_margin') && c > 0;
      el.p_profit_note.hidden = !show;
      if (show) el.p_profit_note.textContent = `Utilidad por unidad: ${fmtCOP(Math.max(0, p - c))}`;
    }
  }

  /* =========================
     Product modal
  ========================= */
  function openProductModal_(p) {
    const isNew = !p;
    if (el.productTitle) el.productTitle.textContent = isNew ? 'Nuevo producto' : 'Editar producto';

    if (el.p_id) {
      el.p_id.value = p?.id || '';
      el.p_id.placeholder = '(auto)';
      el.p_id.disabled = true;
    }

    if (el.p_active) el.p_active.value = String((p?.active ?? true) ? 'true' : 'false');
    if (el.p_name) el.p_name.value = p?.name || '';
    if (el.p_brand) el.p_brand.value = p?.brand || '';
    if (el.p_category) el.p_category.value = p?.category || '';
    if (el.p_sku) el.p_sku.value = p?.sku || '';

    const pid = String(p?.id || '').trim();
    const price = pickPriceCOP_(p);

    // El costo vive en productCosts (solo admin lo lee). pickCostCOP_ cubre
    // productos viejos que todavía lo tengan incrustado.
    const cost = Roles.can('see_costs')
      ? (costFor_(pid) || pickCostCOP_(p))
      : 0;
    const comp = Roles.can('see_competitor')
      ? (competitorFor_(pid) || pickCompetitorCOP_(p))
      : 0;

    const hasCostSaved = !!(p?.has_cost) || cost > 0;

    if (el.p_price) el.p_price.value = price ? String(price) : '';
    if (el.p_cost) {
      el.p_cost.value = cost ? String(cost) : '';
      el.p_cost.placeholder = (!Roles.can('see_costs') && hasCostSaved)
        ? 'Ya registrado (no visible)'
        : 'Lo que cobra el proveedor';
    }
    if (el.p_margin) el.p_margin.value = cost ? String(computeMarginFromCostPrice_(cost, price)) : '';
    if (el.p_competitor_price) el.p_competitor_price.value = comp ? String(comp) : '';

    if (el.p_cost_note) {
      if (Roles.can('see_costs')) {
        el.p_cost_note.textContent = 'Lo que les vale a ustedes.';
      } else if (hasCostSaved) {
        el.p_cost_note.textContent = 'Este producto ya tiene costo guardado. Escríbelo solo si cambió; si lo dejas vacío no se toca.';
      } else {
        el.p_cost_note.textContent = 'Escribe lo que te cobra el proveedor. El precio de venta se calcula solo.';
      }
    }

    PRICE_SYNC.manualMargin = false;

    // Producto sin precio: aplicamos la regla de una vez si ya hay costo.
    if (cost > 0 && !price) applyPriceRule_();
    else renderPriceHint_(cost, price, '');

    if (el.p_desc) el.p_desc.value = p?.desc || '';
    if (el.p_image) el.p_image.value = p?.image_url || '';

    el.modalProduct?.showModal?.();
  }

  function readProductForm_() {
    const id = String(el.p_id?.value || '').trim();
    const costRaw = String(el.p_cost?.value ?? '').trim();
    const cost = toInt(costRaw);
    const price = toInt(el.p_price?.value);

    // El % guardado: el que puso el admin, o el que dicta la regla por rangos.
    const margin = Roles.can('see_margin') && el.p_margin
      ? Math.max(0, toFloat(el.p_margin.value))
      : (cost ? computeMarginFromCostPrice_(cost, price) : 0);

    const comp = (Roles.can('see_competitor') && el.p_competitor_price)
      ? toInt(el.p_competitor_price.value)
      : 0;

    return {
      id,
      active: el.p_active?.value === 'true',
      name: safeStr_(el.p_name?.value, 220),
      brand: safeStr_(el.p_brand?.value, 160),
      category: safeStr_(el.p_category?.value, 160),
      sku: safeStr_(el.p_sku?.value, 120),

      price_cop: price,
      cost_cop: cost,
      competitor_price_cop: comp,
      margin_pct: margin,

      desc: safeStr_(el.p_desc?.value, 4000),
      image_url: safeStr_(el.p_image?.value, 1200),

      // Si el campo quedó vacío, NO tocamos el costo ya guardado.
      _costTouched: costRaw !== '' && cost > 0,
    };
  }

  async function saveProduct_() {
    const prod = readProductForm_();
    if (!prod.name) { toast('Falta nombre del producto', false); return; }

    if (!prod.id) {
      const newId = genProductId_({ name: prod.name, category: prod.category });
      prod.id = newId;
      if (el.p_id) el.p_id.value = newId;
    }

    if (!prod.price_cop) {
      toast(
        pricingReady_()
          ? 'Falta el precio de venta. Escribe el costo del proveedor y sale solo.'
          : 'Falta configurar la regla de precios (⚙️ Precios). Sin ella no se puede calcular el precio de venta.',
        false
      );
      return;
    }

    const writeCost = !!prod._costTouched;
    delete prod._costTouched;

    setBusy_(true, 'Guardando producto…');
    try {
      const res = await StoreAPI.upsertProduct(prod, {
        writeCost,
        includeCompetitor: Roles.can('see_competitor'),
        updatedBy: Roles.email(),
      });
      toast(res?.mode === 'created' ? 'Producto creado ✅' : 'Producto actualizado ✅', true);
      el.modalProduct?.close?.();
      if (writeCost) COSTS.loaded = false; // el costo cambió: recargar para admin
      await refreshAfterProductChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  async function toggleProductActive_(id, currentActive) {
    setBusy_(true, 'Guardando…');
    try {
      const res = await StoreAPI.setProductActive(id, !currentActive);
      toast(res?.active ? 'Producto activado ✅' : 'Producto ocultado ✅', true);
      await refreshAfterProductChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Stock modal
  ========================= */
  async function openStockModal_(productId = '') {
    await Promise.all([
      ensureProductsLoaded_().catch(() => {}),
      ensureInventoryLoaded_().catch(() => {}),
    ]);
    buildInventoryProductDatalist_();

    const pid = String(productId || '').trim();
    const p = pid ? State.productsIndex().get(pid) : null;

    if (el.s_product_query) el.s_product_query.value = p ? buildProductOptionLabel_(p) : pid;
    if (el.s_product_id) el.s_product_id.value = '';
    if (pid) el.s_product_id.value = pid;
    if (el.stockProductPreview) {
      el.stockProductPreview.hidden = true;
      el.stockProductPreview.innerHTML = '';
    }
    if (el.s_mode) el.s_mode.value = 'delta';
    if (el.s_type) el.s_type.value = 'adjust';
    if (el.s_qty) el.s_qty.value = '';
    if (el.s_ref) el.s_ref.value = '';
    if (el.s_note) el.s_note.value = '';
    syncStockModeUI_();
    if (pid) renderStockProductPreview_(pid);
    el.modalStock?.showModal?.();
    try { el.s_product_query?.focus?.({ preventScroll: true }); } catch {}
  }

  async function saveStock_() {
    const product_id = syncStockProductSelection_();
    const type = String(el.s_type?.value || 'adjust').trim();
    const mode = String(el.s_mode?.value || 'delta');
    const rawQty = toInt(el.s_qty?.value);
    const ref = safeStr_(el.s_ref?.value, 200);
    let note = safeStr_(el.s_note?.value, 800);

    if (!product_id) { toast('Selecciona un producto válido', false); return; }

    const inv = inventoryByProductId_(product_id);
    const currentStock = toInt(inv?.stock);
    let qty = rawQty;

    if (mode === 'set') {
      const targetStock = rawQty;
      if (targetStock < 0) { toast('El stock real no puede ser negativo', false); return; }
      qty = targetStock - currentStock;
      if (!qty) { toast('El stock ya está en ese valor', true); return; }
      if (!note) note = 'Conteo físico / ajuste a stock real';
    } else if (!qty) {
      toast('Cantidad inválida (no puede ser 0)', false);
      return;
    }

    setBusy_(true, 'Guardando inventario…');
    try {
      const res = await StoreAPI.adjustStock({ product_id, type, qty, ref, note });
      const newStock = (res && res.stock !== undefined && res.stock !== null) ? toInt(res.stock) : currentStock + qty;
      toast(`Inventario actualizado. Nuevo stock: ${newStock}`, true);
      el.modalStock?.close?.();
      await refreshAfterStock_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  async function openInventoryMetaModal_(productId = '') {
    await Promise.all([
      ensureProductsLoaded_().catch(() => {}),
      ensureInventoryLoaded_().catch(() => {}),
    ]);

    const pid = String(productId || '').trim();
    const p = State.productsIndex().get(pid);
    const inv = inventoryByProductId_(pid);

    if (el.im_product_id) el.im_product_id.value = pid;
    if (el.im_min_stock) el.im_min_stock.value = String(toInt(inv?.min_stock));
    if (el.im_location) el.im_location.value = String(inv?.location || '');

    if (el.inventoryMetaPreview) {
      const meta = p
        ? [p.brand, p.category, p.sku ? `SKU: ${p.sku}` : ''].filter(Boolean).join(' · ')
        : pid;
      el.inventoryMetaPreview.hidden = false;
      el.inventoryMetaPreview.innerHTML = `
        <div class="productPreview__title">${escapeHtml(p?.name || 'Producto no encontrado')}</div>
        <div class="productPreview__stock">Stock actual: ${toInt(inv?.stock)} · Mínimo: ${toInt(inv?.min_stock)} · Ubicación: ${escapeHtml(String(inv?.location || '—'))}</div>
        <div class="productPreview__meta">${escapeHtml(meta)}</div>
      `;
    }

    el.modalInventoryMeta?.showModal?.();
  }

  async function saveInventoryMeta_() {
    const product_id = String(el.im_product_id?.value || '').trim();
    if (!product_id) { toast('Selecciona un producto válido', false); return; }

    const min_stock = Math.max(0, toInt(el.im_min_stock?.value));
    const location = safeStr_(el.im_location?.value, 200);

    setBusy_(true, 'Guardando mínimo y ubicación…');
    try {
      await StoreAPI.updateInventoryMeta({ product_id, min_stock, location });
      toast('Inventario actualizado.', true);
      el.modalInventoryMeta?.close?.();
      await refreshAfterStock_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Restock (State-driven)
  ========================= */
  function restockUIEnabled_() {
    return !!(el.restockBody && (el.restockTotalUnits || el.restockTotalCost));
  }

  const RESTOCK_VER = { v: 0 };
  let RESTOCK_RAF = 0;
  const scheduleRestockRender_ = () => {
    const myV = ++RESTOCK_VER.v;
    cancelAnimationFrame(RESTOCK_RAF);
    RESTOCK_RAF = requestAnimationFrame(() => {
      if (myV !== RESTOCK_VER.v) return;
      renderRestock_();
      RESTOCK_RAF = 0;
    });
  };

  function renderRestock_() {
    if (!restockUIEnabled_()) return;

    const snap = captureFocus_();

    const r = State.getRestock();
    if (el.restockSupplier && el.restockSupplier.value !== String(r.supplier || '')) el.restockSupplier.value = r.supplier || '';
    if (el.restockNotes && el.restockNotes.value !== String(r.notes || '')) el.restockNotes.value = r.notes || '';

    const items = Array.isArray(r.items) ? r.items : [];
    const totals = State.restockTotals();

    if (!items.length) {
      const cols = Roles.can('see_costs') ? 5 : 3;
      el.restockBody.innerHTML = `<tr><td colspan="${cols}" class="muted">Aún no hay ítems. Agrega desde <b>Catálogo</b> con “Restock”.</td></tr>`;
      if (el.restockTotalUnits) el.restockTotalUnits.textContent = '0';
      if (el.restockTotalCost) el.restockTotalCost.textContent = fmtCOP(0);
      restoreFocus_(snap);
      return;
    }

    const showCosts = Roles.can('see_costs');

    let rowsHtml = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = Math.max(0, toInt(it.qty));
      const cost = Math.max(0, toInt(it.cost_cop));
      const subtotal = qty * cost;

      const id = String(it.id || '').trim();
      const name = String(it.name || it.id || '').trim();
      const desc = restockDesc_(it);

      const label = `
        <div class="cellTitle">${escapeHtml(name)}</div>
        <div class="cellSub muted tiny">${escapeHtml(desc)}</div>
      `;

      // Sin permiso de costos no mostramos columnas de dinero (mostrarían $0 y confunden).
      const moneyCells = showCosts
        ? `<td class="num mono">
             <input class="miniNum" type="number" min="0" step="1" value="${cost}" data-restock-cost="${escapeHtml(id)}" />
           </td>
           <td class="num mono">${fmtCOP(subtotal)}</td>`
        : '';

      rowsHtml += `
        <tr>
          <td>${label}</td>
          <td class="num mono">
            <input class="miniNum" type="number" min="0" step="1" value="${qty}" data-restock-qty="${escapeHtml(id)}" />
          </td>
          ${moneyCells}
          <td class="num">
            <button class="btn btn--tiny btn--ghost" data-restock-del="${escapeHtml(id)}" title="Quitar">✕</button>
          </td>
        </tr>
      `;
    }

    el.restockBody.innerHTML = rowsHtml;
    if (el.restockTotalUnits) el.restockTotalUnits.textContent = String(toInt(totals.units));
    if (el.restockTotalCost) el.restockTotalCost.textContent = fmtCOP(toInt(totals.cost_cop));

    restoreFocus_(snap);
  }

  function openRestockUI_() {
    if (document.body.dataset.view !== 'app') {
      toast('Restock solo está disponible después de iniciar sesión.', false);
      return;
    }

    if (!restockUIEnabled_()) {
      toast('Restock no está habilitado en este HTML (faltan IDs).', false);
      if (tabSection_('restock')) showTab('restock');
      return;
    }

    scheduleRestockRender_();

    if (el.modalRestock && typeof el.modalRestock.showModal === 'function') {
      if (!el.modalRestock.open) el.modalRestock.showModal();
      return;
    }

    if (tabSection_('restock')) showTab('restock');
  }

  function restockAddFromProductId_(productId) {
    const pid = String(productId || '').trim();
    if (!pid) return;

    const p = State.productsIndex().get(pid);
    if (!p) { toast('No encontré ese producto', false); return; }

    const product = {
      id: String(p.id || '').trim(),
      name: p.name || '',
      desc: p.desc || p.description || '',
      brand: p.brand || '',
      sku: p.sku || '',
      // El costo solo lo conoce el admin; para la asesora va en 0 y no se muestra.
      cost_cop: Roles.can('see_costs') ? (costFor_(p.id) || pickCostCOP_(p)) : 0,
    };

    State.restockAddProduct(product, 1);
    scheduleRestockRender_();
    toast('Agregado a restock ✅', true);

    openRestockUI_();
  }

  function restockText_() {
    const r = State.getRestock();
    const totals = State.restockTotals();
    const items = Array.isArray(r.items) ? r.items : [];

    const hidePrices = hideRestockPrices_();

    const lines = items.map(it => {
      const qty = Math.max(0, toInt(it.qty));
      const desc = restockDesc_(it);

      if (hidePrices) {
        return `• ${it.name || it.id} — ${desc}  x${qty}`;
      }

      const cost = Math.max(0, toInt(it.cost_cop));
      const sub = qty * cost;
      return `• ${it.name || it.id} — ${desc}  x${qty}  @ ${fmtCOP(cost)}  = ${fmtCOP(sub)}`;
    });

    const footer = hidePrices
      ? [`Unidades: ${toInt(totals.units)}`, `Items: ${toInt(totals.items)}`]
      : [`Total: ${fmtCOP(toInt(totals.cost_cop))}`, `Unidades: ${toInt(totals.units)}`, `Items: ${toInt(totals.items)}`];

    return [
      'PEDIDO A PROVEEDOR (RESTOCK)',
      `Fecha: ${nowLocalStamp_()}`,
      r.supplier ? `Proveedor: ${r.supplier}` : '',
      r.notes ? `Notas: ${r.notes}` : '',
      '',
      ...lines,
      '',
      ...footer,
    ].filter(Boolean).join('\n');
  }

  function canMakePdf_() {
    const hasJspdf = !!(window.jspdf && (window.jspdf.jsPDF || window.jspdf.default));
    return hasJspdf;
  }

  async function restockPdf_() {
    if (!canMakePdf_()) throw new Error('jsPDF no está cargado en index.html');

    const J = window.jspdf.jsPDF || window.jspdf.default;
    const doc = new J({ unit: 'pt', format: 'a4' });

    const r = State.getRestock();
    const totals = State.restockTotals();
    const items = Array.isArray(r.items) ? r.items : [];

    const title = 'Pedido a proveedor (Restock)';
    const left = 40;
    let y = 48;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(title, left, y);

    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Fecha: ${nowLocalStamp_()}`, left, y);

    y += 14;
    doc.text(`Proveedor: ${String(r.supplier || '—')}`, left, y);

    y += 14;
    const notes = String(r.notes || '').trim();
    if (notes) {
      const wrapped = doc.splitTextToSize(`Notas: ${notes}`, 520);
      doc.text(wrapped, left, y);
      y += (wrapped.length * 12);
    } else {
      doc.text('Notas: —', left, y);
      y += 12;
    }

    y += 10;

    if (typeof doc.autoTable !== 'function') {
      throw new Error('autoTable no está cargado (jspdf-autotable)');
    }

    const hidePrices = hideRestockPrices_();

    const head = hidePrices
      ? [['Producto', 'Descripción', 'Cant.']]
      : [['Producto', 'Descripción', 'Cant.', 'Costo', 'Subtotal']];

    const body = items.map(it => {
      const qty = Math.max(0, toInt(it.qty));
      const desc = restockDesc_(it);

      if (hidePrices) {
        return [String(it.name || it.id || ''), String(desc || '—'), qty];
      }

      const cost = Math.max(0, toInt(it.cost_cop));
      const sub = qty * cost;
      return [String(it.name || it.id || ''), String(desc || '—'), qty, fmtCOP(cost), fmtCOP(sub)];
    });

    const columnStyles = hidePrices
      ? { 2: { halign: 'right' } }
      : { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } };

    doc.autoTable({
      startY: y,
      head,
      body,
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [12, 65, 196] },
      columnStyles,
      didDrawPage: () => {
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(9);
        doc.setTextColor(70);

        const footer = hidePrices
          ? `Unidades: ${toInt(totals.units)}`
          : `Unidades: ${toInt(totals.units)}   ·   Total: ${fmtCOP(toInt(totals.cost_cop))}`;

        doc.text(footer, left, pageHeight - 30);
      }
    });

    const safeDate = nowLocalStamp_().replace(/[: ]/g, '-');
    doc.save(`pedido_restock_${safeDate}.pdf`);
  }

  async function restockPrint_() {
    const txt = restockText_();
    try { await navigator.clipboard?.writeText?.(txt); } catch {}

    try {
      setBusy_(true, 'Generando PDF…');
      await sleep_(20);
      await restockPdf_();
      toast('PDF descargado ✅', true);
    } catch (e) {
      console.error(e);
      toast(e?.message || 'No pude generar PDF, quedó copiado al portapapeles.', false);
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Wiring (event delegation)
  ========================= */
  function wireUI_() {
    if (Array.isArray(el.tabs) && el.tabs.length) {
      el.tabs.forEach(btn => on(btn, 'click', () => showTab(btn.dataset.tab)));
    }

    on(el.btnRefresh, 'click', async () => {
      try { await loadAll_({ force: true }); toast('Actualizado ✅', true); }
      catch (e) { fatal_(e?.message || String(e)); }
    });

    on(el.btnGoogle, 'click', async () => {
      try {
        if (el.authStatus) el.authStatus.textContent = 'Abriendo Google…';
        await loginGoogle_();
      } catch (e) {
        if (el.authStatus) el.authStatus.textContent = 'No se pudo iniciar con Google. Intenta de nuevo.';
        toast('No se pudo iniciar con Google. Intenta de nuevo.', false);
      }
    });

    on(el.btnLogout, 'click', async () => {
      try { await logout_(); }
      catch (e) { toast(e?.message || String(e), false); }
    });

    on(el.qCatalog, 'input', debounce(() => renderCatalog_(), 120));
    on(el.qInventory, 'input', debounce(() => renderInventory_(), 120));
    on(el.qMoves, 'input', debounce(() => { loadMoves_(el.qMoves?.value || ''); }, 240));

    on(el.btnNewProduct, 'click', () => openProductModal_(null));
    on(el.btnAdjustStock, 'click', () => { openStockModal_().catch(e => toast(e?.message || String(e), false)); });
    on(el.btnNewSale, 'click', async () => {
      await ensureProductsLoaded_().catch(() => {});
      openNewSale_();
    });
    on(el.btnCancelSale, 'click', () => closeSale_());
    on(el.btnAddToSale, 'click', () => addToSale_());
    on(el.btnSaveSale, 'click', async () => { try { await saveSale_(); } catch {} });
    on(el.saleStatus, 'change', syncInstallmentFields_);
    on(el.btnSaveProduct, 'click', async () => { try { await saveProduct_(); } catch {} });
    on(el.btnSaveStock, 'click', async () => { try { await saveStock_(); } catch {} });
    on(el.btnSaveInventoryMeta, 'click', async () => { try { await saveInventoryMeta_(); } catch {} });

    // ✅ FIX: submit solo si fue el botón guardar (evita “cierro modal y guarda”)
    on(el.productForm, 'submit', async (ev) => {
      ev.preventDefault();
      const sid = submitterId_(ev);
      if (sid && el.btnSaveProduct && sid !== el.btnSaveProduct.id) return;
      try { await saveProduct_(); } catch {}
    });

    on(el.stockForm, 'submit', async (ev) => {
      ev.preventDefault();
    });

    // Costo → precio de venta automático (el corazón del flujo de la asesora)
    on(el.p_cost, 'input', debounce(() => applyPriceRule_({ manual: PRICE_SYNC.manualMargin }), 90));

    // Admin: si toca el %, manda el % hasta que recalcule con la regla
    on(el.p_margin, 'input', () => {
      if (!Roles.can('see_margin')) return;
      PRICE_SYNC.manualMargin = true;
      applyPriceRule_({ manual: true });
    });

    // Admin: precio escrito a mano → recalcula el % real
    on(el.p_price, 'input', () => {
      if (!Roles.can('override_price')) return;
      PRICE_SYNC.manualMargin = true;
      syncMarginFromCostPrice_();
    });

    on(el.btnRecalcPrice, 'click', () => {
      PRICE_SYNC.manualMargin = false;
      applyPriceRule_();
      toast('Precio recalculado con la regla ✅', true);
    });

    // ✅ Catálogo: filtro de pendientes por precificar
    on(el.onlyMissingPrice, 'change', () => renderCatalog_());

    // ✅ Interesados
    on(el.qLeads, 'input', debounce(() => renderLeads_(), 120));
    on(el.onlyLeadsDue, 'change', () => renderLeads_());
    on(el.btnNewLead, 'click', async () => {
      await ensureProductsLoaded_().catch(() => {});
      openLeadModal_(null);
    });
    on(el.btnSaveLead, 'click', async () => { await saveLead_(); });
    on(el.btnDeleteLead, 'click', async () => { await deleteLead_(); });
    on(el.btnSaveFollowUp, 'click', async () => { await saveFollowUp_(); });

    on(el.leadForm, 'submit', (ev) => ev.preventDefault());
    on(el.followUpForm, 'submit', (ev) => ev.preventDefault());

    // Atajos de fecha del seguimiento ("mañana", "en 3 días"…)
    on(el.modalFollowUp, 'click', (ev) => {
      const b = ev.target?.closest?.('[data-fu-days]');
      if (!b || !el.fu_next) return;
      el.fu_next.value = addDaysISODate_(toInt(b.dataset.fuDays));
    });

    // Acciones de cada fila de interesados
    on(el.leadsBody, 'click', async (ev) => {
      const b = ev.target?.closest?.('[data-lead-act]');
      if (!b) return;

      const act = b.dataset.leadAct;
      const id = b.dataset.id;
      if (!act || !id) return;

      try {
        if (act === 'follow') openFollowUpModal_(id);
        else if (act === 'convert') await convertLeadToSale_(id);
        else if (act === 'lost') await markLeadLost_(id);
        else if (act === 'reopen') await reopenLead_(id);
        else if (act === 'edit') {
          await ensureProductsLoaded_().catch(() => {});
          const lead = (State.get().leads || []).find(l => String(l.id) === String(id));
          if (lead) openLeadModal_(lead);
        }
      } catch (e) {
        toast(e?.message || String(e), false);
      }
    });

    // ✅ Regla de precios (admin)
    on(el.btnPricingRules, 'click', () => { openPricingModal_().catch(e => toast(e?.message || String(e), false)); });
    on(el.btnSavePricing, 'click', async () => { await savePricingRules_(); });
    on(el.btnMigrateCosts, 'click', async () => { await runCostMigration_(); });
    on(el.pricingPreviewCost, 'input', debounce(() => renderPricingPreview_(), 120));
    on(el.pricingRoundTo, 'input', debounce(() => { markPricingDirty_(); renderPricingPreview_(); }, 120));
    on(el.pricingRoundMode, 'change', () => { markPricingDirty_(); renderPricingPreview_(); });
    on(el.pricingTiersBody, 'input', debounce(() => {
      markPricingDirty_();
      syncPricingDraft_();
      refreshPricingLabels_();
      renderPricingPreview_();
    }, 120));

    on(el.btnPricingAddTier, 'click', () => {
      markPricingDirty_();
      syncPricingDraft_();

      // Inserta un rango con tope justo antes del tramo abierto (que va último).
      const tiers = PRICING.draft.tiers;
      tiers.splice(Math.max(0, tiers.length - 1), 0, { max: 0, margin_pct: 0 });
      renderPricingForm_();
    });

    on(el.pricingTiersBody, 'click', (ev) => {
      const btn = ev.target?.closest?.('[data-tier-del]');
      if (!btn) return;

      markPricingDirty_();
      syncPricingDraft_();
      const idx = toInt(btn.dataset.tierDel);
      const next = PRICING.draft.tiers.filter((_, i) => i !== idx);
      PRICING.draft.tiers = next.length ? next : [{ max: 0, margin_pct: 0 }];
      renderPricingForm_();
    });
    on(el.s_product_query, 'input', debounce(() => syncStockProductSelection_(), 120));
    on(el.s_mode, 'change', () => syncStockModeUI_());

    on(el.btnRestockOpen, 'click', () => openRestockUI_());

    on(el.inventoryBody, 'click', async (ev) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!act || !id) return;

      try {
        if (act === 'inventory_adjust') {
          await openStockModal_(id);
        } else if (act === 'inventory_meta') {
          await openInventoryMetaModal_(id);
        } else if (act === 'edit') {
          await ensureProductsLoaded_().catch(() => {});
          const p = State.productsIndex().get(String(id)) || null;
          if (p) openProductModal_(p);
        } else if (act === 'restock_add') {
          await ensureProductsLoaded_().catch(() => {});
          restockAddFromProductId_(id);
        }
      } catch (e) {
        toast(e?.message || String(e), false);
      }
    });

    on(el.catalogBody, 'click', async (ev) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!act || !id) return;

      try {
        if (act === 'edit') {
          await ensureProductsLoaded_().catch(() => {});
          const p = State.productsIndex().get(String(id)) || null;
          openProductModal_(p);
        } else if (act === 'toggle') {
          const cur = btn.dataset.active === '1';
          await toggleProductActive_(id, cur);
        } else if (act === 'restock_add') {
          await ensureProductsLoaded_().catch(() => {});
          restockAddFromProductId_(id);
        }
      } catch (e) {
        toast(e?.message || String(e), false);
      }
    });

    on(el.btnRefreshOrders, 'click', async () => {
      await ensureOrdersLoaded_(true).catch(() => {});
      renderOrders_();
      toast('Pedidos actualizados ✅', true);
    });

    on(el.ordersBody, 'click', async (ev) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;

      const openId = btn.dataset.orderOpen;
      const payId = btn.dataset.orderPay;
      const paymentId = btn.dataset.orderPayment;
      const delId = btn.dataset.orderDel;
      const detailId = btn.dataset.orderDetail;
      const deleteId = btn.dataset.orderDelete;

      if (openId !== undefined) { await openOrder_(openId); return; }
      if (payId !== undefined) { await markOrderPaid_(payId); return; }
      if (paymentId !== undefined) { await addInstallmentPayment_(paymentId); return; }
      if (detailId !== undefined) { await openSaleDetail_(detailId); return; }
      if (deleteId !== undefined) { await deleteSaleDetail_(deleteId); return; }
      if (delId !== undefined) {
        removeLocalOrder_(delId);
        renderOrders_();
        toast('Pedido eliminado 🗑️', true);
        return;
      }
    });

    on(el.ordersFilter, 'change', () => renderOrders_());

    // Detalle de venta
    on(el.btnSaveSaleDetail, 'click', async () => { try { await saveSaleDetail_(); } catch {} });
    on(el.btnDeleteSale, 'click', async () => { try { await deleteSaleDetail_(); } catch {} });
    on(el.btnAddPaymentDetail, 'click', async () => { try { await addPaymentFromDetail_(); } catch {} });

    on(el.sd_paymentsBody, 'click', async (ev) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;
      if (btn.dataset.payEdit !== undefined) { await editPaymentDetail_(toInt(btn.dataset.payEdit)); return; }
      if (btn.dataset.payDel !== undefined) { await deletePaymentDetail_(toInt(btn.dataset.payDel)); return; }
    });

    // Cerrar diálogos con data-close-dialog (delegado global)
    document.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('[data-close-dialog]');
      if (!b) return;
      const dlg = document.getElementById(String(b.dataset.closeDialog || ''));
      if (dlg && typeof dlg.close === 'function' && dlg.open) dlg.close();
    });

    on(el.saleSearch, 'keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); addToSale_(); }
    });

    on(el.saleItemsBody, 'input', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement)) return;

      const st = State.get();
      const items = Array.isArray(st.saleItems) ? st.saleItems : [];

      if (t.dataset.saleQty !== undefined) {
        const idx = toInt(t.dataset.saleQty);
        const v = Math.max(1, toInt(t.value));
        if (!items[idx]) return;
        const next = items.map((it, i) => (i === idx ? { ...it, qty: v } : it));
        State.setSaleItems(next);
        updateSaleTotalOnly_(next);
        scheduleSaleRender_();
        return;
      }

      if (t.dataset.salePrice !== undefined) {
        const idx = toInt(t.dataset.salePrice);
        const v = Math.max(0, toInt(t.value));
        if (!items[idx]) return;
        const next = items.map((it, i) => (i === idx ? { ...it, unit_price: v } : it));
        State.setSaleItems(next);
        updateSaleTotalOnly_(next);
        scheduleSaleRender_();
      }
    });

    on(el.saleItemsBody, 'click', (ev) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;
      if (btn.dataset.saleDel !== undefined) {
        const idx = toInt(btn.dataset.saleDel);
        const st = State.get();
        const items = Array.isArray(st.saleItems) ? st.saleItems : [];
        const next = items.filter((_, i) => i !== idx);
        State.setSaleItems(next);
        scheduleSaleRender_();
      }
    });

    on(el.restockSupplier, 'input', debounce(() => {
      State.setRestockMeta({ supplier: el.restockSupplier?.value || '' });
    }, 150));

    on(el.restockNotes, 'input', debounce(() => {
      State.setRestockMeta({ notes: el.restockNotes?.value || '' });
    }, 150));

    on(el.restockBody, 'input', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement)) return;

      if (t.dataset.restockQty !== undefined) {
        const pid = String(t.dataset.restockQty || '').trim();
        State.restockSetQty(pid, Math.max(0, toInt(t.value)));
        scheduleRestockRender_();
        return;
      }
      if (t.dataset.restockCost !== undefined) {
        const pid = String(t.dataset.restockCost || '').trim();
        State.restockSetCost(pid, Math.max(0, toInt(t.value)));
        scheduleRestockRender_();
      }
    });

    on(el.restockBody, 'click', (ev) => {
      const btn = ev.target?.closest?.('button');
      if (!btn) return;
      if (btn.dataset.restockDel !== undefined) {
        const pid = String(btn.dataset.restockDel || '').trim();
        State.restockRemove(pid);
        scheduleRestockRender_();
      }
    });

    on(el.btnClearRestock, 'click', () => {
      State.restockClear(true);
      scheduleRestockRender_();
      toast('Restock limpiado 🧹', true);
    });

    on(el.btnPrintRestock, 'click', () => restockPrint_());
    on(el.btnCloseRestock, 'click', () => el.modalRestock?.close?.());

    // ✅ Un solo listener global: restock open + tab restock (consolidado)
    document.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('[data-restock-open],button');
      if (!b) return;

      if (b.matches?.('[data-restock-open]')) {
        openRestockUI_();
        return;
      }

      if (b.dataset?.act === 'restock_open') openRestockUI_();
      if (b.dataset?.tab === 'restock' && tabSection_('restock')) showTab('restock');
    }, { passive: true });
  }

  /* =========================
     Interesados (leads)
     -------------------------
     Alguien pregunta por una guitarra pero no se decide: queda aquí con una
     fecha de próximo contacto, y se le hace seguimiento hasta que compra.
  ========================= */
  // Solo clases que existen en styles.css: .badge (verde), --warn (ámbar), --off (rojo).
  const LEAD_STATUS = Object.freeze({
    nuevo: { label: 'Nuevo', cls: 'badge--warn' },
    seguimiento: { label: 'En seguimiento', cls: 'badge--warn' },
    ganado: { label: 'Compró', cls: '' },
    perdido: { label: 'No compró', cls: 'badge--off' },
  });

  const LEADS_LOAD = { inflight: null, loadedOnce: false };

  /* Enlace temporal interesado → venta en curso. */
  const LEAD_LINK = { leadId: '' };

  function todayISODate_() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function addDaysISODate_(days) {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(0, toInt(days)));
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function leadIsActive_(lead) {
    const s = String(lead?.status || 'nuevo');
    return s !== 'ganado' && s !== 'perdido';
  }

  /* 'overdue' | 'today' | 'future' | 'none' */
  function leadDueState_(lead) {
    if (!leadIsActive_(lead)) return 'none';
    const when = String(lead?.next_contact_at || '').trim();
    if (!when) return 'none';
    const today = todayISODate_();
    if (when < today) return 'overdue';
    if (when === today) return 'today';
    return 'future';
  }

  function leadsDueCount_() {
    const list = Array.isArray(State.get().leads) ? State.get().leads : [];
    return list.filter(l => ['overdue', 'today'].includes(leadDueState_(l))).length;
  }

  function fmtDateOnly_(iso) {
    const raw = String(iso || '').trim();
    if (!raw) return '—';
    const [y, m, d] = raw.split('-').map(Number);
    if (!y || !m || !d) return raw;
    try {
      return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
        .format(new Date(y, m - 1, d));
    } catch { return raw; }
  }

  function waLink_(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 7) return '';
    const full = digits.length === 10 ? `57${digits}` : digits; // celular colombiano
    return `https://wa.me/${full}`;
  }

  async function ensureLeadsLoaded_(force = false) {
    // Igual que el catálogo: si ya hay datos (caché local), pintamos de una y
    // no dejamos la tabla en "Cargando…" esperando la red.
    const hasCached = Array.isArray(State.get().leads) && State.get().leads.length > 0;
    if (!force && (LEADS_LOAD.loadedOnce || hasCached)) return;
    if (LEADS_LOAD.inflight) return LEADS_LOAD.inflight;

    LEADS_LOAD.inflight = (async () => {
      try {
        const res = await StoreAPI.listLeads();
        State.setLeads(Array.isArray(res?.items) ? res.items : []);
        LEADS_LOAD.loadedOnce = true;
      } catch (e) {
        console.warn('[leads]', e);
      }
    })().finally(() => { LEADS_LOAD.inflight = null; });

    return LEADS_LOAD.inflight;
  }

  async function refreshAfterLeadChange_() {
    await ensureLeadsLoaded_(true).catch(() => {});
    renderActive_();
  }

  function renderLeadsBadge_() {
    if (!el.leadsBadge) return;
    const n = leadsDueCount_();
    el.leadsBadge.textContent = String(n);
    el.leadsBadge.hidden = n === 0;
  }

  function renderLeads_() {
    if (!el.leadsBody) return;

    const st = State.get();
    const q = String(el.qLeads?.value || '').toLowerCase().trim();
    const onlyDue = !!el.onlyLeadsDue?.checked;

    let list = Array.isArray(st.leads) ? st.leads.slice() : [];

    if (q) {
      list = list.filter(l => [l.name, l.phone, l.interest, l.product_name]
        .map(x => String(x || '').toLowerCase()).join(' ').includes(q));
    }
    if (onlyDue) list = list.filter(l => ['overdue', 'today'].includes(leadDueState_(l)));

    // Primero los que tocan hoy o están atrasados; los cerrados al final.
    const rank = (l) => {
      const d = leadDueState_(l);
      if (d === 'overdue') return 0;
      if (d === 'today') return 1;
      if (!leadIsActive_(l)) return 4;
      return d === 'future' ? 2 : 3;
    };
    list.sort((a, b) => (rank(a) - rank(b)) || String(a.next_contact_at || '').localeCompare(String(b.next_contact_at || '')));

    if (!list.length) {
      el.leadsBody.innerHTML = `<tr><td colspan="6" class="muted">${
        q || onlyDue ? 'No hay resultados.' : 'Aún no hay interesados. Agrega el primero con “Nuevo interesado”.'
      }</td></tr>`;
      return;
    }

    const idx = State.productsIndex();

    el.leadsBody.innerHTML = list.map(l => {
      const id = escapeHtml(String(l.id || ''));
      const due = leadDueState_(l);
      const st_ = LEAD_STATUS[String(l.status || 'nuevo')] || LEAD_STATUS.nuevo;

      const wa = waLink_(l.phone);
      const persona = `
        <div class="cellTitle">${escapeHtml(l.name || '—')}</div>
        <div class="cellSub muted tiny">${
          l.phone
            ? (wa
                ? `<a href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.phone)} · WhatsApp</a>`
                : escapeHtml(l.phone))
            : 'Sin teléfono'
        }</div>
      `;

      const prod = l.product_id ? idx.get(String(l.product_id)) : null;
      const interes = `
        <div>${escapeHtml(prod?.name || l.product_name || l.interest || '—')}</div>
        ${prod && l.interest ? `<div class="cellSub muted tiny">${escapeHtml(l.interest)}</div>` : ''}
        ${!prod && l.product_id ? `<div class="cellSub muted tiny">Producto ya no existe</div>` : ''}
      `;

      const dueBadge = due === 'overdue'
        ? ` <span class="badge badge--warn">Atrasado</span>`
        : (due === 'today' ? ` <span class="badge badge--warn">Hoy</span>` : '');

      const history = Array.isArray(l.history) ? l.history : [];
      const last = history.length ? history[history.length - 1] : null;
      const ultimo = last
        ? `<div class="tiny">${escapeHtml(String(last.note || '').slice(0, 90))}</div>
           <div class="cellSub muted tiny">${escapeHtml(fmtDatePart_(last.at))}</div>`
        : `<span class="muted tiny">Sin seguimientos</span>`;

      const acciones = leadIsActive_(l)
        ? `<button class="btn btn--tiny btn--ghost" data-lead-act="follow" data-id="${id}">Seguimiento</button>
           <button class="btn btn--tiny btn--primary" data-lead-act="convert" data-id="${id}">Convertir en venta</button>
           <button class="btn btn--tiny btn--ghost" data-lead-act="lost" data-id="${id}">No compró</button>
           <button class="btn btn--tiny btn--ghost" data-lead-act="edit" data-id="${id}">Editar</button>`
        : `<button class="btn btn--tiny btn--ghost" data-lead-act="reopen" data-id="${id}">Reabrir</button>
           <button class="btn btn--tiny btn--ghost" data-lead-act="edit" data-id="${id}">Editar</button>`;

      return `
        <tr>
          <td>${persona}</td>
          <td>${interes}</td>
          <td><span class="badge ${st_.cls}">${escapeHtml(st_.label)}</span></td>
          <td class="tiny">${escapeHtml(fmtDateOnly_(l.next_contact_at))}${dueBadge}</td>
          <td>${ultimo}</td>
          <td class="num actionsCell">${acciones}</td>
        </tr>
      `;
    }).join('');
  }

  /* -------- Modal interesado -------- */
  function openLeadModal_(lead) {
    const isNew = !lead;
    if (el.leadTitle) el.leadTitle.textContent = isNew ? 'Nuevo interesado' : 'Editar interesado';

    if (el.l_id) el.l_id.value = lead?.id || '';
    if (el.l_name) el.l_name.value = lead?.name || '';
    if (el.l_phone) el.l_phone.value = lead?.phone || '';
    if (el.l_interest) el.l_interest.value = lead?.interest || '';
    if (el.l_next_contact) el.l_next_contact.value = lead?.next_contact_at || (isNew ? addDaysISODate_(3) : '');
    if (el.l_status) el.l_status.value = String(lead?.status || 'nuevo');
    if (el.l_notes) el.l_notes.value = lead?.notes || '';

    const p = lead?.product_id ? State.productsIndex().get(String(lead.product_id)) : null;
    if (el.l_product_id) el.l_product_id.value = p ? String(lead.product_id) : '';
    if (el.l_product_query) el.l_product_query.value = p ? buildProductOptionLabel_(p) : (lead?.product_name || '');

    buildSaleDatalist_();

    // Historial de seguimientos
    const history = Array.isArray(lead?.history) ? lead.history : [];
    if (el.l_historyWrap) el.l_historyWrap.hidden = !history.length;
    if (el.l_historyBody) {
      el.l_historyBody.innerHTML = history.slice().reverse().map(h => `
        <tr>
          <td class="tiny">${escapeHtml(fmtDateTime_(h.at))}</td>
          <td class="tiny">${escapeHtml(h.note || '—')}</td>
          <td class="tiny muted">${escapeHtml(h.by || '—')}</td>
        </tr>
      `).join('');
    }

    if (el.btnDeleteLead) el.btnDeleteLead.hidden = isNew;

    el.modalLead?.showModal?.();
    try { el.l_name?.focus?.({ preventScroll: true }); } catch {}
  }

  function readLeadForm_() {
    // El campo de producto acepta texto libre: si no coincide con el catálogo,
    // se guarda como descripción (así se puede registrar algo que aún no existe).
    const raw = String(el.l_product_query?.value || '').trim();
    const matched = parseProductIdFromInput_(raw) || String(el.l_product_id?.value || '').trim();
    const stillValid = matched && State.productsIndex().has(matched);

    return {
      id: String(el.l_id?.value || '').trim(),
      name: safeStr_(el.l_name?.value, 180),
      phone: safeStr_(el.l_phone?.value, 40),
      product_id: stillValid ? matched : '',
      product_name: stillValid ? '' : safeStr_(raw, 220),
      interest: safeStr_(el.l_interest?.value, 400),
      next_contact_at: String(el.l_next_contact?.value || '').trim(),
      status: String(el.l_status?.value || 'nuevo'),
      notes: safeStr_(el.l_notes?.value, 2000),
    };
  }

  async function saveLead_() {
    const lead = readLeadForm_();
    if (!lead.name) { toast('Falta el nombre de la persona', false); return; }

    setBusy_(true, 'Guardando interesado…');
    try {
      await StoreAPI.upsertLead(lead, Roles.email());
      toast(lead.id ? 'Interesado actualizado ✅' : 'Interesado agregado ✅', true);
      el.modalLead?.close?.();
      await refreshAfterLeadChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function deleteLead_() {
    const id = String(el.l_id?.value || '').trim();
    if (!id) return;
    if (!confirm('¿Eliminar este interesado? No se puede deshacer.')) return;

    setBusy_(true, 'Eliminando…');
    try {
      await StoreAPI.deleteLead(id);
      toast('Interesado eliminado', true);
      el.modalLead?.close?.();
      await refreshAfterLeadChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  /* -------- Seguimiento -------- */
  function openFollowUpModal_(leadId) {
    const lead = (State.get().leads || []).find(l => String(l.id) === String(leadId));
    if (!lead) { toast('No encontré ese interesado', false); return; }

    if (el.fu_lead_id) el.fu_lead_id.value = lead.id;
    if (el.fu_who) el.fu_who.textContent = `${lead.name || '—'}${lead.phone ? ' · ' + lead.phone : ''}`;
    if (el.fu_note) el.fu_note.value = '';
    if (el.fu_next) el.fu_next.value = addDaysISODate_(3);

    el.modalFollowUp?.showModal?.();
    try { el.fu_note?.focus?.({ preventScroll: true }); } catch {}
  }

  async function saveFollowUp_() {
    const id = String(el.fu_lead_id?.value || '').trim();
    if (!id) return;

    const note = safeStr_(el.fu_note?.value, 1200);
    if (!note) { toast('Escribe qué pasó en el contacto', false); return; }

    setBusy_(true, 'Guardando seguimiento…');
    try {
      await StoreAPI.addLeadFollowUp(id, {
        note,
        nextContactAt: String(el.fu_next?.value || '').trim(),
        by: Roles.email(),
      });
      toast('Seguimiento registrado ✅', true);
      el.modalFollowUp?.close?.();
      await refreshAfterLeadChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function markLeadLost_(leadId) {
    const reason = prompt('¿Por qué no compró? (opcional)') ?? null;
    if (reason === null) return; // canceló

    setBusy_(true, 'Guardando…');
    try {
      await StoreAPI.setLeadStatus(leadId, 'perdido', { reason: safeStr_(reason, 400), by: Roles.email() });
      toast('Marcado como “no compró”', true);
      await refreshAfterLeadChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function reopenLead_(leadId) {
    setBusy_(true, 'Guardando…');
    try {
      await StoreAPI.setLeadStatus(leadId, 'seguimiento', { by: Roles.email() });
      toast('Interesado reabierto ✅', true);
      await refreshAfterLeadChange_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  /* Convertir en venta: abre el carrito ya cargado y deja el enlace pendiente
     para marcar al interesado como "compró" cuando la venta se guarde. */
  async function convertLeadToSale_(leadId) {
    const lead = (State.get().leads || []).find(l => String(l.id) === String(leadId));
    if (!lead) { toast('No encontré ese interesado', false); return; }

    await ensureProductsLoaded_().catch(() => {});

    showTab('sales');
    openNewSale_();

    LEAD_LINK.leadId = String(lead.id);

    if (el.saleCustomer) el.saleCustomer.value = lead.name || '';
    if (el.saleNotes) {
      const extra = [lead.phone ? `Tel: ${lead.phone}` : '', lead.interest || ''].filter(Boolean).join(' · ');
      el.saleNotes.value = extra ? `Interesado: ${extra}` : '';
    }

    const p = lead.product_id ? State.productsIndex().get(String(lead.product_id)) : null;
    if (p) {
      State.setSaleItems([{
        product_id: String(p.id),
        name: p.name || String(p.id),
        qty: 1,
        unit_price: pickPriceCOP_(p),
      }]);
      scheduleSaleRender_();
      toast('Carrito listo con el producto de interés 🛒', true);
    } else {
      toast(lead.product_name
        ? `Buscaba: ${lead.product_name}. Agrégalo al carrito.`
        : 'Agrega los productos al carrito.', true);
    }
  }

  /* Se llama tras guardar una venta que venía de un interesado.
     El id llega por parámetro porque closeSale_() ya limpió el enlace. */
  async function closeLeadAfterSale_(saleId, leadId) {
    if (!leadId) return;

    try {
      await StoreAPI.setLeadStatus(leadId, 'ganado', { saleId: String(saleId || ''), by: Roles.email() });
      await ensureLeadsLoaded_(true).catch(() => {});
      renderLeadsBadge_();
      toast('Interesado marcado como “compró” 🎉', true);
    } catch (e) {
      // La venta ya quedó guardada: esto no debe romper el flujo.
      console.warn('[leads] no pude cerrar el interesado:', e);
      toast('Venta guardada, pero no pude marcar al interesado. Ciérralo a mano.', false);
    }
  }

  /* =========================
     Regla de precios (solo admin)
  ========================= */
  async function openPricingModal_() {
    if (!Roles.can('edit_pricing')) { toast('Solo admin puede cambiar la regla de precios.', false); return; }

    // Pintamos ya con lo que tenemos y refrescamos cuando Firestore responda,
    // para que el modal nunca se quede en "Cargando…".
    resetPricingDraft_();
    renderPricingForm_();
    el.modalPricing?.showModal?.();

    await ensurePricingLoaded_(true).catch(() => {});

    // Si el admin ya empezó a escribir, la respuesta tardía de Firestore NO le
    // borra lo que lleva hecho.
    if (el.modalPricing?.open && !PRICING.draftTouched) {
      resetPricingDraft_();
      renderPricingForm_();
    }
  }

  const markPricingDirty_ = () => { PRICING.draftTouched = true; };

  /* Etiqueta legible de una fila del editor de rangos. */
  function pricingRowLabel_(tiers, i) {
    const isOpen = (i === tiers.length - 1);
    const max = toInt(tiers[i]?.max);
    const prevMax = i > 0 ? toInt(tiers[i - 1].max) : 0;

    if (isOpen) return prevMax > 0 ? `Más de ${fmtCOP(prevMax)}` : 'Cualquier costo';
    if (max <= 0) return '—';
    return prevMax > 0 ? `${fmtCOP(prevMax + 1)} – ${fmtCOP(max)}` : `Hasta ${fmtCOP(max)}`;
  }

  /* Refresca solo la columna "Rango" mientras el admin escribe: repintar la
     tabla entera le quitaría el foco del campo. */
  function refreshPricingLabels_() {
    if (!el.pricingTiersBody || !PRICING.draft) return;
    const rows = el.pricingTiersBody.querySelectorAll('tr');
    for (let i = 0; i < rows.length; i++) {
      const cell = rows[i].children[2];
      if (cell) cell.textContent = pricingRowLabel_(PRICING.draft.tiers, i);
    }
  }

  /* El modal trabaja sobre un borrador: si cancelas, la regla vigente no cambia. */
  function resetPricingDraft_() {
    const s = normalizePricing(PRICING.settings);
    PRICING.draftTouched = false;
    PRICING.draft = {
      version: s.version,
      round_to: s.round_to,
      round_mode: s.round_mode,
      // Sin regla previa arrancamos con un rango con tope (para llenar) MÁS el
      // tramo abierto. Si solo dejáramos el abierto no habría dónde escribir el
      // tope del primer rango.
      tiers: s.tiers.length
        ? s.tiers.map(t => ({ ...t }))
        : [{ max: 0, margin_pct: 0 }, { max: 0, margin_pct: 0 }],
    };
  }

  /* La última fila SIEMPRE es el tramo abierto ("en adelante"); las demás llevan
     tope editable, aunque todavía estén vacías. */
  function renderPricingForm_() {
    if (!PRICING.draft) resetPricingDraft_();

    if (el.pricingRoundTo) el.pricingRoundTo.value = String(PRICING.draft.round_to);
    if (el.pricingRoundMode) el.pricingRoundMode.value = PRICING.draft.round_mode;

    if (el.pricingTiersBody) {
      const tiers = PRICING.draft.tiers;
      const last = tiers.length - 1;

      el.pricingTiersBody.innerHTML = tiers.map((t, i) => {
        const isOpen = (i === last);
        const max = toInt(t.max);
        const label = pricingRowLabel_(tiers, i);

        return `
          <tr>
            <td>
              ${isOpen
                ? `<span class="muted tiny">En adelante</span>`
                : `<input class="input input--sm mono" type="number" min="0" step="1000"
                     value="${max > 0 ? max : ''}" placeholder="Ej: 50000" data-tier-max="${i}" />`}
            </td>
            <td class="num">
              <input class="input input--sm mono" type="number" min="0" step="1"
                value="${toFloat(t.margin_pct) > 0 ? toFloat(t.margin_pct) : ''}" placeholder="Ej: 45" data-tier-margin="${i}" />
            </td>
            <td class="tiny muted">${escapeHtml(label)}</td>
            <td class="num">
              ${isOpen ? '' : `<button class="btn btn--tiny btn--ghost" type="button" data-tier-del="${i}" title="Quitar rango">✕</button>`}
            </td>
          </tr>
        `;
      }).join('');
    }

    renderPricingPreview_();

    if (el.pricingStatus) {
      if (!pricingReady_()) {
        el.pricingStatus.textContent =
          '⚠ Aún no hay regla guardada. Los porcentajes no viven en el código (el repositorio es público): ' +
          'defínelos aquí y quedan protegidos en Firestore. Hasta entonces la app no sugiere precios.';
      } else {
        el.pricingStatus.textContent = normalizePricing(PRICING.settings).updated_by
          ? `Regla vigente · última edición: ${normalizePricing(PRICING.settings).updated_by}`
          : 'Regla vigente.';
      }
    }
  }

  /* Vuelca lo escrito en pantalla al borrador (sin guardar en Firestore). */
  function syncPricingDraft_() {
    if (!PRICING.draft) resetPricingDraft_();

    PRICING.draft.tiers = PRICING.draft.tiers.map((t, i) => {
      const maxEl = el.pricingTiersBody?.querySelector(`[data-tier-max="${i}"]`);
      const marginEl = el.pricingTiersBody?.querySelector(`[data-tier-margin="${i}"]`);
      return {
        max: maxEl ? Math.max(0, toInt(maxEl.value)) : Math.max(0, toInt(t.max)),
        margin_pct: marginEl ? Math.max(0, toFloat(marginEl.value)) : Math.max(0, toFloat(t.margin_pct)),
      };
    });

    PRICING.draft.round_to = Math.max(0, toInt(el.pricingRoundTo?.value ?? PRICING.draft.round_to));
    PRICING.draft.round_mode = String(el.pricingRoundMode?.value || PRICING.draft.round_mode);

    return PRICING.draft;
  }

  /* Lee el formulario y lo devuelve ya normalizado (sin guardar todavía). */
  function readPricingForm_() {
    const d = syncPricingDraft_();
    return normalizePricing({ ...d, updated_by: normalizePricing(PRICING.settings).updated_by });
  }

  function renderPricingPreview_() {
    if (!el.pricingPreviewOut) return;

    const draft = readPricingForm_();
    const cost = toInt(el.pricingPreviewCost?.value);

    const warns = tierWarnings(draft).map(w => `⚠ ${w.message}`).join('\n');

    let head = describeRounding(draft);
    if (!draft.configured) {
      head = 'Escribe el % de ganancia de cada rango para ver la prueba.';
    } else if (cost) {
      const r = priceFromCost(cost, draft);
      head = `Costo ${fmtCOP(cost)} → precio ${fmtCOP(r.price_cop)} (+${r.margin_pct}%, ${r.tier_label}) · utilidad ${fmtCOP(r.price_cop - cost)}`;
    }

    el.pricingPreviewOut.textContent = warns ? `${head}\n\n${warns}` : head;
    el.pricingPreviewOut.style.whiteSpace = 'pre-line';
  }

  async function savePricingRules_() {
    if (!Roles.can('edit_pricing')) return;

    syncPricingDraft_();

    // Fila a medio llenar: mejor avisar que descartarla en silencio.
    const rows = PRICING.draft.tiers;
    for (let i = 0; i < rows.length - 1; i++) {
      const { max, margin_pct } = rows[i];
      if (max <= 0 && margin_pct > 0) {
        toast(`Al rango ${i + 1} le falta el tope ("Costo hasta"). Escríbelo o quita la fila.`, false);
        return;
      }
      if (max > 0 && margin_pct <= 0) {
        toast(`Al rango ${i + 1} le falta el % de ganancia.`, false);
        return;
      }
    }

    if (toFloat(rows[rows.length - 1]?.margin_pct) <= 0) {
      toast('Falta el % del tramo "En adelante": es el que se aplica a todo lo demás.', false);
      return;
    }

    const draft = readPricingForm_();

    if (!draft.configured) {
      toast('Escribe al menos un % de ganancia mayor que 0 antes de guardar.', false);
      return;
    }

    setBusy_(true, 'Guardando regla de precios…');
    try {
      await StoreAPI.savePricingSettings(draft, Roles.email());
      PRICING.settings = draft;
      PRICING.loaded = true;
      toast('Regla de precios actualizada ✅', true);
      el.modalPricing?.close?.();
      renderActive_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  async function runCostMigration_() {
    if (!Roles.can('manage_data')) return;

    const ok = confirm(
      'Esto mueve los costos que hoy están dentro de cada producto a la colección privada productCosts, ' +
      'y los borra de products/ para que las asesoras no puedan leerlos.\n\n' +
      'Se ejecuta una sola vez. ¿Continuar?'
    );
    if (!ok) return;

    setBusy_(true, 'Migrando costos…');
    try {
      const res = await StoreAPI.migrateCostsOutOfProducts(Roles.email());
      toast(`Listo: ${toInt(res.moved)} costo(s) movidos, ${toInt(res.cleaned)} producto(s) limpiados ✅`, true);
      COSTS.loaded = false;
      await Promise.allSettled([ensureProductsLoaded_(true), ensureCostsLoaded_(true)]);
      renderActive_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Auth state handling
  ========================= */
  function attachAuthListener_() {
    FB.onAuthStateChanged(FB.auth, async (user) => {
      try {
        State.setUser(user || null);

        if (!user) {
          Roles.clear();
          applyRoleUI_();
          if (el.userPill) el.userPill.hidden = true;
          setView('auth');
          showTab('catalog');
          setNet(true, navigator.onLine ? 'Listo' : 'Sin conexión');
          return;
        }

        const email = String(user.email || '').trim().toLowerCase();
        if (!ALLOWED_EMAILS.has(email)) {
          Roles.clear();
          applyRoleUI_();
          State.setIdToken('');
          setStoreApiToken_('');
          if (el.userPill) el.userPill.hidden = true;
          if (el.userEmail) el.userEmail.textContent = '—';
          setView('auth');
          setNet(true, navigator.onLine ? 'Listo' : 'Sin conexión');
          if (el.authStatus) el.authStatus.textContent = 'Este correo no tiene acceso al Store.';
          try { await FB.signOut(FB.auth); } catch {}
          return;
        }

        // Rol antes de pintar nada: define qué se ve y qué no.
        Roles.setEmail(email);
        applyRoleUI_();

        if (el.userPill) el.userPill.hidden = false;
        if (el.userEmail) el.userEmail.textContent = user.email || '—';

        setView('loading');

        let token = '';
        try {
          token = await user.getIdToken();
          State.setIdToken(token || '');
        } catch {
          State.setIdToken('');
        }

        if (token) setStoreApiToken_(token);

        try {
          await StoreAPI.ping();
          setNet(true, 'Conectado');
        } catch (e) {
          setNet(false, 'API error');
          throw e;
        }

        setView('app');
        applyRoleUI_();
        showTab('catalog');

        try { State.hydrateFromCache(); } catch {}

        // Regla de precios y costos (los costos solo si el rol puede leerlos).
        await Promise.allSettled([ensurePricingLoaded_(true), ensureCostsLoaded_(true)]);

        await loadAll_({ force: false });
        toast(`Sesión activa ✅ · ${Roles.label()}`, true);
      } catch (err) {
        console.error(err);
        toast(err?.message || String(err), false);
        setView('auth');
      }
    });
  }

  /* =========================
     Boot init
  ========================= */
  function init_() {
    wireUI_();
    attachAuthListener_();

    setView('loading');
    setNet(true, navigator.onLine ? 'Conectando…' : 'Sin conexión');

    window.addEventListener('online', () => setNet(true, 'Conectado'));
    window.addEventListener('offline', () => setNet(false, 'Sin conexión'));

    showTab('catalog');
    syncSalesUI_();
    renderMoves_();
    scheduleRestockRender_();

    try { if (el.modalRestock?.open) el.modalRestock.close(); } catch {}
  }

  init_();
}

/* Auto-boot del entrypoint modular. */
try {
  if (!window.__STORE_APP_BOOTED__) {
    window.__STORE_APP_BOOTED__ = true;
    await initFirebase();
    boot();
  }
} catch (err) {
  console.error('No se pudo iniciar Musicala Store.', err);
  try {
    document.body.dataset.view = 'auth';
    document.getElementById('viewLoading')?.setAttribute('hidden', '');
    document.getElementById('viewAuth')?.removeAttribute('hidden');
    const status = document.getElementById('authStatus');
    if (status) status.textContent = 'No se pudo iniciar el acceso con Google. Revisa la conexión e intenta de nuevo.';
  } catch {}
}



