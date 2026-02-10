'use strict';

/* =============================================================================
  ui.js — Store UI Kernel (render + UX helpers) v2
  ------------------------------------------------
  ✅ DOM cache + validación suave (warn si faltan IDs)
  ✅ Tabs (show/hide) + aria-selected + foco decente
  ✅ Toast (cola, auto-hide, modo sticky opcional)
  ✅ Format COP (sin decimales) + parsers robustos
  ✅ Render eficiente (DocumentFragment) para tablas
  ✅ Modals: open/close + read/write forms (guard rails)
  ✅ Inventario usable: Nombre (ID) con productsIndex(Map)
============================================================================= */

export function createUI() {
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

    // topbar pills
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

    // app nav
    btnRefresh: $('btnRefresh'),
    btnOpenSheet: $('btnOpenSheet'),

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

    // modals
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
    p_desc: $('p_desc'),
    p_image: $('p_image'),

    modalStock: $('modalStock'),
    btnSaveStock: $('btnSaveStock'),
    s_product_id: $('s_product_id'),
    s_type: $('s_type'),
    s_qty: $('s_qty'),
    s_ref: $('s_ref'),
    s_note: $('s_note'),

    // toast
    toast: $('toast'),

    // tab sections
    tabCatalog: $('tab-catalog'),
    tabInventory: $('tab-inventory'),
    tabSales: $('tab-sales'),
    tabMoves: $('tab-moves'),
    tabDashboard: $('tab-dashboard'),
  };

  const TAB_IDS = ['catalog', 'inventory', 'sales', 'moves', 'dashboard'];

  /* =========================
     Soft validation (no drama)
  ========================= */
  const _required = [
    'viewLoading', 'viewAuth', 'viewApp',
    'netLabel', 'netPill',
    'catalogBody', 'inventoryBody',
    'lowStockBody',
  ];
  const missing = _required.filter(k => !el[k]);
  if (missing.length) {
    // No explota: solo avisa en consola. Humanos felices (rara vez).
    console.warn('[UI] Faltan elementos DOM:', missing.join(', '));
  }

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

  function pickPriceCOP_(p) {
    return toInt(p?.price_cop ?? p?.price ?? p?.precio_cop ?? p?.precio);
  }
  function pickCostCOP_(p) {
    return toInt(p?.cost_cop ?? p?.cost ?? p?.costo_cop ?? p?.costo);
  }

  function debounce(fn, ms = 160) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /* =========================
     Toast (cola + sticky)
  ========================= */
  const TOAST = { q: [], showing: false };

  /**
   * @param {string} msg
   * @param {boolean} ok
   * @param {{sticky?: boolean, ms?: number}} opts
   */
  function toast(msg, ok = true, opts = {}) {
    if (!el.toast) return;
    const item = {
      msg: String(msg || ''),
      ok: !!ok,
      sticky: !!opts.sticky,
      ms: Number.isFinite(opts.ms) ? opts.ms : 2400,
    };
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

    if (next.sticky) {
      // Sticky: se cierra cuando llegue otro toast o si tú lo cierras manualmente (no hay botón acá por simplicidad)
      drainToast_._t = setTimeout(() => {
        // por si alguien se olvida un sticky infinito, lo bajamos en 8s
        el.toast.hidden = true;
        drainToast_();
      }, 8000);
      return;
    }

    drainToast_._t = setTimeout(() => {
      el.toast.hidden = true;
      drainToast_();
    }, next.ms);
  }

  /* =========================
     Views & Net
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

  function setApiHint(apiBase) {
    if (!el.apiHint) return;
    const x = String(apiBase || '').trim();
    el.apiHint.textContent = x ? x : '(API_BASE pendiente)';
  }

  /* =========================
     Tabs (con foco + aria)
  ========================= */
  function showTab(tabName) {
    TAB_IDS.forEach((n) => {
      const btn = el.tabs.find(b => b.dataset.tab === n);
      const isOn = (n === tabName);

      if (btn) {
        btn.classList.toggle('is-active', isOn);
        btn.setAttribute('aria-selected', isOn ? 'true' : 'false');
        btn.setAttribute('tabindex', isOn ? '0' : '-1');
      }

      const sec = $('tab-' + n);
      if (sec) sec.hidden = !isOn;
    });

    // foco suave al primer input útil del tab
    const sec = $('tab-' + tabName);
    if (sec) {
      const first = sec.querySelector('input, select, textarea, button');
      if (first && typeof first.focus === 'function') {
        setTimeout(() => { try { first.focus({ preventScroll: true }); } catch {} }, 0);
      }
    }
  }

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

    // DocumentFragment (más rápido si se ponen densos con inventarios grandes)
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
  function renderCatalog(products, q = '') {
    if (!el.catalogBody) return;

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
      const active = !!p.active;
      const badge = active
        ? `<span class="badge">Activo</span>`
        : `<span class="badge badge--off">Oculto</span>`;

      const stock = toInt(p.stock);
      const minS = toInt(p.min_stock);
      const stockBadge = (minS > 0 && stock <= minS)
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

  /* =========================
     Render: Inventory (usable)
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
     Render: Sale items
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

    // Aquí string builder está bien: suelen ser pocos items.
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

  /* =========================
     Sale pane open/close
  ========================= */
  function showSalePane(open) {
    if (!el.salesEmpty || !el.salePane) return;
    el.salesEmpty.hidden = !!open;
    el.salePane.hidden = !open;
  }

  /* =========================
     Modals (guard rails)
  ========================= */
  function _safeShowModal(dlg) {
    try {
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
    } catch (e) {
      // si el dialog está dentro de otro dialog o el browser se pone creativo
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

  function openProductModal(p) {
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
    if (el.p_price) el.p_price.value = String(pickPriceCOP_(p));
    if (el.p_cost) el.p_cost.value = String(pickCostCOP_(p));
    if (el.p_desc) el.p_desc.value = p?.desc || '';
    if (el.p_image) el.p_image.value = p?.image_url || '';

    _safeShowModal(el.modalProduct);
    setTimeout(() => { try { el.p_name?.focus?.(); } catch {} }, 0);
  }

  function closeProductModal() {
    _safeCloseModal(el.modalProduct);
  }

  function readProductForm() {
    const id = safeStr(el.p_id?.value, 80).trim();
    const name = safeStr(el.p_name?.value, 220).trim();

    return {
      id,
      active: el.p_active?.value === 'true',
      name,
      brand: safeStr(el.p_brand?.value, 160),
      category: safeStr(el.p_category?.value, 160),
      sku: safeStr(el.p_sku?.value, 120),
      price_cop: toInt(el.p_price?.value),
      cost_cop: toInt(el.p_cost?.value),
      desc: safeStr(el.p_desc?.value, 4000),
      image_url: safeStr(el.p_image?.value, 1200),
    };
  }

  function openStockModal(presetProductId = '') {
    if (el.s_product_id) el.s_product_id.value = String(presetProductId || '');
    if (el.s_type) el.s_type.value = 'adjust';
    if (el.s_qty) el.s_qty.value = '';
    if (el.s_ref) el.s_ref.value = '';
    if (el.s_note) el.s_note.value = '';

    _safeShowModal(el.modalStock);
    setTimeout(() => { try { el.s_product_id?.focus?.(); } catch {} }, 0);
  }

  function closeStockModal() {
    _safeCloseModal(el.modalStock);
  }

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
     Busy disable (simple)
  ========================= */
  function setBusy(disabled = true) {
    const dis = !!disabled;
    if (el.btnRefresh) el.btnRefresh.disabled = dis;
    if (el.btnNewProduct) el.btnNewProduct.disabled = dis;
    if (el.btnAdjustStock) el.btnAdjustStock.disabled = dis;
    if (el.btnNewSale) el.btnNewSale.disabled = dis;
    if (el.btnSaveSale) el.btnSaveSale.disabled = dis;
    if (el.btnSaveProduct) el.btnSaveProduct.disabled = dis;
    if (el.btnSaveStock) el.btnSaveStock.disabled = dis;
    if (el.btnLogout) el.btnLogout.disabled = dis;
    if (el.btnGoogle) el.btnGoogle.disabled = dis;
    if (el.loginForm) {
      // deshabilita inputs del login también
      $$('input, button', el.loginForm).forEach(x => { try { x.disabled = dis; } catch {} });
    }
  }

  function lockModalCancel(dialogEl, shouldLockFn) {
    if (!dialogEl) return;
    on(dialogEl, 'cancel', (ev) => {
      try {
        if (typeof shouldLockFn === 'function' && shouldLockFn()) {
          ev.preventDefault();
        }
      } catch {}
    });
  }

  /* =========================
     Public interface
  ========================= */
  return {
    el,

    // primitives
    on,
    $,
    $$,
    debounce,

    toast,
    setView,
    setNet,
    setApiHint,
    showTab,
    setBusy,
    lockModalCancel,

    // utils
    fmtCOP,
    toInt,
    toFloat,
    safeStr,
    escapeHtml,
    pickPriceCOP_,
    pickCostCOP_,

    // renderers
    renderKPIs,
    renderDashboard,
    renderCatalog,
    renderInventory,
    renderSaleItems,
    showSalePane,

    // modals
    openProductModal,
    closeProductModal,
    readProductForm,
    openStockModal,
    closeStockModal,
    readStockForm,
  };
}
