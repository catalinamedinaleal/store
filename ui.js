'use strict';

/* =============================================================================
  ui.js — Store UI Kernel (render + UX helpers) v4.3 PRO++
  -----------------------------------------------------------------------------
  Mejoras vs v4.2:
  ✅ TAB_IDS auto-detect (no asume tabs que no existen, ej. restock)
  ✅ fmtCOP con formatter cache (menos overhead)
  ✅ setView NO pisa el hidden del botón Restock (eso lo maneja Auth)
  ✅ Render más seguro: helper row builder + menos innerHTML donde no hace falta
  ✅ Mejor parsing de datalist (toma ID del paréntesis o del final)
  ✅ Toast: evita mensajes vacíos, mejor replace
  ✅ Restock render: tolera items sin id (no rompe UI)
============================================================================= */

export function createUI(opts = {}) {
  /* =========================
     DOM helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const on = (node, ev, fn, opts2) => node && node.addEventListener(ev, fn, opts2);

  // Delegación de eventos (mejor para tablas y botones dinámicos)
  function onDelegate(root, ev, selector, handler, opts2) {
    if (!root || !selector || typeof handler !== 'function') return () => {};
    const listener = (e) => {
      const t = e?.target;
      if (!t) return;
      const hit = t.closest(selector);
      if (!hit || !root.contains(hit)) return;
      handler(e, hit);
    };
    root.addEventListener(ev, listener, opts2);
    return () => root.removeEventListener(ev, listener, opts2);
  }

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
    tabRestock: $('tab-restock'),

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
     Soft validation (no drama)
  ========================= */
  const _required = ['netLabel', 'netPill'];
  const missing = _required.filter(k => !el[k]);
  if (missing.length) console.warn('[UI] Faltan elementos DOM:', missing.join(', '));

  /* =========================
     Tabs config (robusto)
  ========================= */
  const autoTabsFromDOM = () => {
    const names = (el.tabs || [])
      .map(b => String(b?.dataset?.tab || '').trim())
      .filter(Boolean);
    // dedupe
    return Array.from(new Set(names));
  };

  const TAB_IDS = Array.isArray(opts.tabIds) && opts.tabIds.length
    ? opts.tabIds.slice()
    : autoTabsFromDOM();

  function tabSectionId_(name) { return `tab-${name}`; }
  function tabSectionEl_(name) { return $(tabSectionId_(name)); }

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

  const UI_LOCALE = String(opts.locale || 'es-CO');
  const UI_CURRENCY = String(opts.currency || 'COP');

  let _fmtCOP = null;
  function fmtCOP(n) {
    const v = Number.isFinite(n) ? n : toInt(n);
    try {
      if (!_fmtCOP) {
        _fmtCOP = new Intl.NumberFormat(UI_LOCALE, {
          style: 'currency',
          currency: UI_CURRENCY,
          maximumFractionDigits: 0,
        });
      }
      return _fmtCOP.format(v);
    } catch {
      return '$' + String(Math.round(v));
    }
  }

  const truthy_ = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on', 'si', 'sí'].includes(s)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
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
  function moneyInputNormalize(inputEl, { format = false } = {}) {
    if (!inputEl) return 0;
    const n = Math.max(0, toInt(inputEl.value));
    inputEl.value = format ? String(n) : String(n);
    return n;
  }

  // Para datalist: "Nombre — Marca (ID)" -> ID, o "... (ID)" -> ID, o último token alfanumérico
  function parseDatalistProductId(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/\(([^)]+)\)\s*$/);
    if (m && m[1]) return String(m[1]).trim();

    // Si termina con algo tipo " P123" o "SKU123", lo toma si parece ID
    const tail = s.split(/\s+/).slice(-1)[0] || '';
    if (/^[a-z0-9][a-z0-9\-_]{1,80}$/i.test(tail)) return tail;

    // fallback: antes del primer "—"
    const cut = s.split('—')[0].trim();
    if (/^[a-z0-9][a-z0-9\-_]{1,80}$/i.test(cut)) return cut;

    return '';
  }

  /* =========================
     Toast (cola + sticky + replace + pause hover)
  ========================= */
  const TOAST = { q: [], showing: false, paused: false };

  function toast(msg, ok = true, opts2 = {}) {
    if (!el.toast) return;
    const m = String(msg || '').trim();
    if (!m) return;

    const item = {
      msg: m,
      ok: !!ok,
      sticky: !!opts2.sticky,
      ms: Number.isFinite(opts2.ms) ? opts2.ms : 2400,
      replace: !!opts2.replace,
    };

    if (item.replace) TOAST.q.length = 0;
    TOAST.q.push(item);

    if (!TOAST.showing) drainToast_();
  }

  function _toastAttachPause_() {
    if (!el.toast) return;
    if (el.toast.dataset.pauseBound === '1') return;
    el.toast.dataset.pauseBound = '1';

    on(el.toast, 'mouseenter', () => { TOAST.paused = true; });
    on(el.toast, 'mouseleave', () => { TOAST.paused = false; });

    // click = dismiss
    on(el.toast, 'click', () => {
      el.toast.hidden = true;
      clearTimeout(drainToast_._t);
      TOAST.paused = false;
      drainToast_();
    });
  }

  function drainToast_() {
    if (!el.toast) return;

    _toastAttachPause_();

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

    const ttl = next.sticky ? 8000 : next.ms;
    const startedAt = Date.now();

    const tick = () => {
      if (TOAST.paused) {
        drainToast_._t = setTimeout(tick, 180);
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= ttl) {
        el.toast.hidden = true;
        drainToast_();
        return;
      }
      drainToast_._t = setTimeout(tick, 180);
    };

    drainToast_._t = setTimeout(tick, 180);
  }

  /* =========================
     Views & Net
  ========================= */
  function setView(name) {
    document.body.dataset.view = name;

    if (el.viewLoading) el.viewLoading.hidden = (name !== 'loading');
    if (el.viewAuth) el.viewAuth.hidden = (name !== 'auth');
    if (el.viewApp) el.viewApp.hidden = (name !== 'app');

    // NOTA: NO tocar el.hidden de btnRestockOpen acá.
    // Ese botón depende de Auth (lo haces en index.html con onAuthStateChanged)
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
      btn.setAttribute('aria-selected', 'false');
    });

    const tablist = el.tabs[0]?.parentElement;
    if (tablist) tablist.setAttribute('role', 'tablist');

    // teclado: ← → Home End
    on(tablist, 'keydown', (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(e.key)) return;

      const tabs = el.tabs.filter(Boolean);
      const cur = document.activeElement;
      const i = Math.max(0, tabs.indexOf(cur));
      let nx = i;

      if (e.key === 'ArrowLeft') nx = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'ArrowRight') nx = (i + 1) % tabs.length;
      if (e.key === 'Home') nx = 0;
      if (e.key === 'End') nx = tabs.length - 1;

      e.preventDefault();
      try { tabs[nx]?.focus?.(); } catch {}
    });
  }

  function showTab(tabName) {
    const fallback = TAB_IDS[0] || (el.tabs?.[0]?.dataset?.tab) || 'catalog';
    const name = TAB_IDS.includes(tabName) ? tabName : fallback;

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

    TAB_IDS.forEach((n) => {
      const sec = tabSectionEl_(n);
      if (sec) sec.hidden = (n !== name);
    });

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
      td1.textContent = String(r.name || r.id || '');

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

    // Aquí usamos innerHTML por performance (tabla grande), pero TODO va escapado.
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
          <td class="num mono">${escapeHtml(fmtCOP(price))}</td>
          <td class="num mono">${toInt(stock)} ${stockBadge}</td>
          <td>${badge}</td>
          <td class="num" style="white-space:nowrap;">
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
      td4.textContent = String(r.location || '');

      const td5 = document.createElement('td');
      td5.className = 'tiny muted';
      td5.textContent = String(r.updated_at || '');

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
          <td class="num mono">${escapeHtml(fmtCOP(subtotal))}</td>
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

    el.saleProductsList.innerHTML = list
      .filter(p => truthy_(p?.active ?? true))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), UI_LOCALE))
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
          <td class="num mono">${escapeHtml(total)}</td>
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
          <td class="num mono">${escapeHtml(qty)}</td>
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
      else dlg?.setAttribute?.('open', '');
    } catch (e) {
      console.warn('[UI] showModal falló:', e?.message || e);
      try { dlg?.setAttribute?.('open', ''); } catch {}
    }
  }

  function _safeCloseModal(dlg) {
    try {
      if (dlg && typeof dlg.close === 'function') dlg.close();
      else dlg?.removeAttribute?.('open');
    } catch {}
  }

  // opcional: click fuera del modal para cerrar (cuando es <dialog>)
  function enableDialogBackdropClose(dialogEl, shouldCloseFn = null) {
    if (!dialogEl) return () => {};
    const handler = (e) => {
      try {
        if (typeof dialogEl.close !== 'function') return;
        const rect = dialogEl.getBoundingClientRect();
        const inDialog = (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        );
        if (inDialog) return;
        if (typeof shouldCloseFn === 'function' && !shouldCloseFn()) return;
        dialogEl.close();
      } catch {}
    };
    on(dialogEl, 'click', handler);
    return () => dialogEl.removeEventListener('click', handler);
  }

  /* =========================
     Product modal
  ========================= */
  function openProductModal(p) {
    const isNew = !p;
    if (el.productTitle) el.productTitle.textContent = isNew ? 'Nuevo producto' : 'Editar producto';

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
    if (el.p_desc) el.p_desc.value = p?.desc || p?.descripcion || '';
    if (el.p_image) el.p_image.value = p?.image_url || '';

    _safeShowModal(el.modalProduct);
    setTimeout(() => { try { el.p_name?.focus?.(); } catch {} }, 0);
  }

  function closeProductModal() { _safeCloseModal(el.modalProduct); }

  function readProductForm() {
    const id = safeStr(el.p_id?.value, 80).trim();
    const name = safeStr(el.p_name?.value, 220).trim();

    const cost = Math.max(0, toInt(el.p_cost?.value));
    const margin = toFloat(el.p_margin?.value);

    const priceManual = Math.max(0, toInt(el.p_price?.value));
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
  function _restockItemDesc_(it) { return String(it?.desc || it?.description || it?.descripcion || '').trim(); }
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

    items.forEach((it, idx) => {
      const pidRaw = _restockItemId_(it);
      const pid = pidRaw || `__noid_${idx}`; // si viene sin id, no explota la UI
      const name = _restockItemName_(it);
      const desc = _restockItemDesc_(it);
      const qty = Math.max(0, toInt(it?.qty));
      const cost = _restockItemCost_(it);

      totalUnits += qty;
      totalCost += (qty * cost);

      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.innerHTML =
        `<div class="cellTitle">${escapeHtml(name)}</div>` +
        (desc ? `<div class="cellSub muted tiny">${escapeHtml(desc)}</div>` : ``) +
        `<div class="cellSub muted tiny mono">${escapeHtml(pidRaw || '—')}</div>`;

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
      const desc = escapeHtml(_restockItemDesc_(it));
      const qty = Math.max(0, toInt(it?.qty));
      const cost = _restockItemCost_(it);
      totalUnits += qty;
      totalCost += qty * cost;

      return `
        <tr>
          <td>
            <div style="font-weight:700;">${name}</div>
            ${desc ? `<div style="color:#586079; font-size:12px;">${desc}</div>` : ``}
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
    on, onDelegate, $, $$, qs, qsa, debounce,
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
    enableDialogBackdropClose,

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