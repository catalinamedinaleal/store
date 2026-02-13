'use strict';
/* =============================================================================
Store · app.js (GitHub Pages) — PRO++ v6.10 (completo y mejorado)

✅ Robustez extra: no explota si faltan IDs
✅ Restock SOLO visible post-login (vista app)
✅ FIX REAL: Restock Open no hace nada -> multi-hook + delegación + fallbacks
✅ Token plumbing: StoreAPI.setToken(token) si existe + apiPost() con token
✅ Restock PDF REAL (jsPDF + autoTable) + backup clipboard
✅ PDF Restock "COTIZACIÓN" (sin costos/totales) por defecto ✅✅✅
✅ Restock PDF: Producto | Descripción | Cant. (sin ID) ✅✅✅
✅ Restock texto backup: Producto — Descripción xCant (sin ID) ✅✅✅
✅ Orders: server-first + fallback local
✅ Sales UI: vacío solo si NO hay venta abierta y NO hay pedidos
✅ Dashboard mini-retry
✅ Compat layer getCfg* expuesto global
✅ ID AUTO real para productos (no bloquea Guardar)
✅ Tabs tolerantes: si falta btn o section, no se muere

Requiere:
- index.html con window.STORE_CFG y window.__FB__
- index.html carga jsPDF + autoTable (window.jspdf + doc.autoTable)
- api.js exporta: StoreAPI, apiPost
- state.js exporta: State
============================================================================= */

import { StoreAPI, apiPost } from './api.js';
import { State } from './state.js';

/* =========================
   CFG helpers (compat layer)
========================= */
function getCfg_(key, fallback = undefined) {
  const cfg =
    (globalThis.CFG && typeof globalThis.CFG === 'object' ? globalThis.CFG : null) ||
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

export function boot() {
  const CFG =
    (window.STORE_CFG && typeof window.STORE_CFG === 'object' ? window.STORE_CFG : null) ||
    (globalThis.CFG && typeof globalThis.CFG === 'object' ? globalThis.CFG : null) ||
    {};

  const API_BASE = String(CFG.API_BASE || '').trim();

  /* =========================
     DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const on = (node, ev, fn, opts) => node && node.addEventListener(ev, fn, opts);

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
    loginForm: $('loginForm'),
    email: $('email'),
    password: $('password'),
    btnGoogle: $('btnGoogle'),
    authStatus: $('authStatus'),
    apiHint: $('apiHint'),

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
    saleNotes: $('saleNotes'),
    btnSaveSale: $('btnSaveSale'),
    btnCancelSale: $('btnCancelSale'),

    // orders
    btnRefreshOrders: $('btnRefreshOrders'),
    ordersBody: $('ordersBody'),
    ordersMeta: $('ordersMeta'),
    ordersPane: $('ordersPane'),

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

    modalStock: $('modalStock'),
    stockForm: $('stockForm'),
    btnSaveStock: $('btnSaveStock'),
    s_product_id: $('s_product_id'),
    s_type: $('s_type'),
    s_qty: $('s_qty'),
    s_ref: $('s_ref'),
    s_note: $('s_note'),

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

    // optional: close button (si existe)
    btnCloseRestock: $('btnCloseRestock'),
  };

  /* =========================
     Sanity / Info
  ========================= */
  if (el.apiHint) el.apiHint.textContent = API_BASE ? API_BASE : '(API_BASE pendiente)';
  if (!API_BASE && el.authStatus) el.authStatus.textContent = 'Falta configurar API_BASE en index.html';

  /* =========================
     Firebase refs
  ========================= */
  const FB = window.__FB__;
  if (!FB || !FB.auth) {
    fatal_('Firebase no inicializado. Revisa index.html (__FB__).');
    return;
  }

  /* =========================
     Restock PDF behavior
     - true: PDF tipo cotización (sin costos ni totales)
     - false: PDF tipo orden (con costos)
  ========================= */
  const RESTOCK_PDF_HIDE_PRICES = getCfgBool_('RESTOCK_PDF_HIDE_PRICES', true);

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
    if (x === 'pagado') return 'paid';
    if (x === 'pendiente') return 'pending';
    if (x === 'cancelado') return 'cancelled';
    return x;
  }

  function safeStr_(v, max = 4000) {
    const s = String(v ?? '').trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  function pickPriceCOP_(p) { return toInt(p?.price_cop ?? p?.price ?? p?.precio_cop ?? p?.precio); }
  function pickCostCOP_(p) { return toInt(p?.cost_cop ?? p?.cost ?? p?.costo_cop ?? p?.costo); }

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
     Token / API plumbing
  ========================= */
  function getToken_() {
    const st = State.get();
    return String(st?.idToken || '');
  }

  async function apiPostAuthed_(payload) {
    const token = getToken_();
    const p = { ...(payload || {}) };
    if (token && !p.token) p.token = token;
    return apiPost(p);
  }

  function setStoreApiToken_(token) {
    try {
      if (StoreAPI && typeof StoreAPI.setToken === 'function') StoreAPI.setToken(token || '');
    } catch {}
  }

  /* =========================
     Toast
  ========================= */
  function toast(msg, ok = true) {
    if (!el.toast) return;
    el.toast.hidden = false;
    el.toast.textContent = String(msg || '');
    el.toast.classList.toggle('is-bad', !ok);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { if (el.toast) el.toast.hidden = true; }, 2600);
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

    d.addEventListener('cancel', (ev) => { if (State.get().busy) ev.preventDefault(); });

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

  /* =========================
     View + Net + Busy
  ========================= */
  function setView(name) {
    document.body.dataset.view = name;

    if (el.viewLoading) el.viewLoading.hidden = (name !== 'loading');
    if (el.viewAuth) el.viewAuth.hidden = (name !== 'auth');
    if (el.viewApp) el.viewApp.hidden = (name !== 'app');

    // ✅ Restock solo en app
    if (el.btnRestockOpen) el.btnRestockOpen.hidden = (name !== 'app');
  }

  function setNet(ok, label) {
    if (!el.netLabel) return;
    el.netLabel.textContent = label || (ok ? 'Conectado' : 'Sin conexión');
    el.netPill?.classList.toggle('is-bad', !ok);
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
    if (el.btnRefreshOrders) el.btnRefreshOrders.disabled = dis;
    if (el.btnLogout) el.btnLogout.disabled = dis;
    if (el.btnPrintRestock) el.btnPrintRestock.disabled = dis;
    if (el.btnClearRestock) el.btnClearRestock.disabled = dis;

    if (onFlag) busyShow(msg);
    else busyHide();
  }

  function fatal_(msg) {
    console.error('[STORE:FATAL]', msg);
    toast(msg, false);
    setNet(false, 'Error');
  }

  /* =========================
     Auth flows
  ========================= */
  async function loginEmailPass_(email, pass) {
    await FB.signInWithEmailAndPassword(FB.auth, email, pass);
  }
  async function loginGoogle_() {
    await FB.signInWithPopup(FB.auth, FB.googleProvider);
  }
  async function logout_() {
    await FB.signOut(FB.auth);
  }

  /* =========================
     Tabs (tolerantes)
  ========================= */
  const TAB_IDS = ['catalog', 'inventory', 'sales', 'moves', 'dashboard', 'restock'];

  function tabSection_(name) {
    return $('tab-' + name);
  }

  function showTab(tabName) {
    const next = TAB_IDS.includes(tabName) ? tabName : 'catalog';
    State.setTab(next);

    if (Array.isArray(el.tabs) && el.tabs.length) {
      TAB_IDS.forEach(n => {
        const btn = el.tabs.find(b => b && b.dataset && b.dataset.tab === n);
        if (btn) btn.classList.toggle('is-active', n === next);
      });
    }

    TAB_IDS.forEach(n => {
      const sec = tabSection_(n);
      if (sec) sec.hidden = (n !== next);
    });

    if (next === 'sales') syncSalesUI_();
    if (next === 'moves') loadMoves_(State.get().movesQuery || '');
    if (next === 'restock') renderRestock_();
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
      const r = await apiPostAuthed_({ action: 'sales.list', status: 'pending', include_items: false, limit: 300 });
      const items = Array.isArray(r.items) ? r.items : [];

      const orders = items.map(x => ({
        id: String(x.id || '').trim(),
        created_at: x.created_at || '',
        customer_id: x.customer_id || '',
        payment_method: x.payment_method || '',
        total_cop: toInt(x.total_cop),
        notes: x.notes || '',
        status: normStatus_(x.status || 'pending'),
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

  function renderOrders_() {
    if (!el.ordersBody) return;

    const st = State.get();
    const rows = Array.isArray(st.orders) ? st.orders : [];

    if (!rows.length) {
      el.ordersBody.innerHTML = `<tr><td colspan="5" class="muted">No hay pedidos pendientes.</td></tr>`;
      if (el.ordersMeta) {
        el.ordersMeta.textContent = (st.ordersSource === 'api')
          ? 'Fuente: servidor'
          : 'Fuente: local (este dispositivo)';
      }
      syncSalesUI_();
      return;
    }

    el.ordersBody.innerHTML = rows
      .slice()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .map(o => {
        const d = String(o.created_at || '');
        const cust = String(o.customer_id || '').trim() || '—';
        const total = fmtCOP(toInt(o.total_cop));
        const notes = String(o.notes || '').trim();

        const openBtn = `<button class="btn btn--tiny btn--ghost" data-order-open="${escapeHtml(String(o.id || ''))}">Abrir</button>`;
        const payBtn  = `<button class="btn btn--tiny btn--primary" data-order-pay="${escapeHtml(String(o.id || ''))}">Marcar pagado</button>`;
        const delBtn  = (st.ordersSource === 'local')
          ? `<button class="btn btn--tiny btn--ghost" data-order-del="${escapeHtml(String(o.id || ''))}">Eliminar</button>`
          : '';

        return `
          <tr>
            <td class="tiny muted">${escapeHtml(d || '')}</td>
            <td>${escapeHtml(cust)}</td>
            <td class="num mono">${escapeHtml(total)}</td>
            <td class="tiny">${escapeHtml(notes)}</td>
            <td class="num" style="white-space:nowrap;">
              <div class="row" style="gap:8px; justify-content:flex-end;">
                ${openBtn}
                ${payBtn}
                ${delBtn}
              </div>
            </td>
          </tr>
        `;
      }).join('');

    if (el.ordersMeta) {
      el.ordersMeta.textContent = (st.ordersSource === 'api')
        ? `Fuente: servidor · ${rows.length} pedido(s)`
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
    renderSaleItems_();
    syncSalesUI_();
    toast('Pedido cargado en la venta ✅', true);
  }

  async function openOrder_(id) {
    const key = String(id || '').trim();
    if (!key) return;

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

  async function markOrderPaid_(id) {
    const key = String(id || '').trim();
    if (!key) { toast('ID inválido', false); return; }

    const st = State.get();

    if (st.ordersSource === 'api') {
      setBusy_(true, 'Marcando pagado…');
      try {
        await apiPostAuthed_({ action: 'sale.updateStatus', id: key, status: 'paid' });
        toast('Pedido convertido a pagado ✅', true);
        await loadAll_();
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
      await loadAll_();
    } catch (e) {
      toast(e?.message || String(e), false);
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Data load (resiliente)
  ========================= */
  async function loadDashboardWithRetry_() {
    try {
      return await StoreAPI.dashboard();
    } catch {
      await sleep_(350);
      try { return await StoreAPI.dashboard(); } catch { return null; }
    }
  }

  async function loadAll_() {
    setBusy_(true, 'Cargando…');
    setNet(true, 'Cargando…');

    try {
      await loadOrders_().catch(() => {});
      renderOrders_();
      syncSalesUI_();

      const [pRes, invRes, dashRes] = await Promise.allSettled([
        StoreAPI.listProducts(''),
        StoreAPI.listInventory(),
        loadDashboardWithRetry_(),
      ]);

      if (pRes.status === 'fulfilled') {
        const p = pRes.value;
        State.setProducts(Array.isArray(p?.items) ? p.items : []);
        buildSaleDatalist_();
      } else {
        console.warn('Products failed:', pRes.reason);
        toast('No pude cargar productos (temporal).', false);
      }

      if (invRes.status === 'fulfilled') {
        const inv = invRes.value;
        State.setInventory(Array.isArray(inv?.items) ? inv.items : []);
      } else {
        console.warn('Inventory failed:', invRes.reason);
        toast('No pude cargar inventario (temporal).', false);
      }

      if (dashRes.status === 'fulfilled') {
        State.setDashboard(dashRes.value || null);
      } else {
        console.warn('Dashboard failed:', dashRes.reason);
        State.setDashboard(null);
      }

      State.setLastSync(new Date().toISOString());
      renderAll_();

      setNet(true, 'Conectado');
    } catch (e) {
      fatal_(e?.message || String(e));
      setNet(false, 'API error');
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  function renderAll_() {
    renderKPIs_();
    renderCatalog_();
    renderInventory_();
    renderDashboard_();
    renderOrders_();
    renderSaleItems_();
    renderMoves_();
    renderRestock_();
    syncSalesUI_();
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

  function renderDashboard_() {
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
    const q = String(el.qCatalog?.value || '').toLowerCase().trim();
    const list = (st.products || []).filter(p => {
      if (!q) return true;
      return (
        String(p.id || '').toLowerCase().includes(q) ||
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.brand || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q)
      );
    });

    if (!list.length) {
      el.catalogBody.innerHTML = `<tr><td colspan="8" class="muted">No hay resultados.</td></tr>`;
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
      const restockBtn = `<button class="btn btn--tiny btn--ghost" data-act="restock_add" data-id="${escapeHtml(p.id)}">Restock</button>`;

      return `
        <tr>
          <td class="mono">${escapeHtml(p.id)}</td>
          <td>
            <div class="cellTitle">${escapeHtml(p.name || '')}</div>
            <div class="cellSub muted tiny">${escapeHtml(p.desc || '')}</div>
          </td>
          <td>${escapeHtml(p.brand || '')}</td>
          <td>${escapeHtml(p.category || '')}</td>
          <td class="num mono">${fmtCOP(price)}</td>
          <td class="num mono">${toInt(stock)} ${stockBadge}</td>
          <td>${badge}</td>
          <td class="num">
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

    const q = String(el.qInventory?.value || '').toLowerCase().trim();
    const list = (st.inventory || []).filter(r => {
      if (!q) return true;

      const pid = String(r.product_id || '').toLowerCase();
      const p = idx.get(String(r.product_id || '').trim());
      const name = String(p?.name || '').toLowerCase();
      const brand = String(p?.brand || '').toLowerCase();
      const cat = String(p?.category || '').toLowerCase();
      const loc = String(r.location || '').toLowerCase();

      return pid.includes(q) || name.includes(q) || brand.includes(q) || cat.includes(q) || loc.includes(q);
    });

    if (!list.length) {
      el.inventoryBody.innerHTML = `<tr><td colspan="5" class="muted">No hay resultados.</td></tr>`;
      return;
    }

    el.inventoryBody.innerHTML = list.map(r => {
      const pid = String(r.product_id || '').trim();
      const p = idx.get(pid);

      const label = p
        ? `${escapeHtml(safeStr_(p.name || pid, 80))} <span class="muted tiny mono">(${escapeHtml(pid)})</span>`
        : `<span class="mono">${escapeHtml(pid)}</span>`;

      return `
        <tr>
          <td>${label}</td>
          <td class="num mono">${toInt(r.stock)}</td>
          <td class="num mono">${toInt(r.min_stock)}</td>
          <td>${escapeHtml(r.location || '')}</td>
          <td class="tiny muted">${escapeHtml(String(r.updated_at || ''))}</td>
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
    if (MOVES.inflight && MOVES.lastKey === key) return;

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
    if (el.saleSearch) el.saleSearch.value = '';
    if (el.saleCustomer) el.saleCustomer.value = '';
    if (el.saleNotes) el.saleNotes.value = '';
    if (el.salePay) el.salePay.value = 'cash';
    if (el.saleStatus) el.saleStatus.value = 'paid';

    renderSaleItems_();
    syncSalesUI_();
  }

  function closeSale_() {
    State.closeSale();
    renderSaleItems_();
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
      String(p.sku || '').toLowerCase().includes(needle)
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
    const idx = items.findIndex(x => String(x.product_id || '') === pid);

    let next;
    if (idx >= 0) {
      next = items.map((it, i) => (i === idx ? { ...it, qty: Math.max(1, toInt(it.qty) + 1) } : it));
    } else {
      next = items.concat([{ product_id: pid, name: p.name || pid, qty: 1, unit_price: unit }]);
    }

    State.setSaleItems(next);

    if (el.saleSearch) el.saleSearch.value = '';
    renderSaleItems_();
  }

  function renderSaleItems_() {
    if (!el.saleItemsBody || !el.saleTotal) return;

    const st = State.get();
    const items = Array.isArray(st.saleItems) ? st.saleItems : [];

    if (!items.length) {
      el.saleItemsBody.innerHTML = `<tr><td colspan="5" class="muted">Sin items…</td></tr>`;
      el.saleTotal.textContent = fmtCOP(0);
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
    };

    const computedTotal = items.reduce((acc, it) => acc + (toInt(it.qty) * toInt(it.unit_price)), 0);

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
      closeSale_();
      await loadAll_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Pricing helpers
  ========================= */
  const PRICING = { lock: false };

  function computePriceFromCostMargin_(cost, margin) {
    const c = Math.max(0, toInt(cost));
    const m = Math.max(0, toFloat(margin));
    if (!c) return 0;
    return Math.max(0, roundInt(c * (1 + (m / 100))));
  }

  function computeMarginFromCostPrice_(cost, price) {
    const c = Math.max(0, toInt(cost));
    const p = Math.max(0, toInt(price));
    if (!c) return 0;
    const m = ((p / c) - 1) * 100;
    return Math.max(0, Math.round(m * 10) / 10);
  }

  function syncPriceFromCostMargin_() {
    if (PRICING.lock || !el.p_margin) return;
    PRICING.lock = true;
    try {
      const cost = toInt(el.p_cost?.value);
      const margin = toFloat(el.p_margin?.value);
      const price = computePriceFromCostMargin_(cost, margin);
      if (el.p_price) el.p_price.value = String(price);
    } finally {
      PRICING.lock = false;
    }
  }

  function syncMarginFromCostPrice_() {
    if (PRICING.lock || !el.p_margin) return;
    PRICING.lock = true;
    try {
      const cost = toInt(el.p_cost?.value);
      const price = toInt(el.p_price?.value);
      const margin = computeMarginFromCostPrice_(cost, price);
      el.p_margin.value = cost ? String(margin) : '';
    } finally {
      PRICING.lock = false;
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

    const price = pickPriceCOP_(p);
    const cost = pickCostCOP_(p);

    if (el.p_price) el.p_price.value = String(price);
    if (el.p_cost) el.p_cost.value = String(cost);
    if (el.p_margin) el.p_margin.value = cost ? String(computeMarginFromCostPrice_(cost, price)) : '';

    if (el.p_desc) el.p_desc.value = p?.desc || '';
    if (el.p_image) el.p_image.value = p?.image_url || '';

    el.modalProduct?.showModal?.();
  }

  function readProductForm_() {
    const id = String(el.p_id?.value || '').trim();
    const cost = toInt(el.p_cost?.value);
    const price = toInt(el.p_price?.value);
    const margin = el.p_margin ? Math.max(0, toFloat(el.p_margin.value)) : 0;

    return {
      id,
      active: el.p_active?.value === 'true',
      name: safeStr_(el.p_name?.value, 220),
      brand: safeStr_(el.p_brand?.value, 160),
      category: safeStr_(el.p_category?.value, 160),
      sku: safeStr_(el.p_sku?.value, 120),

      price_cop: price,
      cost_cop: cost,

      price, cost,
      precio_cop: price, costo_cop: cost,
      precio: price, costo: cost,

      margin_pct: margin,
      desc: safeStr_(el.p_desc?.value, 4000),
      image_url: safeStr_(el.p_image?.value, 1200),
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

    setBusy_(true, 'Guardando producto…');
    try {
      const res = await StoreAPI.upsertProduct(prod);
      toast(res?.mode === 'created' ? 'Producto creado ✅' : 'Producto actualizado ✅', true);
      el.modalProduct?.close?.();
      await loadAll_();
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
      await loadAll_();
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
  function openStockModal_() {
    if (el.s_product_id) el.s_product_id.value = '';
    if (el.s_type) el.s_type.value = 'adjust';
    if (el.s_qty) el.s_qty.value = '';
    if (el.s_ref) el.s_ref.value = '';
    if (el.s_note) el.s_note.value = '';
    el.modalStock?.showModal?.();
  }

  async function saveStock_() {
    const product_id = String(el.s_product_id?.value || '').trim();
    const type = String(el.s_type?.value || 'adjust').trim();
    const qty = toInt(el.s_qty?.value);
    const ref = safeStr_(el.s_ref?.value, 200);
    const note = safeStr_(el.s_note?.value, 800);

    if (!product_id) { toast('Falta product_id', false); return; }
    if (!qty) { toast('Cantidad inválida (no puede ser 0)', false); return; }

    setBusy_(true, 'Guardando inventario…');
    try {
      const res = await StoreAPI.adjustStock({ product_id, type, qty, ref, note });
      toast(`Inventario actualizado ✅ (stock: ${toInt(res?.stock)})`, true);
      el.modalStock?.close?.();
      await loadAll_();
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

  function renderRestock_() {
    if (!restockUIEnabled_()) return;

    const r = State.getRestock();
    if (el.restockSupplier) el.restockSupplier.value = r.supplier || '';
    if (el.restockNotes) el.restockNotes.value = r.notes || '';

    const items = Array.isArray(r.items) ? r.items : [];
    const totals = State.restockTotals();

    if (!items.length) {
      el.restockBody.innerHTML = `<tr><td colspan="5" class="muted">Aún no hay ítems. Agrega desde <b>Catálogo</b> con “Restock”.</td></tr>`;
      if (el.restockTotalUnits) el.restockTotalUnits.textContent = '0';
      if (el.restockTotalCost) el.restockTotalCost.textContent = fmtCOP(0);
      return;
    }

    el.restockBody.innerHTML = items.map((it) => {
      const qty = Math.max(0, toInt(it.qty));
      const cost = Math.max(0, toInt(it.cost_cop));
      const subtotal = qty * cost;

      // ✅ Label: nombre + descripción (sin ID en UI principal)
      const name = String(it.name || it.id || '').trim();
      const desc = restockDesc_(it);

      const label = `
        <div class="cellTitle">${escapeHtml(name)}</div>
        <div class="cellSub muted tiny">${escapeHtml(desc)}</div>
      `;

      return `
        <tr>
          <td>${label}</td>
          <td class="num mono">
            <input class="miniNum" type="number" min="0" step="1" value="${qty}" data-restock-qty="${escapeHtml(it.id)}" />
          </td>
          <td class="num mono">
            <input class="miniNum" type="number" min="0" step="1" value="${cost}" data-restock-cost="${escapeHtml(it.id)}" />
          </td>
          <td class="num mono">${fmtCOP(subtotal)}</td>
          <td class="num">
            <button class="btn btn--tiny btn--ghost" data-restock-del="${escapeHtml(it.id)}" title="Quitar">✕</button>
          </td>
        </tr>
      `;
    }).join('');

    if (el.restockTotalUnits) el.restockTotalUnits.textContent = String(toInt(totals.units));
    if (el.restockTotalCost) el.restockTotalCost.textContent = fmtCOP(toInt(totals.cost_cop));
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

    renderRestock_();

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

    // ✅ Guardamos desc para que el PDF/texto tengan “Descripción”
    const product = {
      id: String(p.id || '').trim(),
      name: p.name || '',
      desc: p.desc || p.description || '',
      brand: p.brand || '',
      sku: p.sku || '',
      cost_cop: pickCostCOP_(p),
    };

    State.restockAddProduct(product, 1);
    renderRestock_();
    toast('Agregado a restock ✅', true);

    openRestockUI_();
  }

  function restockText_() {
    const r = State.getRestock();
    const totals = State.restockTotals();
    const items = Array.isArray(r.items) ? r.items : [];

    const lines = items.map(it => {
      const qty = Math.max(0, toInt(it.qty));
      const desc = restockDesc_(it);

      if (RESTOCK_PDF_HIDE_PRICES) {
        // ✅ SIN ID: producto — desc xqty
        return `• ${it.name || it.id} — ${desc}  x${qty}`;
      }

      const cost = Math.max(0, toInt(it.cost_cop));
      const sub = qty * cost;
      // En modo con precios, igual dejamos desc para claridad
      return `• ${it.name || it.id} — ${desc}  x${qty}  @ ${fmtCOP(cost)}  = ${fmtCOP(sub)}`;
    });

    const footer = RESTOCK_PDF_HIDE_PRICES
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

    // ✅ Tabla según modo (SIN ID en modo cotización)
    const head = RESTOCK_PDF_HIDE_PRICES
      ? [['Producto', 'Descripción', 'Cant.']]
      : [['Producto', 'Descripción', 'Cant.', 'Costo', 'Subtotal']];

    const body = items.map(it => {
      const qty = Math.max(0, toInt(it.qty));
      const desc = restockDesc_(it);

      if (RESTOCK_PDF_HIDE_PRICES) {
        return [String(it.name || it.id || ''), String(desc || '—'), qty];
      }

      const cost = Math.max(0, toInt(it.cost_cop));
      const sub = qty * cost;
      return [String(it.name || it.id || ''), String(desc || '—'), qty, fmtCOP(cost), fmtCOP(sub)];
    });

    // ✅ Column alignment
    const columnStyles = RESTOCK_PDF_HIDE_PRICES
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

        // ✅ Footer limpio en modo cotización
        const footer = RESTOCK_PDF_HIDE_PRICES
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
      try { await loadAll_(); toast('Actualizado ✅', true); }
      catch (e) { fatal_(e?.message || String(e)); }
    });

    on(el.loginForm, 'submit', async (ev) => {
      ev.preventDefault();
      try {
        const email = String(el.email?.value || '').trim();
        const pass = String(el.password?.value || '').trim();
        if (!email || !pass) { toast('Falta correo/contraseña', false); return; }
        if (el.authStatus) el.authStatus.textContent = 'Ingresando…';
        await loginEmailPass_(email, pass);
      } catch (e) {
        if (el.authStatus) el.authStatus.textContent = 'Error';
        toast(e?.message || String(e), false);
      }
    });

    on(el.btnGoogle, 'click', async () => {
      try {
        if (el.authStatus) el.authStatus.textContent = 'Ingresando…';
        await loginGoogle_();
      } catch (e) {
        if (el.authStatus) el.authStatus.textContent = 'Error';
        toast(e?.message || String(e), false);
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
    on(el.btnAdjustStock, 'click', () => openStockModal_());
    on(el.btnNewSale, 'click', () => openNewSale_());
    on(el.btnCancelSale, 'click', () => closeSale_());
    on(el.btnAddToSale, 'click', () => addToSale_());
    on(el.btnSaveSale, 'click', async () => { try { await saveSale_(); } catch {} });
    on(el.btnSaveProduct, 'click', async () => { try { await saveProduct_(); } catch {} });
    on(el.btnSaveStock, 'click', async () => { try { await saveStock_(); } catch {} });

    on(el.p_cost, 'input', () => {
      if (!el.p_margin) return;
      if (String(el.p_margin.value || '').trim() !== '') syncPriceFromCostMargin_();
      else syncMarginFromCostPrice_();
    });
    on(el.p_margin, 'input', () => syncPriceFromCostMargin_());
    on(el.p_price, 'input', () => syncMarginFromCostPrice_());

    on(el.btnRestockOpen, 'click', () => openRestockUI_());
    document.addEventListener('click', (ev) => {
      const t = ev.target?.closest?.('[data-restock-open]');
      if (t) openRestockUI_();
    });

    on(el.catalogBody, 'click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!act || !id) return;

      try {
        if (act === 'edit') {
          const p = State.productsIndex().get(String(id)) || null;
          openProductModal_(p);
        } else if (act === 'toggle') {
          const cur = btn.dataset.active === '1';
          await toggleProductActive_(id, cur);
        } else if (act === 'restock_add') {
          restockAddFromProductId_(id);
        }
      } catch (e) {
        toast(e?.message || String(e), false);
      }
    });

    on(el.btnRefreshOrders, 'click', async () => {
      await loadOrders_().catch(() => {});
      renderOrders_();
      toast('Pedidos actualizados ✅', true);
    });

    on(el.ordersBody, 'click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;

      const openId = btn.dataset.orderOpen;
      const payId = btn.dataset.orderPay;
      const delId = btn.dataset.orderDel;

      if (openId !== undefined) { await openOrder_(openId); return; }
      if (payId !== undefined) { await markOrderPaid_(payId); return; }
      if (delId !== undefined) {
        removeLocalOrder_(delId);
        renderOrders_();
        toast('Pedido eliminado 🗑️', true);
        return;
      }
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
        renderSaleItems_();
      }

      if (t.dataset.salePrice !== undefined) {
        const idx = toInt(t.dataset.salePrice);
        const v = Math.max(0, toInt(t.value));
        if (!items[idx]) return;
        const next = items.map((it, i) => (i === idx ? { ...it, unit_price: v } : it));
        State.setSaleItems(next);
        renderSaleItems_();
      }
    });

    on(el.saleItemsBody, 'click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.saleDel !== undefined) {
        const idx = toInt(btn.dataset.saleDel);
        const st = State.get();
        const items = Array.isArray(st.saleItems) ? st.saleItems : [];
        const next = items.filter((_, i) => i !== idx);
        State.setSaleItems(next);
        renderSaleItems_();
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
        renderRestock_();
      }
      if (t.dataset.restockCost !== undefined) {
        const pid = String(t.dataset.restockCost || '').trim();
        State.restockSetCost(pid, Math.max(0, toInt(t.value)));
        renderRestock_();
      }
    });

    on(el.restockBody, 'click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.restockDel !== undefined) {
        const pid = String(btn.dataset.restockDel || '').trim();
        State.restockRemove(pid);
        renderRestock_();
      }
    });

    on(el.btnClearRestock, 'click', () => {
      State.restockClear(true);
      renderRestock_();
      toast('Restock limpiado 🧹', true);
    });

    on(el.btnPrintRestock, 'click', () => restockPrint_());
    on(el.btnCloseRestock, 'click', () => el.modalRestock?.close?.());

    document.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('button');
      if (!b) return;

      if (b.dataset?.act === 'restock_open') openRestockUI_();
      if (b.dataset?.tab === 'restock') showTab('restock');
    });
  }

  /* =========================
     Auth state handling
  ========================= */
  function attachAuthListener_() {
    FB.onAuthStateChanged(FB.auth, async (user) => {
      try {
        State.setUser(user || null);

        if (!user) {
          if (el.userPill) el.userPill.hidden = true;
          setView('auth');
          showTab('catalog');
          setNet(true, navigator.onLine ? 'Listo' : 'Sin conexión');
          return;
        }

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
        showTab('catalog');

        try { State.hydrateFromCache(); } catch {}

        await loadAll_();
        toast('Sesión activa ✅', true);
      } catch (err) {
        console.error(err);
        toast(err?.message || String(err), false);
        setView('auth');
      }
    });
  }

  /* =========================
     Boot
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
    renderRestock_();

    try { if (el.modalRestock?.open) el.modalRestock.close(); } catch {}
  }

  init_();
}

/* Auto-boot si el index no lo llama explícito */
try {
  if (!window.__STORE_APP_BOOTED__) {
    window.__STORE_APP_BOOTED__ = true;
    boot();
  }
} catch {
  // ignore
}
