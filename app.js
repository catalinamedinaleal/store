'use strict';

/* =============================================================================
  Store · app.js (GitHub Pages)
  - Firebase Auth (usa window.__FB__ inicializado en index.html)
  - API vía Apps Script Web App (token va en body, POST simple)
  - Tabs + tablas: catálogo, inventario, pedidos pendientes, ventas (MVP), dashboard
  - CRUD Producto (upsert + setActive)
  - Ajuste inventario (inventory.adjust)
  - Pedido/Venta:
      - sale.create (pending o paid)
      - sales.list (pending)
      - sale.get (abrir pedido desde servidor)
      - sale.updateStatus (pending -> paid, misma fila)
  - Moneda: COP sin decimales

  Requiere:
  - index.html con window.STORE_CFG y window.__FB__
  - api.js exporta: StoreAPI, apiPost
============================================================================= */

import { StoreAPI, apiPost } from './api.js';

export function boot() {
  const CFG = (window.STORE_CFG || {});
  const API_BASE = String(CFG.API_BASE || '').trim();

  /* =========================
     DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const on = (node, ev, fn, opts) => node && node.addEventListener(ev, fn, opts);

  /* =========================
     Elements
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

    // orders (pending)
    btnRefreshOrders: $('btnRefreshOrders'),
    ordersBody: $('ordersBody'),
    ordersMeta: $('ordersMeta'),

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
    p_margin: $('p_margin'), // opcional
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

    // toast
    toast: $('toast'),
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
     State
  ========================= */
  const STATE = {
    user: null,
    products: [],
    inventory: [],
    dashboard: null,

    // derived indexes
    productsById: new Map(), // id -> product

    // sale session
    saleOpen: false,
    saleItems: [],

    // orders
    orders: [],
    ordersSource: 'local', // "api" | "local"
    ordersHydrated: false, // si ya intentamos cargar detalle server

    // ui
    tab: 'catalog',
    busy: false,
    lastSync: null,
  };

  function rebuildIndexes_() {
    const map = new Map();
    (STATE.products || []).forEach(p => {
      const id = String(p?.id || '').trim();
      if (id) map.set(id, p);
    });
    STATE.productsById = map;
  }

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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
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

  function pickPriceCOP_(p) {
    return toInt(p?.price_cop ?? p?.price ?? p?.precio_cop ?? p?.precio);
  }

  function pickCostCOP_(p) {
    return toInt(p?.cost_cop ?? p?.cost ?? p?.costo_cop ?? p?.costo);
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
    toast._t = setTimeout(() => { el.toast.hidden = true; }, 2600);
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
    txt.textContent = 'Guardando…';

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

    d.addEventListener('cancel', (ev) => {
      if (STATE.busy) ev.preventDefault();
    });

    return BUSY_DLG;
  }

  function busyShow(msg = 'Guardando…') {
    const d = ensureBusyDialog_();
    if (d._textEl) d._textEl.textContent = msg;
    if (!d.open) d.showModal();
  }

  function busyHide() {
    if (BUSY_DLG && BUSY_DLG.open) BUSY_DLG.close();
  }

  /* =========================
     View + Net + Busy flag
  ========================= */
  function setView(name) {
    document.body.dataset.view = name;
    if (el.viewLoading) el.viewLoading.hidden = (name !== 'loading');
    if (el.viewAuth) el.viewAuth.hidden = (name !== 'auth');
    if (el.viewApp) el.viewApp.hidden = (name !== 'app');
  }

  function setNet(ok, label) {
    if (!el.netLabel) return;
    el.netLabel.textContent = label || (ok ? 'Conectado' : 'Sin conexión');
    el.netPill?.classList.toggle('is-bad', !ok);
  }

  function setBusy_(on = true, msg = 'Guardando…') {
    STATE.busy = !!on;

    const dis = !!on;
    if (el.btnRefresh) el.btnRefresh.disabled = dis;
    if (el.btnNewProduct) el.btnNewProduct.disabled = dis;
    if (el.btnAdjustStock) el.btnAdjustStock.disabled = dis;
    if (el.btnNewSale) el.btnNewSale.disabled = dis;
    if (el.btnSaveSale) el.btnSaveSale.disabled = dis;
    if (el.btnSaveProduct) el.btnSaveProduct.disabled = dis;
    if (el.btnSaveStock) el.btnSaveStock.disabled = dis;
    if (el.btnRefreshOrders) el.btnRefreshOrders.disabled = dis;
    if (el.btnLogout) el.btnLogout.disabled = dis;

    if (on) busyShow(msg);
    else busyHide();
  }

  function fatal_(msg) {
    console.error(msg);
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
     Tabs
  ========================= */
  const TAB_IDS = ['catalog', 'inventory', 'sales', 'moves', 'dashboard'];

  function showTab(tabName) {
    STATE.tab = tabName;
    TAB_IDS.forEach(n => {
      const btn = el.tabs.find(b => b.dataset.tab === n);
      btn?.classList.toggle('is-active', n === tabName);
      const sec = $('tab-' + n);
      if (sec) sec.hidden = (n !== tabName);
    });

    // En el tab de ventas, mantenemos UI coherente
    if (tabName === 'sales') syncSalesUI_();
  }

  /* =========================
     Sales UI sync (FIX PRINCIPAL)
     - "salesEmpty" no debe salir si hay pedidos pendientes (seguimiento)
     - "salePane" solo sale si hay carrito abierto (venta en edición)
  ========================= */
  function syncSalesUI_() {
    if (!el.salesEmpty || !el.salePane) return;

    const isOpen = !!STATE.saleOpen;
    const hasOrders = Array.isArray(STATE.orders) && STATE.orders.length > 0;

    // Pane: solo cuando hay venta abierta (carrito)
    el.salePane.hidden = !isOpen;

    // Empty: solo si NO hay venta abierta y NO hay pedidos
    el.salesEmpty.hidden = isOpen || hasOrders;
  }

  /* =========================
     Data load
  ========================= */
  async function loadAll_() {
    setBusy_(true, 'Cargando…');
    setNet(true, 'Cargando…');

    try {
      const [p, inv, dash] = await Promise.all([
        StoreAPI.listProducts(''),
        StoreAPI.listInventory(),
        StoreAPI.dashboard(),
      ]);

      // pedidos pendientes (server first; fallback local)
      await loadOrders_().catch(() => { /* no bloquea */ });

      STATE.products = Array.isArray(p?.items) ? p.items : [];
      rebuildIndexes_();
      buildSaleDatalist_();

      STATE.inventory = Array.isArray(inv?.items) ? inv.items : [];
      STATE.dashboard = dash || null;
      STATE.lastSync = new Date().toISOString();

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
    syncSalesUI_();
  }

  function renderKPIs_() {
    const dash = STATE.dashboard || {};
    const productsCount = (STATE.products || []).length;
    const low = (dash.low_stock || []).length;

    if (el.kpiToday) el.kpiToday.textContent = fmtCOP(toInt(dash.today_total_cop));
    if (el.kpiProducts) el.kpiProducts.textContent = String(productsCount);
    if (el.kpiLowStock) el.kpiLowStock.textContent = String(low);

    if (el.dashToday) el.dashToday.textContent = fmtCOP(toInt(dash.today_total_cop));
  }

  function renderDashboard_() {
    const dash = STATE.dashboard || {};
    const rows = (dash.low_stock || []);
    if (!el.lowStockBody) return;

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

    const q = String(el.qCatalog?.value || '').toLowerCase().trim();
    const list = (STATE.products || []).filter(p => {
      if (!q) return true;
      return (
        String(p.id || '').toLowerCase().includes(q) ||
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.brand || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q) ||
        String(p.stock ?? '').toLowerCase().includes(q) ||
        String(p.min_stock ?? '').toLowerCase().includes(q)
      );
    });

    if (!list.length) {
      el.catalogBody.innerHTML = `<tr><td colspan="8" class="muted">No hay resultados.</td></tr>`;
      return;
    }

    el.catalogBody.innerHTML = list.map(p => {
      const active = !!p.active;
      const badge = active ? `<span class="badge">Activo</span>` : `<span class="badge badge--off">Oculto</span>`;

      const stock = toInt(p.stock);
      const minStock = toInt(p.min_stock);
      const stockBadge = (minStock > 0 && stock <= minStock)
        ? `<span class="badge badge--warn">Bajo</span>`
        : ``;

      const price = pickPriceCOP_(p);

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
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderInventory_() {
    if (!el.inventoryBody) return;

    const q = String(el.qInventory?.value || '').toLowerCase().trim();
    const list = (STATE.inventory || []).filter(r => {
      if (!q) return true;
      const pid = String(r.product_id || '').toLowerCase();
      const p = STATE.productsById.get(String(r.product_id || '').trim());
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
      const p = STATE.productsById.get(pid);
      const label = p
        ? `${safeStr_(p.name || pid, 80)} <span class="muted tiny mono">(${escapeHtml(pid)})</span>`
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
     Pedidos pendientes (server first)
  ========================= */
  const ORDERS_KEY = 'store_pending_orders_v2';

  function readLocalOrders_() {
    try {
      const raw = localStorage.getItem(ORDERS_KEY);
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function writeLocalOrders_(arr) {
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
    } catch { /* ignore */ }
  }

  async function loadOrders_() {
    try {
      const r = await apiPost({ action: 'sales.list', status: 'pending', include_items: false, limit: 300 });
      const items = Array.isArray(r.items) ? r.items : [];

      STATE.orders = items.map(x => ({
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

      STATE.ordersSource = 'api';
      STATE.ordersHydrated = false;
      return;
    } catch (e) {
      STATE.orders = readLocalOrders_();
      STATE.ordersSource = 'local';
      STATE.ordersHydrated = true;
    }
  }

  function renderOrders_() {
    if (!el.ordersBody) return;

    const rows = Array.isArray(STATE.orders) ? STATE.orders : [];
    if (!rows.length) {
      el.ordersBody.innerHTML = `<tr><td colspan="5" class="muted">No hay pedidos pendientes.</td></tr>`;
      if (el.ordersMeta) {
        el.ordersMeta.textContent = STATE.ordersSource === 'api'
          ? 'Fuente: servidor'
          : 'Fuente: local (este dispositivo)';
      }
      syncSalesUI_(); // ← clave: si no hay pedidos, puede que sí toque mostrar vacío
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
        const payBtn = `<button class="btn btn--tiny btn--primary" data-order-pay="${escapeHtml(String(o.id || ''))}">Marcar pagado</button>`;
        const delBtn = (STATE.ordersSource === 'local')
          ? `<button class="btn btn--tiny btn--ghost" data-order-del="${escapeHtml(String(o.id || ''))}">Eliminar</button>`
          : ``;

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
      el.ordersMeta.textContent = STATE.ordersSource === 'api'
        ? `Fuente: servidor · ${rows.length} pedido(s)`
        : `Fuente: local (este dispositivo) · ${rows.length} pedido(s)`;
    }

    syncSalesUI_(); // ← clave: si hay pedidos, ocultamos vacío aunque no haya carrito
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
    STATE.orders = arr;
    STATE.ordersSource = 'local';
    syncSalesUI_();
  }

  async function hydrateOrderFromServer_(id) {
    const key = String(id || '').trim();
    if (!key) throw new Error('ID inválido');

    const res = await apiPost({ action: 'sale.get', id: key });
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

    STATE.saleOpen = true;

    if (el.saleCustomer) el.saleCustomer.value = String(order.customer_id || '').trim();
    if (el.salePay) el.salePay.value = String(order.payment_method || 'cash').trim() || 'cash';
    if (el.saleNotes) el.saleNotes.value = String(order.notes || '').trim();
    if (el.saleStatus) el.saleStatus.value = String(forceStatus || order.status || 'pending').trim();

    STATE.saleItems = order.items.map(it => {
      const pid = String(it.product_id || '').trim();
      const p = STATE.productsById.get(pid);
      return {
        product_id: pid,
        name: String(p?.name || pid),
        qty: Math.max(1, toInt(it.qty)),
        unit_price: Math.max(0, toInt(it.unit_price ?? pickPriceCOP_(p) ?? 0)),
      };
    }).filter(x => x.product_id);

    renderSaleItems_();
    syncSalesUI_();
    toast('Pedido cargado en la venta ✅', true);
  }

  async function openOrder_(id) {
    const key = String(id || '').trim();
    if (!key) return;

    setBusy_(true, 'Cargando pedido…');
    try {
      if (STATE.ordersSource === 'api') {
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

    if (STATE.ordersSource === 'api') {
      setBusy_(true, 'Marcando pagado…');
      try {
        await apiPost({ action: 'sale.updateStatus', id: key, status: 'paid' });
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
      const res = await apiPost({ action: 'sale.create', sale, items });
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
     Pricing helpers (opcional)
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
      el.p_id.disabled = !isNew && !!(p?.id);
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

    if (el.p_margin) {
      el.p_margin.value = cost ? String(computeMarginFromCostPrice_(cost, price)) : '';
    }

    if (el.p_desc) el.p_desc.value = p?.desc || '';
    if (el.p_image) el.p_image.value = p?.image_url || '';

    el.modalProduct?.showModal();
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

      // canon
      price_cop: price,
      cost_cop: cost,

      // aliases por si acaso
      price: price,
      cost: cost,
      precio_cop: price,
      costo_cop: cost,
      precio: price,
      costo: cost,

      margin_pct: margin,
      desc: safeStr_(el.p_desc?.value, 4000),
      image_url: safeStr_(el.p_image?.value, 1200),
    };
  }

  async function saveProduct_() {
    const prod = readProductForm_();
    if (!prod.name) { toast('Falta nombre del producto', false); return; }
    if (!prod.id) { toast('Falta ID del producto', false); return; }

    setBusy_(true, 'Guardando producto…');
    try {
      const res = await StoreAPI.upsertProduct(prod);
      toast(res?.mode === 'created' ? 'Producto creado ✅' : 'Producto actualizado ✅', true);
      el.modalProduct?.close();
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
    el.modalStock?.showModal();
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
      el.modalStock?.close();
      await loadAll_();
    } catch (e) {
      toast(e?.message || String(e), false);
      throw e;
    } finally {
      setBusy_(false);
    }
  }

  /* =========================
     Sales (MVP)
  ========================= */
  function openNewSale_() {
    STATE.saleOpen = true;
    STATE.saleItems = [];

    if (el.saleSearch) el.saleSearch.value = '';
    if (el.saleCustomer) el.saleCustomer.value = '';
    if (el.saleNotes) el.saleNotes.value = '';
    if (el.salePay) el.salePay.value = 'cash';
    if (el.saleStatus) el.saleStatus.value = 'paid';

    renderSaleItems_();
    syncSalesUI_();
  }

  function closeSale_() {
    STATE.saleOpen = false;
    STATE.saleItems = [];
    renderSaleItems_();
    syncSalesUI_();
  }

  function parseProductIdFromInput_(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const exact = (STATE.products || []).find(p => String(p.id || '').trim().toLowerCase() === s.toLowerCase());
    if (exact) return String(exact.id || '').trim();
    const m = s.match(/\(([^)]+)\)\s*$/);
    if (m && m[1]) return String(m[1]).trim();
    return '';
  }

  function buildSaleDatalist_() {
    const dl = el.saleProductsList;
    if (!dl) return;

    const list = (STATE.products || []).filter(p => p && (p.active !== false));
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
    if (pid) return STATE.productsById.get(pid) || null;

    const list = STATE.products || [];
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

    const pid = String(p.id || '').trim();
    const hit = STATE.saleItems.find(x => x.product_id === pid);

    const unit = pickPriceCOP_(p);

    if (hit) hit.qty += 1;
    else {
      STATE.saleItems.push({
        product_id: pid,
        name: p.name || pid,
        qty: 1,
        unit_price: unit,
      });
    }

    if (el.saleSearch) el.saleSearch.value = '';
    renderSaleItems_();
  }

  function renderSaleItems_() {
    if (!el.saleItemsBody || !el.saleTotal) return;

    if (!STATE.saleItems.length) {
      el.saleItemsBody.innerHTML = `<tr><td colspan="5" class="muted">Sin items…</td></tr>`;
      el.saleTotal.textContent = fmtCOP(0);
      return;
    }

    let total = 0;
    el.saleItemsBody.innerHTML = STATE.saleItems.map((it, idx) => {
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
    if (!STATE.saleItems.length) {
      toast('No hay items para guardar', false);
      return;
    }

    const items = STATE.saleItems.map(it => ({
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
      const res = await apiPost({ action: 'sale.create', sale, items });

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
          items: STATE.saleItems.map(it => ({
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
     Wiring
  ========================= */
  function wireUI_() {
    el.tabs.forEach(btn => {
      on(btn, 'click', () => showTab(btn.dataset.tab));
    });

    on(el.btnRefresh, 'click', async () => {
      try {
        await loadAll_();
        toast('Actualizado ✅', true);
      } catch (e) {
        fatal_(e?.message || String(e));
      }
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

    on(el.catalogBody, 'click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!act || !id) return;

      try {
        if (act === 'edit') {
          const p = STATE.productsById.get(String(id)) || null;
          openProductModal_(p);
        } else if (act === 'toggle') {
          const cur = btn.dataset.active === '1';
          await toggleProductActive_(id, cur);
        }
      } catch (e) {
        toast(e?.message || String(e), false);
      }
    });

    on(el.btnNewProduct, 'click', () => openProductModal_(null));

    on(el.p_cost, 'input', () => {
      if (!el.p_margin) return;
      if (String(el.p_margin.value || '').trim() !== '') syncPriceFromCostMargin_();
      else syncMarginFromCostPrice_();
    });
    on(el.p_margin, 'input', () => syncPriceFromCostMargin_());
    on(el.p_price, 'input', () => syncMarginFromCostPrice_());

    on(el.btnSaveProduct, 'click', async () => {
      try { await saveProduct_(); } catch { /* toast ya cubre */ }
    });

    on(el.qInventory, 'input', debounce(() => renderInventory_(), 120));
    on(el.btnAdjustStock, 'click', () => openStockModal_());
    on(el.btnSaveStock, 'click', async () => {
      try { await saveStock_(); } catch { /* toast ya cubre */ }
    });

    on(el.btnNewSale, 'click', () => openNewSale_());
    on(el.btnCancelSale, 'click', () => closeSale_());
    on(el.btnAddToSale, 'click', () => addToSale_());
    on(el.btnSaveSale, 'click', async () => {
      try { await saveSale_(); } catch { /* toast ya cubre */ }
    });

    on(el.btnRefreshOrders, 'click', async () => {
      await loadOrders_().catch(() => { /* ignore */ });
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

      if (t.dataset.saleQty !== undefined) {
        const idx = toInt(t.dataset.saleQty);
        const v = Math.max(1, toInt(t.value));
        if (STATE.saleItems[idx]) STATE.saleItems[idx].qty = v;
        renderSaleItems_();
      }
      if (t.dataset.salePrice !== undefined) {
        const idx = toInt(t.dataset.salePrice);
        const v = Math.max(0, toInt(t.value));
        if (STATE.saleItems[idx]) STATE.saleItems[idx].unit_price = v;
        renderSaleItems_();
      }
    });

    on(el.saleItemsBody, 'click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.saleDel !== undefined) {
        const idx = toInt(btn.dataset.saleDel);
        STATE.saleItems.splice(idx, 1);
        renderSaleItems_();
      }
    });

    on(el.modalProduct, 'close', () => { /* noop */ });
    on(el.modalStock, 'close', () => { /* noop */ });
  }

  /* =========================
     Auth state handling
  ========================= */
  function attachAuthListener_() {
    FB.onAuthStateChanged(FB.auth, async (user) => {
      try {
        STATE.user = user || null;

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

        try {
          await StoreAPI.ping();
          setNet(true, 'Conectado');
        } catch (e) {
          setNet(false, 'API error');
          throw e;
        }

        setView('app');
        showTab('catalog');

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
  }

  init_();
}
