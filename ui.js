'use strict';

/* =============================================================================
  ui.js — Store UI Kernel (render + UX helpers) v3.8 PRO++
  ---------------------------------------------------------------------------
  ✅ DOM cache + validación suave (warn si faltan IDs)
  ✅ Tabs robustas: aria-controls, fallback si falta section, foco mejor
  ✅ Toast queue: sticky + replace + tiempos custom
  ✅ Format COP + parsers robustos + normalizador de inputs de dinero
  ✅ Render eficiente (DocumentFragment) para tablas (dashboard/inventory/restock)
  ✅ Modals: open/close con fallback si showModal falla
  ✅ Inventario usable: Nombre (ID) con productsIndex(Map)
  ✅ Restock Cart (🧺 Pedido a proveedor)
     - badge configurable (items o unidades)
     - tabla 5 cols: Producto | Cant | Costo | Subtotal | ✕
     - print bonito (ventana nueva)
============================================================================= */

export function createUI(opts = {}) {
  /* =========================
     DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const on = (node, ev, fn, opts2) => node && node.addEventListener(ev, fn, opts2);

  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const setText = (node, text) => { if (node) node.textContent = String(text ?? ''); };
  const setHTML = (node, html) => { if (node) node.innerHTML = String(html ?? ''); };

  /* =========================
     Elements
  ========================= */
  const el = {
    // views
    viewLoading: $('viewLoading'),
    viewAuth: $('viewAuth'),
    viewApp: $('viewApp'),

    // topbar
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
    buildHint: $('buildHint'),

    // app nav
    btnRefresh: $('btnRefresh'),

    // KPIs + dashboard
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
    btnAddToSale: $('btnAddToSale'),
    saleItemsBody: $('saleItemsBody'),
    saleTotal: $('saleTotal'),
    saleCustomer: $('saleCustomer'),
    salePay: $('salePay'),
    saleStatus: $('saleStatus'),
    saleNotes: $('saleNotes'),
    btnSaveSale: $('btnSaveSale'),
    btnCancelSale: $('btnCancelSale'),
    saleProductsList: $('saleProductsList'),

    // orders pane (pendientes)
    ordersPane: $('ordersPane'),
    ordersBody: $('ordersBody'),
    ordersMeta: $('ordersMeta'),
    btnRefreshOrders: $('btnRefreshOrders'),

    // moves
    qMoves: $('qMoves'),
    movesBody: $('movesBody'),

    // modals: product
    modalProduct: $('modalProduct'),
    productTitle: $('productTitle'),
    btnSaveProduct: $('btnSaveProduct'),
    p_id: $('p_id'),
    p_active: $('p_active'),
    p_name: $('p_name'),
    p_brand: $('p_brand'),
    p_category: $('p_category'),
    p_sku: $('p_sku'),
    p_price: $('p_price'),
    p_cost: $('p_cost'),
    p_margin: $('p_margin'),
    p_desc: $('p_desc'),
    p_image: $('p_image'),

    // modals: stock
    modalStock: $('modalStock'),
    btnSaveStock: $('btnSaveStock'),
    s_product_id: $('s_product_id'),
    s_type: $('s_type'),
    s_qty: $('s_qty'),
    s_ref: $('s_ref'),
    s_note: $('s_note'),

    // toast
    toast: $('toast'),

    // tab sections (opcionales)
    tabCatalog: $('tab-catalog'),
    tabInventory: $('tab-inventory'),
    tabSales: $('tab-sales'),
    tabMoves: $('tab-moves'),
    tabDashboard: $('tab-dashboard'),
    tabRestock: $('tab-restock'), // opcional si existe

    // ✅ Restock
    btnRestockOpen: $('btnRestockOpen'),
    restockCount: $('restockCount'),
    modalRestock: $('modalRestock'),
    restockForm: $('restockForm'),
    restockSupplier: $('restockSupplier'),
    restockNotes: $('restockNotes'),
    restockBody: $('restockBody'),
    restockTotalUnits: $('restockTotalUnits'),
    restockTotalCost: $('restockTotalCost'),
    btnPrintRestock: $('btnPrintRestock'),
    btnClearRestock: $('btnClearRestock'),
  };

  /* =========================
     Tabs config (robusto)
  ========================= */
  const TAB_IDS = Array.isArray(opts.tabIds) && opts.tabIds.length
    ? opts.tabIds.slice()
    : ['catalog', 'inventory', 'sales', 'moves', 'dashboard', 'restock']; // incluye restock por si existe

  function tabSectionId_(name) { return `tab-${name}`; }
  function tabSectionEl_(name) { return $(tabSectionId_(name)); }

  /* =========================
     Soft validation (no drama)
  ========================= */
  const _required = ['netLabel', 'netPill'];
  const missing = _required.filter(k => !el[k]);
  if (missing.length) console.warn('[UI] Faltan elementos DOM:', missing.join(', '));

  /* =========================
     Utils
  ========================= */
  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const safeStr = (v, max = 4000) => {
    const s = String(v ?? '').trim();
    return s.length > max ? s.slice(0, max) : s;
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
    const s = String(v).replace(/,/g, '.').replace(/[^\d.\-]/g, '').trim();
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const fmtCOP = (n) => {
    const v = Number.isFinite(n) ? n : toInt(n);
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return '$' + String(Math.round(v));
    }
  };

  const truthy_ = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['1','true','yes','y','on','si','sí'].includes(s)) return true;
      if (['0','false','no','n','off'].includes(s)) return false;
    }
    return !!v;
  };

  function pickPriceCOP_(p) {
    return toInt(p?.price_cop ?? p?.price ?? p?.precio_cop ?? p?.precio);
  }
  function pickCostCOP_(p) {
    return toInt(p?.cost_cop ?? p?.cost ?? p?.costo_cop ?? p?.costo);
  }
  function pickMargin_(p) {
    return toFloat(p?.margin ?? p?.margin_pct ?? p?.ganancia ?? p?.ganancia_pct ?? p?.markup ?? p?.markup_pct);
  }

  function debounce(fn, ms = 160) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Normaliza un input de dinero (COP) a entero (sin decimales)
  function moneyInputNormalize(inputEl) {
    if (!inputEl) return 0;
    const n = toInt(inputEl.value);
    inputEl.value = String(n);
    return n;
  }

  // Para datalist: "Nombre — Marca (ID)" o "(ID)" o "ID"
  function parseDatalistProductId(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/\(([^)]+)\)\s*$/);
    if (m && m[1]) return String(m[1]).trim();
    // fallback: si pusieron "ID · Nombre"
    const cut = s.split('·')[0].trim();
    if (/^[a-z0-9\-_]+$/i.test(cut)) return cut;
    return '';
  }

  /* =========================
     Toast (cola + sticky + replace)
  ========================= */
  const TOAST = { q: [], showing: false };

  function toast(msg, ok = true, opts2 = {}) {
    if (!el.toast) return;

    const item = {
      msg: String(msg || ''),
      ok: !!ok,
      sticky: !!opts2.sticky,
      ms: Number.isFinite(opts2.ms) ? opts2.ms : 2400,
      replace: !!opts2.replace,
    };

    if (item.replace) TOAST.q.length = 0;
    TOAST.q.push(item);

    if (!TOAST.showing) drainToast_();
  }

  function drainToast_() {
    if (!el.toast) return;

    const next = TOAST.q.shift();
    if (!next) {
      TOAST.showing = false;
      return;
    }

    TOAST.showing = true;
    el.toast.hidden = false;
    el.toast.textContent = next.msg;
    el.toast.classList.toggle('is-bad', !next.ok);

    clearTimeout(drainToast_._t);
    const ms = next.sticky ? 8000 : next.ms;

    drainToast_._t = setTimeout(() => {
      el.toast.hidden = true;
      drainToast_();
    }, ms);
  }

  /* =========================
     Views & Net
  ========================= */
  function setView(name) {
    document.body.dataset.view = name;
    if (el.viewLoading) el.viewLoading.hidden = (name !== 'loading');
    if (el.viewAuth) el.viewAuth.hidden = (name !== 'auth');
    if (el.viewApp) el.viewApp.hidden = (name !== 'app');

    // Restock button solo visible en app (si existe)
    if (el.btnRestockOpen) el.btnRestockOpen.hidden = (name !== 'app');
  }

  function setNet(ok, label) {
    if (!el.netLabel) return;
    el.netLabel.textContent = label || (ok ? 'Conectado' : 'Sin conexión');
    el.netPill?.classList.toggle('is-bad', !ok);
  }

  function setApiHint(apiBase) {
    if (!el.apiHint) return;
    const x = String(apiBase || '').trim();
    el.apiHint.textContent = x ? x : '(API_BASE pendiente)';
  }

  function setBuildHint(build) {
    if (!el.buildHint) return;
    const x = String(build || '').trim();
    el.buildHint.textContent = x ? x : '';
  }

  function setAuthStatus(s) {
    if (!el.authStatus) return;
    el.authStatus.textContent = safeStr(s, 120);
  }

  function setUser(email) {
    if (!el.userPill) return;
    const e = String(email || '').trim();
    el.userPill.hidden = !e;
    if (el.userEmail) el.userEmail.textContent = e || '—';
  }

  /* =========================
     Tabs (robusto + accesible)
  ========================= */
  function initTabsAccessibility_() {
    if (!Array.isArray(el.tabs) || !el.tabs.length) return;

    el.tabs.forEach((btn) => {
      const name = btn?.dataset?.tab;
      if (!name) return;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', tabSectionId_(name));
      btn.setAttribute('tabindex', '-1');
    });

    const tablist = el.tabs[0]?.parentElement;
    if (tablist) tablist.setAttribute('role', 'tablist');
  }

  function showTab(tabName) {
    const name = TAB_IDS.includes(tabName) ? tabName : TAB_IDS[0];

    // buttons
    if (Array.isArray(el.tabs) && el.tabs.length) {
      el.tabs.forEach((btn) => {
        const t = btn?.dataset?.tab;
        if (!t) return;
        const isOn = (t === name);
        btn.classList.toggle('is-active', isOn);
        btn.setAttribute('aria-selected', isOn ? 'true' : 'false');
        btn.setAttribute('tabindex', isOn ? '0' : '-1');
      });
    }

    // sections
    TAB_IDS.forEach((n) => {
      const sec = tabSectionEl_(n);
      if (sec) sec.hidden = (n !== name);
    });

    // focus first control
    const sec = tabSectionEl_(name);
    if (sec) {
      const first = sec.querySelector('input, select, textarea, button');
      if (first && typeof first.focus === 'function') {
        setTimeout(() => { try { first.focus({ preventScroll: true }); } catch {} }, 0);
      }
    }
  }

  initTabsAccessibility_();

  /* =========================
     Render: KPIs + Dashboard
  ========================= */
  function renderKPIs({ dashboard, products }) {
    const dash = dashboard || {};
    const productsCount = (products || []).length;
    const low = (dash.low_stock || []).length;

    if (el.kpiToday) el.kpiToday.textContent = fmtCOP(toInt(dash.today_total_cop));
    if (el.kpiProducts) el.kpiProducts.textContent = String(productsCount);
    if (el.kpiLowStock) el.kpiLowStock.textContent = String(low);
    if (el.dashToday) el.dashToday.textContent = fmtCOP(toInt(dash.today_total_cop));
  }

  function renderDashboard({ dashboard }) {
    const dash = dashboard || {};
    const rows = (dash.low_stock || []);
    if (!el.lowStockBody) return;

    if (!rows.length) {
      el.lowStockBody.innerHTML = `<tr><td colspan="3" class="muted">Sin alertas 🎉</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((r) => {
      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.innerHTML = escapeHtml(r.name || r.id);

      const td2 = document.createElement('td');
      td2.className = 'num mono';
      td2.textContent = String(toInt(r.stock));

      const td3 = document.createElement('td');
      td3.className = 'num mono';
      td3.textContent = String(toInt(r.min_stock));

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      frag.appendChild(tr);
    });

    el.lowStockBody.innerHTML = '';
    el.lowStockBody.appendChild(frag);
  }

  /* =========================
     Render: Catalog
  ========================= */
  function renderCatalog(products, q = '', opts2 = {}) {
    if (!el.catalogBody) return;

    const enableRestock = (opts2.enableRestock !== undefined) ? !!opts2.enableRestock : true;

    const needle = String(q || '').toLowerCase().trim();
    const list = (products || []).filter(p => {
      if (!needle) return true;
      return (
        String(p.id || '').toLowerCase().includes(needle) ||
        String(p.name || '').toLowerCase().includes(needle) ||
        String(p.brand || '').toLowerCase().includes(needle) ||
        String(p.category || '').toLowerCase().includes(needle) ||
        String(p.sku || '').toLowerCase().includes(needle)
      );
    });

    if (!list.length) {
      el.catalogBody.innerHTML = `<tr><td colspan="8" class="muted">No hay resultados.</td></tr>`;
      return;
    }

    el.catalogBody.innerHTML = list.map(p => {
      const active = truthy_(p.active ?? true);
      const badge = active
        ? `<span class="badge">Activo</span>`
        : `<span class="badge badge--off">Oculto</span>`;

      const stock = toInt(p.stock);
      const minS = toInt(p.min_stock);
      const stockBadge = (minS > 0 && stock <= minS)
        ? `<span class="badge badge--warn">Bajo</span>`
        : ``;

      const price = pickPriceCOP_(p);
      const cost = pickCostCOP_(p);

      const btnRestock = enableRestock
        ? `<button class="btn btn--tiny btn--ghost" data-act="restock_add" data-id="${escapeHtml(p.id)}" data-cost="${cost}">
             🧺 Restock
           </button>`
        : '';

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
            ${btnRestock}
          </td>
        </tr>
      `;
    }).join('');
  }

  /* =========================
     Render: Inventory
  ========================= */
  function renderInventory(inventory, q = '', productsIndex = null) {
    if (!el.inventoryBody) return;

    const idx = (productsIndex instanceof Map) ? productsIndex : null;
    const needle = String(q || '').toLowerCase().trim();

    const list = (inventory || []).filter(r => {
      if (!needle) return true;

      const pid = String(r.product_id || '').toLowerCase();
      const loc = String(r.location || '').toLowerCase();

      let meta = '';
      if (idx) {
        const p = idx.get(String(r.product_id || '').trim());
        meta = [
          String(p?.name || ''),
          String(p?.brand || ''),
          String(p?.category || ''),
          String(p?.sku || ''),
        ].join(' ').toLowerCase();
      }

      return pid.includes(needle) || loc.includes(needle) || meta.includes(needle);
    });

    if (!list.length) {
      el.inventoryBody.innerHTML = `<tr><td colspan="5" class="muted">No hay resultados.</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();

    list.forEach((r) => {
      const pidRaw = String(r.product_id || '').trim();
      const p = idx ? idx.get(pidRaw) : null;

      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      if (p) {
        td1.innerHTML =
          `${escapeHtml(safeStr(p.name || pidRaw, 90))} ` +
          `<span class="muted tiny mono">(${escapeHtml(pidRaw)})</span>`;
      } else {
        td1.innerHTML = `<span class="mono">${escapeHtml(pidRaw)}</span>`;
      }

      const td2 = document.createElement('td');
      td2.className = 'num mono';
      td2.textContent = String(toInt(r.stock));

      const td3 = document.createElement('td');
      td3.className = 'num mono';
      td3.textContent = String(toInt(r.min_stock));

      const td4 = document.createElement('td');
      td4.innerHTML = escapeHtml(r.location || '');

      const td5 = document.createElement('td');
      td5.className = 'tiny muted';
      td5.innerHTML = escapeHtml(String(r.updated_at || ''));

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tr.appendChild(td5);

      frag.appendChild(tr);
    });

    el.inventoryBody.innerHTML = '';
    el.inventoryBody.appendChild(frag);
  }

  /* =========================
     Render: Sale items + datalist
  ========================= */
  function renderSaleItems(saleItems) {
    if (!el.saleItemsBody) return;

    const items = Array.isArray(saleItems) ? saleItems : [];
    if (!items.length) {
      el.saleItemsBody.innerHTML = `<tr><td colspan="5" class="muted">Sin items…</td></tr>`;
      if (el.saleTotal) el.saleTotal.textContent = fmtCOP(0);
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

    if (el.saleTotal) el.saleTotal.textContent = fmtCOP(total);
  }

  function renderSaleProductsDatalist(products) {
    if (!el.saleProductsList) return;
    const list = Array.isArray(products) ? products : [];

    // Mejor UX: "Nombre — Marca (ID)"
    el.saleProductsList.innerHTML = list
      .filter(p => truthy_(p?.active ?? true))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      .map(p => {
        const id = String(p.id || '').trim();
        const name = String(p.name || '').trim() || id;
        const brand = String(p.brand || '').trim();
        const label = `${name}${brand ? ' — ' + brand : ''} (${id})`;
        return `<option value="${escapeHtml(label)}"></option>`;
      })
      .join('');
  }

  /* =========================
     Sale pane open/close
  ========================= */
  function showSalePane(open) {
    if (!el.salesEmpty || !el.salePane) return;
    el.salesEmpty.hidden = !!open;
    el.salePane.hidden = !open;
  }

  /* =========================
     Render: Orders (pendientes)
  ========================= */
  function renderOrdersPending(orders = [], metaText = '') {
    if (!el.ordersBody) return;

    const list = Array.isArray(orders) ? orders : [];
    if (!list.length) {
      el.ordersBody.innerHTML = `<tr><td colspan="5" class="muted">No hay pedidos pendientes.</td></tr>`;
      if (el.ordersMeta) el.ordersMeta.textContent = metaText || '';
      return;
    }

    el.ordersBody.innerHTML = list.map((o, i) => {
      const date = escapeHtml(String(o.date || o.created_at || o.fecha || '—'));
      const customer = escapeHtml(String(o.customer || o.cliente || o.customer_id || '—'));
      const total = fmtCOP(toInt(o.total_cop ?? o.total ?? o.totalCOP));
      const notes = escapeHtml(String(o.notes || o.notas || ''));
      const id = escapeHtml(String(o.id || o.sale_id || o.row_id || i));

      return `
        <tr>
          <td class="tiny">${date}</td>
          <td>${customer}</td>
          <td class="num mono">${total}</td>
          <td class="tiny">${notes}</td>
          <td class="num" style="white-space:nowrap;">
            <button class="btn btn--tiny btn--ghost" data-order-open="${id}">Abrir</button>
            <button class="btn btn--tiny btn--ghost" data-order-paid="${id}">Marcar pagado</button>
          </td>
        </tr>
      `;
    }).join('');

    if (el.ordersMeta) el.ordersMeta.textContent = metaText || '';
  }

  /* =========================
     Render: Moves
  ========================= */
  function renderMoves(moves = [], q = '') {
    if (!el.movesBody) return;

    const needle = String(q || '').toLowerCase().trim();
    const list = (Array.isArray(moves) ? moves : []).filter(m => {
      if (!needle) return true;
      const s = [
        m.id, m.move_id, m.product_id, m.product_name, m.type, m.ref, m.reference, m.date, m.created_at
      ].map(x => String(x || '').toLowerCase()).join(' ');
      return s.includes(needle);
    });

    if (!list.length) {
      el.movesBody.innerHTML = `<tr><td colspan="6" class="muted">Sin movimientos.</td></tr>`;
      return;
    }

    el.movesBody.innerHTML = list.map(m => {
      const id = escapeHtml(String(m.move_id || m.id || '—'));
      const prod = escapeHtml(String(m.product_name || m.product || m.product_id || '—'));
      const type = escapeHtml(String(m.type || m.kind || '—'));
      const qty = String(toInt(m.qty ?? m.quantity ?? m.cantidad));
      const ref = escapeHtml(String(m.ref || m.reference || m.sale_id || '—'));
      const date = escapeHtml(String(m.date || m.created_at || '—'));

      return `
        <tr>
          <td class="mono">${id}</td>
          <td>${prod}</td>
          <td>${type}</td>
          <td class="num mono">${qty}</td>
          <td class="tiny">${ref}</td>
          <td class="tiny">${date}</td>
        </tr>
      `;
    }).join('');
  }

  /* =========================
     Modals (guard rails)
  ========================= */
  function _safeShowModal(dlg) {
    try {
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    } catch (e) {
      console.warn('[UI] showModal falló:', e?.message || e);
      try { dlg?.setAttribute('open', ''); } catch {}
    }
  }

  function _safeCloseModal(dlg) {
    try {
      if (dlg && typeof dlg.close === 'function') dlg.close();
      else dlg?.removeAttribute?.('open');
    } catch {}
  }

  /* =========================
     Product modal
  ========================= */
  function openProductModal(p) {
    const isNew = !p;
    if (el.productTitle) el.productTitle.textContent = isNew ? 'Nuevo producto' : 'Editar producto';

    // UX: ID readonly si edit
    if (el.p_id) {
      el.p_id.value = p?.id || '';
      el.p_id.disabled = !isNew && !!(p?.id);
      el.p_id.placeholder = isNew ? '(auto)' : '';
    }

    if (el.p_active) el.p_active.value = String(truthy_(p?.active ?? true) ? 'true' : 'false');
    if (el.p_name) el.p_name.value = p?.name || '';
    if (el.p_brand) el.p_brand.value = p?.brand || '';
    if (el.p_category) el.p_category.value = p?.category || '';
    if (el.p_sku) el.p_sku.value = p?.sku || '';
    if (el.p_price) el.p_price.value = String(pickPriceCOP_(p));
    if (el.p_cost) el.p_cost.value = String(pickCostCOP_(p));
    if (el.p_margin) el.p_margin.value = String(pickMargin_(p) || '');
    if (el.p_desc) el.p_desc.value = p?.desc || '';
    if (el.p_image) el.p_image.value = p?.image_url || '';

    _safeShowModal(el.modalProduct);
    setTimeout(() => { try { el.p_name?.focus?.(); } catch {} }, 0);
  }

  function closeProductModal() { _safeCloseModal(el.modalProduct); }

  function readProductForm() {
    const id = safeStr(el.p_id?.value, 80).trim();
    const name = safeStr(el.p_name?.value, 220).trim();

    const cost = toInt(el.p_cost?.value);
    const margin = toFloat(el.p_margin?.value);

    // precio: manual o calculado (si no hay)
    const priceManual = toInt(el.p_price?.value);
    const computedPrice = (priceManual > 0)
      ? priceManual
      : Math.round(cost * (1 + Math.max(0, margin) / 100));

    return {
      id,
      active: el.p_active?.value === 'true',
      name,
      brand: safeStr(el.p_brand?.value, 160),
      category: safeStr(el.p_category?.value, 160),
      sku: safeStr(el.p_sku?.value, 120),

      cost_cop: cost,
      margin_pct: Number.isFinite(margin) ? margin : 0,
      price_cop: Math.max(0, toInt(computedPrice)),

      desc: safeStr(el.p_desc?.value, 4000),
      image_url: safeStr(el.p_image?.value, 1200),
    };
  }

  /* =========================
     Stock modal
  ========================= */
  function openStockModal(presetProductId = '') {
    if (el.s_product_id) el.s_product_id.value = String(presetProductId || '');
    if (el.s_type) el.s_type.value = 'adjust';
    if (el.s_qty) el.s_qty.value = '';
    if (el.s_ref) el.s_ref.value = '';
    if (el.s_note) el.s_note.value = '';

    _safeShowModal(el.modalStock);
    setTimeout(() => { try { el.s_product_id?.focus?.(); } catch {} }, 0);
  }

  function closeStockModal() { _safeCloseModal(el.modalStock); }

  function readStockForm() {
    return {
      product_id: safeStr(el.s_product_id?.value, 80).trim(),
      type: safeStr(el.s_type?.value || 'adjust', 32).trim(),
      qty: toInt(el.s_qty?.value),
      ref: safeStr(el.s_ref?.value, 220),
      note: safeStr(el.s_note?.value, 800),
    };
  }

  /* =========================
     ✅ Restock (Pedido proveedor)
  ========================= */
  const RESTOCK_BADGE_MODE = (opts.restockBadgeMode === 'units') ? 'units' : 'items';

  function openRestockModal() { _safeShowModal(el.modalRestock); }
  function closeRestockModal() { _safeCloseModal(el.modalRestock); }

  function setRestockBadge(countOrUnits) {
    if (!el.restockCount) return;
    const n = Math.max(0, toInt(countOrUnits));
    el.restockCount.textContent = String(n);
    el.restockCount.hidden = (n <= 0);
  }

  function readRestockMeta() {
    return {
      supplier: safeStr(el.restockSupplier?.value, 240),
      notes: safeStr(el.restockNotes?.value, 1200),
    };
  }

  function writeRestockMeta(meta = {}) {
    if (el.restockSupplier && meta.supplier !== undefined) el.restockSupplier.value = safeStr(meta.supplier, 240);
    if (el.restockNotes && meta.notes !== undefined) el.restockNotes.value = safeStr(meta.notes, 1200);
  }

  function _restockItemId_(it) { return String(it?.id || it?.product_id || it?.pid || '').trim(); }
  function _restockItemName_(it) { return String(it?.name || it?.product_name || it?.nombre || _restockItemId_(it) || '—'); }
  function _restockItemCost_(it) { return Math.max(0, toInt(it?.cost_cop ?? it?.cost ?? it?.costo_cop ?? it?.costo ?? it?.unit_cost)); }

  function renderRestock(cart) {
    if (!el.restockBody || !el.restockTotalUnits || !el.restockTotalCost) return;

    const items = Array.isArray(cart?.items) ? cart.items : [];

    if (cart && (cart.supplier !== undefined || cart.notes !== undefined)) {
      writeRestockMeta({ supplier: cart.supplier, notes: cart.notes });
    }

    if (!items.length) {
      el.restockBody.innerHTML =
        `<tr><td colspan="5" class="muted">Aún no hay ítems. Agrega desde <b>Catálogo</b> con “Restock”.</td></tr>`;
      el.restockTotalUnits.textContent = '0';
      el.restockTotalCost.textContent = fmtCOP(0);
      setRestockBadge(0);
      return;
    }

    let totalUnits = 0;
    let totalCost = 0;

    const frag = document.createDocumentFragment();

    items.forEach((it) => {
      const pid = _restockItemId_(it);
      const name = _restockItemName_(it);
      const qty = Math.max(0, toInt(it?.qty));
      const cost = _restockItemCost_(it);

      totalUnits += qty;
      totalCost += (qty * cost);

      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.innerHTML =
        `<div class="cellTitle">${escapeHtml(name)}</div>` +
        `<div class="cellSub muted tiny mono">${escapeHtml(pid || '—')}</div>`;

      const td2 = document.createElement('td');
      td2.className = 'num mono';
      td2.innerHTML =
        `<input class="miniNum" type="number" min="0" step="1" value="${qty}" data-restock-qty="${escapeHtml(pid)}" />`;

      const td3 = document.createElement('td');
      td3.className = 'num mono';
      td3.innerHTML =
        `<input class="miniNum" type="number" min="0" step="1" value="${cost}" data-restock-cost="${escapeHtml(pid)}"
          title="${cost ? '' : 'Este producto no tiene costo. Ponlo para que el total sea real.'}" />`;

      const td4 = document.createElement('td');
      td4.className = 'num mono';
      td4.textContent = fmtCOP(qty * cost);

      const td5 = document.createElement('td');
      td5.className = 'num';
      td5.innerHTML =
        `<button class="btn btn--tiny btn--ghost" data-restock-del="${escapeHtml(pid)}" title="Quitar">✕</button>`;

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tr.appendChild(td5);

      frag.appendChild(tr);
    });

    el.restockBody.innerHTML = '';
    el.restockBody.appendChild(frag);

    el.restockTotalUnits.textContent = String(totalUnits);
    el.restockTotalCost.textContent = fmtCOP(totalCost);

    setRestockBadge(RESTOCK_BADGE_MODE === 'units' ? totalUnits : items.length);
  }

  function printRestock(cart, opts2 = {}) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const meta = readRestockMeta();
    const supplier = safeStr(cart?.supplier ?? meta.supplier, 240);
    const notes = safeStr(cart?.notes ?? meta.notes, 1200);

    let totalUnits = 0;
    let totalCost = 0;

    const rowsHtml = items.map((it) => {
      const pid = _restockItemId_(it);
      const name = escapeHtml(_restockItemName_(it));
      const qty = Math.max(0, toInt(it?.qty));
      const cost = _restockItemCost_(it);
      totalUnits += qty;
      totalCost += qty * cost;

      return `
        <tr>
          <td>
            <div style="font-weight:700;">${name}</div>
            <div style="color:#667; font-size:12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
              ${escapeHtml(pid || '—')}
            </div>
          </td>
          <td style="text-align:right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${qty}</td>
          <td style="text-align:right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${escapeHtml(fmtCOP(cost))}</td>
          <td style="text-align:right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${escapeHtml(fmtCOP(qty * cost))}</td>
        </tr>
      `;
    }).join('');

    const now = new Date();
    const title = safeStr(opts2.title || 'Pedido a proveedor (Restock)', 80);

    const html = `
<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root{ --text:#0b1020; --muted:#586079; --line:rgba(11,16,32,.18); }
  body{ margin:24px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:var(--text); }
  h1{ margin:0 0 6px; font-size:20px; }
  .meta{ color:var(--muted); font-size:12px; margin-bottom:14px; }
  .box{ border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:14px; }
  .row{ display:flex; gap:12px; flex-wrap:wrap; }
  .row > div{ min-width:220px; flex:1; }
  .label{ color:var(--muted); font-size:12px; margin-bottom:4px; }
  table{ width:100%; border-collapse:collapse; }
  th, td{ border-bottom:1px solid var(--line); padding:10px 8px; vertical-align:top; }
  th{ text-align:left; font-size:12px; color:var(--muted); letter-spacing:.02em; }
  .totals{ display:flex; justify-content:flex-end; gap:22px; margin-top:12px; }
  .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media print{
    body{ margin:12mm; }
    .box{ break-inside:avoid; }
    tr{ break-inside:avoid; }
  }
</style>
</head>
<body>
  <h1>🧺 ${escapeHtml(title)}</h1>
  <div class="meta">Generado: ${escapeHtml(now.toLocaleString('es-CO'))}</div>

  <div class="box">
    <div class="row">
      <div>
        <div class="label">Proveedor</div>
        <div>${escapeHtml(supplier || '—')}</div>
      </div>
      <div>
        <div class="label">Observaciones</div>
        <div>${escapeHtml(notes || '—')}</div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th style="text-align:right;">Cant.</th>
        <th style="text-align:right;">Costo</th>
        <th style="text-align:right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || `<tr><td colspan="4" style="color:#586079;">(Sin items)</td></tr>`}
    </tbody>
  </table>

  <div class="totals">
    <div>
      <div class="label">Total unidades</div>
      <div class="mono" style="font-size:16px;">${escapeHtml(String(totalUnits))}</div>
    </div>
    <div>
      <div class="label">Costo total</div>
      <div class="mono" style="font-size:16px;">${escapeHtml(fmtCOP(totalCost))}</div>
    </div>
  </div>

  <script>setTimeout(function(){ try{ window.print(); }catch(e){} }, 80);</script>
</body>
</html>`;

    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      toast('Bloqueo de popups: permite ventanas emergentes para imprimir.', false, { ms: 3500, replace: true });
      return false;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  }

  /* =========================
     Busy disable (simple)
  ========================= */
  function setBusy(disabled = true) {
    const dis = !!disabled;
    const btns = [
      el.btnRefresh, el.btnNewProduct, el.btnAdjustStock, el.btnNewSale,
      el.btnSaveSale, el.btnSaveProduct, el.btnSaveStock,
      el.btnLogout, el.btnGoogle,
      el.btnRestockOpen, el.btnPrintRestock, el.btnClearRestock,
      el.btnRefreshOrders
    ].filter(Boolean);

    btns.forEach(b => { try { b.disabled = dis; } catch {} });

    if (el.loginForm) {
      $$('input, button, select, textarea', el.loginForm).forEach(x => { try { x.disabled = dis; } catch {} });
    }
  }

  function lockModalCancel(dialogEl, shouldLockFn) {
    if (!dialogEl) return;
    on(dialogEl, 'cancel', (ev) => {
      try {
        if (typeof shouldLockFn === 'function' && shouldLockFn()) ev.preventDefault();
      } catch {}
    });
  }

  /* =========================
     Public interface
  ========================= */
  return {
    el,

    // primitives
    on, $, $$, qs, qsa, debounce,
    setText, setHTML,

    // ui
    toast,
    setView,
    setNet,
    setApiHint,
    setBuildHint,
    setAuthStatus,
    setUser,
    showTab,
    setBusy,
    lockModalCancel,

    // utils
    fmtCOP,
    toInt,
    toFloat,
    safeStr,
    escapeHtml,
    truthy_,
    moneyInputNormalize,
    parseDatalistProductId,
    pickPriceCOP_,
    pickCostCOP_,
    pickMargin_,

    // renderers
    renderKPIs,
    renderDashboard,
    renderCatalog,
    renderInventory,
    renderSaleItems,
    renderSaleProductsDatalist,
    renderOrdersPending,
    renderMoves,
    showSalePane,

    // modals
    openProductModal,
    closeProductModal,
    readProductForm,
    openStockModal,
    closeStockModal,
    readStockForm,

    // restock
    openRestockModal,
    closeRestockModal,
    setRestockBadge,
    readRestockMeta,
    writeRestockMeta,
    renderRestock,
    printRestock,
  };
}
