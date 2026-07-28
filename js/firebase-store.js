'use strict';

import { getFirestoreDb } from './firebase.js';

let fs = null;
async function sdk_() {
  if (!fs) fs = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js');
  if (!getFirestoreDb()) throw new Error('Firestore no está inicializado');
  return fs;
}
const n = (v) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0;
const s = (v) => String(v ?? '').trim();
const id = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const iso = (v) => v?.toDate ? v.toDate().toISOString() : (v || '');
const item = (snap) => ({ id: snap.id, ...snap.data() });

async function all_(collection, orderByField = '') {
  const f = await sdk_();
  const db = getFirestoreDb();
  const q = orderByField ? f.query(f.collection(db, collection), f.orderBy(orderByField, 'desc')) : f.collection(db, collection);
  return (await f.getDocs(q)).docs.map(item);
}

async function allIncludingMissing_(collection, orderByField = '') {
  const f = await sdk_();
  const db = getFirestoreDb();
  // Firestore excluye de una consulta orderBy los documentos antiguos que no
  // tienen ese campo. Las ventas se leen completas y se ordenan en cliente para
  // que ningún carrito histórico desaparezca del admin.
  const items = (await f.getDocs(f.collection(db, collection))).docs.map(item);
  if (orderByField) {
    items.sort((a, b) => iso(b?.[orderByField]).localeCompare(iso(a?.[orderByField])));
  }
  return items;
}

/* =============================================================================
   Costos: viven APARTE de products.
   -----------------------------------------------------------------------------
   products/{id}      -> datos visibles para todo el equipo (incl. precio de venta)
   productCosts/{id}  -> costo del proveedor, competencia y margen.
                         firestore.rules: solo ADMIN puede leerlo.
                         Las asesoras pueden escribirlo (registrar lo que les
                         cotiza el proveedor) pero no leer el histórico.
============================================================================= */
const COST_FIELDS_LEGACY = [
  'cost_cop', 'cost', 'costo_cop', 'costo',
  'margin_pct',
  'competitor_price_cop', 'competitor_price',
  'precio_competencia', 'precio_competencia_cop',
  'precioCompetencia', 'precioCompetenciaCOP',
];

export const StoreAPI = {
  async ping() { return { ok: true }; },
  async listProducts() { return { ok: true, items: await all_('products') }; },
  async listInventory() { return { ok: true, items: await all_('inventory') }; },

  /* Solo admin: firestore.rules rechaza esta lectura para asesoras. */
  async listProductCosts() { return { ok: true, items: await all_('productCosts') }; },

  async getProductCost(productId) {
    const f = await sdk_();
    const snap = await f.getDoc(f.doc(getFirestoreDb(), 'productCosts', s(productId)));
    return { ok: true, cost: snap.exists() ? item(snap) : null };
  },

  /* -------- Regla de precios (settings/pricing) -------- */
  async getPricingSettings() {
    const f = await sdk_();
    const snap = await f.getDoc(f.doc(getFirestoreDb(), 'settings', 'pricing'));
    return { ok: true, settings: snap.exists() ? snap.data() : null };
  },

  async savePricingSettings(settings = {}, updatedBy = '') {
    const f = await sdk_();
    const tiers = (Array.isArray(settings.tiers) ? settings.tiers : []).map(t => ({
      max: Math.max(0, n(t?.max)),
      margin_pct: Math.max(0, Number(t?.margin_pct) || 0),
    }));
    const data = {
      version: Math.max(1, n(settings.version) || 1),
      tiers,
      round_to: Math.max(0, n(settings.round_to)),
      round_mode: ['up', 'nearest', 'none'].includes(s(settings.round_mode)) ? s(settings.round_mode) : 'up',
      updated_at: f.serverTimestamp(),
      updated_by: s(updatedBy),
    };
    await f.setDoc(f.doc(getFirestoreDb(), 'settings', 'pricing'), data, { merge: true });
    return { ok: true, settings: data };
  },

  /* -------- Migración: sacar costos viejos de products -------- */
  async migrateCostsOutOfProducts(updatedBy = '') {
    const f = await sdk_(); const db = getFirestoreDb();
    const products = await all_('products');

    let moved = 0, cleaned = 0;
    let batch = f.writeBatch(db); let ops = 0;

    const flush = async () => { if (ops) { await batch.commit(); batch = f.writeBatch(db); ops = 0; } };

    for (const p of products) {
      const pid = s(p.id);
      if (!pid) continue;

      const cost = n(p.cost_cop ?? p.cost ?? p.costo_cop ?? p.costo);
      const comp = n(p.competitor_price_cop ?? p.competitor_price ?? p.precio_competencia ?? p.precio_competencia_cop);
      const margin = Number(p.margin_pct) || 0;
      const hasLegacy = COST_FIELDS_LEGACY.some(k => p[k] !== undefined);
      if (!hasLegacy) continue;

      // Si hay CUALQUIER dato que valga la pena, se copia antes de borrarlo.
      // (Antes solo miraba costo y competencia: un producto con solo % de
      //  ganancia perdía el dato al limpiarlo de products/.)
      if (cost > 0 || comp > 0 || margin > 0) {
        batch.set(f.doc(db, 'productCosts', pid), {
          product_id: pid,
          cost_cop: cost,
          competitor_price_cop: comp,
          margin_pct: margin,
          price_cop: n(p.price_cop ?? p.price ?? p.precio_cop ?? p.precio),
          updated_at: f.serverTimestamp(),
          updated_by: s(updatedBy),
          migrated: true,
        }, { merge: true });
        ops++; moved++;
      }

      const strip = {};
      for (const k of COST_FIELDS_LEGACY) if (p[k] !== undefined) strip[k] = f.deleteField();
      strip.has_cost = cost > 0;
      strip.updated_at = f.serverTimestamp();

      batch.set(f.doc(db, 'products', pid), strip, { merge: true });
      ops++; cleaned++;

      if (ops >= 400) await flush();
    }

    await flush();
    return { ok: true, moved, cleaned, total: products.length };
  },

  /* -------- Utilidades (solo admin: necesita leer productCosts) -------- */
  async profitReport() {
    const [sales, costs] = await Promise.all([allIncludingMissing_('sales', 'created_at'), all_('productCosts')]);
    const costOf = new Map(costs.map(c => [s(c.product_id || c.id), n(c.cost_cop)]));
    const today = new Date().toISOString().slice(0, 10);

    let revenue = 0, cogs = 0, revenueToday = 0, cogsToday = 0, unknownCost = 0;

    for (const sale of sales) {
      if (sale.status !== 'paid') continue;
      const isToday = iso(sale.created_at).slice(0, 10) === today;

      for (const row of (sale.items || [])) {
        const qty = n(row.qty);
        const line = n(row.unit_price) * qty;
        const pid = s(row.product_id);
        const unitCost = costOf.has(pid) ? costOf.get(pid) : null;
        if (unitCost === null) unknownCost += qty;
        const lineCost = (unitCost || 0) * qty;

        revenue += line; cogs += lineCost;
        if (isToday) { revenueToday += line; cogsToday += lineCost; }
      }
    }

    return {
      ok: true,
      revenue_cop: revenue,
      profit_cop: revenue - cogs,
      revenue_today_cop: revenueToday,
      profit_today_cop: revenueToday - cogsToday,
      units_without_cost: unknownCost,
    };
  },
  async listMoves(q = '', limit = 200) {
    const products = new Map((await all_('products')).map(p => [p.id, p.name || '']));
    const term = s(q).toLowerCase();
    let items = await all_('inventoryMoves', 'date');
    items = items.map(x => ({ ...x, product_name: products.get(x.product_id) || '', date: iso(x.date) }));
    if (term) items = items.filter(x => [x.move_id,x.product_id,x.product_name,x.type,x.ref,x.note].join(' ').toLowerCase().includes(term));
    return { ok: true, items: items.slice(0, limit) };
  },
  /**
   * upsertProduct
   * - products/{id}      : SIN datos de costo (whitelist explícita).
   * - productCosts/{id}  : costo/competencia/margen, solo si vienen en el guardado.
   *
   * opts:
   *   writeCost         -> escribir el costo (false = no tocar el costo guardado)
   *   includeCompetitor -> incluir precio de competencia (solo admin lo edita)
   *   updatedBy         -> correo de quien guarda (auditoría)
   */
  async upsertProduct(product = {}, opts = {}) {
    const f = await sdk_(); const db = getFirestoreDb();
    const productId = s(product.id || product.product_id) || id('prod');
    const ref = f.doc(db, 'products', productId);
    const previous = await f.getDoc(ref);
    const prevData = previous.exists() ? (previous.data() || {}) : {};

    const cost = Math.max(0, n(product.cost_cop));
    const writeCost = opts.writeCost !== false && cost > 0;
    const hadCost = !!prevData.has_cost;

    // products: campos públicos únicamente
    const data = {
      id: productId,
      name: s(product.name),
      brand: s(product.brand),
      category: s(product.category),
      desc: s(product.desc),
      sku: s(product.sku),
      image_url: s(product.image_url),
      price_cop: n(product.price_cop),
      active: product.active !== false,
      has_cost: writeCost ? true : hadCost,
      updated_at: f.serverTimestamp(),
      updated_by: s(opts.updatedBy),
    };

    // Limpieza: si el documento venía con costos incrustados (modelo viejo), los saca.
    for (const k of COST_FIELDS_LEGACY) {
      if (prevData[k] !== undefined) data[k] = f.deleteField();
    }

    await f.setDoc(ref, data, { merge: true });

    if (writeCost) {
      const costDoc = {
        product_id: productId,
        cost_cop: cost,
        margin_pct: Number(product.margin_pct) || 0,
        price_cop: n(product.price_cop),
        updated_at: f.serverTimestamp(),
        updated_by: s(opts.updatedBy),
      };
      if (opts.includeCompetitor) costDoc.competitor_price_cop = Math.max(0, n(product.competitor_price_cop));
      await f.setDoc(f.doc(db, 'productCosts', productId), costDoc, { merge: true });
    } else if (!hadCost) {
      // Producto del modelo viejo que aún guarda el costo adentro: lo rescatamos
      // antes de borrarlo de products/. Solo ocurre si nunca se migró (has_cost=false).
      const legacyCost = n(prevData.cost_cop ?? prevData.cost ?? prevData.costo_cop ?? prevData.costo);
      const legacyComp = n(prevData.competitor_price_cop ?? prevData.competitor_price ?? prevData.precio_competencia ?? prevData.precio_competencia_cop);
      if (legacyCost > 0 || legacyComp > 0) {
        await f.setDoc(f.doc(db, 'productCosts', productId), {
          product_id: productId,
          cost_cop: legacyCost,
          competitor_price_cop: legacyComp,
          margin_pct: Number(prevData.margin_pct) || 0,
          price_cop: n(product.price_cop),
          updated_at: f.serverTimestamp(),
          updated_by: s(opts.updatedBy),
          migrated: true,
        }, { merge: true });
        await f.setDoc(ref, { has_cost: legacyCost > 0 }, { merge: true });
      }
    }

    if (!previous.exists()) await f.setDoc(f.doc(db, 'inventory', productId), { product_id: productId, stock: 0, min_stock: 0, location: '', updated_at: f.serverTimestamp() }, { merge: true });
    return { ok: true, mode: previous.exists() ? 'updated' : 'created', id: productId, product: data, cost_saved: writeCost };
  },
  async setProductActive(productId, active) { const f = await sdk_(); await f.updateDoc(f.doc(getFirestoreDb(), 'products', s(productId)), { active: !!active, updated_at: f.serverTimestamp() }); return { ok: true, active: !!active }; },
  async updateInventoryMeta(data = {}) { const f = await sdk_(); const pid = s(data.product_id); await f.setDoc(f.doc(getFirestoreDb(), 'inventory', pid), { product_id: pid, min_stock: Math.max(0,n(data.min_stock)), location: s(data.location), updated_at: f.serverTimestamp() }, { merge: true }); return { ok: true }; },
  async adjustStock(data = {}) {
    const f = await sdk_(), db = getFirestoreDb(), pid = s(data.product_id), delta = n(data.qty); if (!pid || !delta) throw new Error('Producto y cantidad válidos son obligatorios.');
    const invRef = f.doc(db, 'inventory', pid), moveId = id('mov');
    await f.runTransaction(db, async tx => { const current = (await tx.get(invRef)).data() || {}; const stock = n(current.stock) + delta; if (stock < 0) throw new Error('No hay stock suficiente.'); tx.set(invRef, { product_id: pid, stock, min_stock:n(current.min_stock), location:s(current.location), updated_at:f.serverTimestamp() }, { merge:true }); tx.set(f.doc(db,'inventoryMoves',moveId), { move_id:moveId, product_id:pid, type:s(data.type)||'adjust', qty:delta, ref:s(data.ref), note:s(data.note), date:f.serverTimestamp() }); });
    const now = await f.getDoc(invRef); return { ok:true, move_id:moveId, stock:n(now.data()?.stock) };
  },
  async listSales(status = 'pending', includeItems = false, limit = 200) { let sales = await allIncludingMissing_('sales','created_at'); if (status && status !== 'all') sales = sales.filter(x => x.status === status); return { ok:true, items:sales.slice(0,limit).map(x => ({...x,created_at:iso(x.created_at),paid_at:iso(x.paid_at),items:includeItems ? (x.items||[]) : undefined})) }; },
  async getSale(saleId) { const f=await sdk_(); const snap=await f.getDoc(f.doc(getFirestoreDb(),'sales',s(saleId))); if(!snap.exists()) throw new Error('Venta no encontrada'); const x=item(snap); return {ok:true,sale:{...x,created_at:iso(x.created_at),paid_at:iso(x.paid_at)},items:x.items||[]}; },
  async createSale({ sale = {}, items = [] } = {}) {
    const f = await sdk_();
    const db = getFirestoreDb();
    const saleId = id('sale');
    const clean = items
      .map(x => ({
        product_id: s(x.product_id),
        qty: n(x.qty),
        unit_price: n(x.unit_price),
        subtotal: n(x.qty) * n(x.unit_price),
      }))
      .filter(x => x.product_id && x.qty > 0);

    if (!clean.length) throw new Error('Agrega al menos un producto.');

    const total = clean.reduce((a, x) => a + x.subtotal, 0);
    const requested = s(sale.status) || 'paid';
    const initial = Math.min(total, Math.max(0, n(sale.initial_payment_cop)));
    const status = requested === 'installments'
      ? (initial >= total ? 'paid' : 'installments')
      : requested;
    const paid = status === 'paid' ? total : (status === 'installments' ? initial : 0);
    const balance = Math.max(0, total - paid);
    const actor = s(sale.created_by || sale.updated_by);
    const payments = paid ? [{
      amount_cop: paid,
      date: new Date().toISOString(),
      method: s(sale.payment_method),
      note: requested === 'installments' ? 'Abono inicial' : 'Pago completo',
    }] : [];

    await f.runTransaction(db, async tx => {
      if (status === 'paid' || status === 'installments') {
        const inventoryRows = [];
        for (const row of clean) {
          const ref = f.doc(db, 'inventory', row.product_id);
          const cur = (await tx.get(ref)).data() || {};
          const stock = n(cur.stock) - row.qty;
          if (stock < 0) throw new Error('Stock insuficiente para ' + row.product_id);
          inventoryRows.push({ row, ref, cur, stock });
        }

        // Firestore exige completar todas las lecturas antes de empezar a
        // escribir dentro de la transacción. Esto también cubre carritos con
        // varios productos, no solo ventas de una línea.
        for (const { row, ref, cur, stock } of inventoryRows) {
          const moveId = id('mov');
          tx.set(ref, { ...cur, product_id: row.product_id, stock, updated_at: f.serverTimestamp() }, { merge: true });
          tx.set(f.doc(db, 'inventoryMoves', moveId), {
            move_id: moveId,
            product_id: row.product_id,
            type: 'sale',
            qty: -row.qty,
            ref: saleId,
            note: 'Venta ' + saleId,
            date: f.serverTimestamp(),
          });
        }
      }

      tx.set(f.doc(db, 'sales', saleId), {
        id: saleId,
        customer_id: s(sale.customer_id),
        payment_method: s(sale.payment_method),
        status,
        total_cop: total,
        paid_cop: paid,
        balance_cop: balance,
        payments,
        notes: s(sale.notes),
        created_at: f.serverTimestamp(),
        created_by: actor,
        updated_at: f.serverTimestamp(),
        updated_by: actor,
        paid_at: status === 'paid' ? f.serverTimestamp() : null,
        posted: status === 'paid',
        items: clean,
      });
    });

    return { ok: true, id: saleId, total_cop: total, balance_cop: balance };
  },
  async addPayment(saleId, amount, method = 'cash', note = '') { const f=await sdk_(),db=getFirestoreDb(),ref=f.doc(db,'sales',s(saleId)),value=Math.max(0,n(amount));if(!value)throw new Error('Ingresa un abono válido.');await f.runTransaction(db,async tx=>{const sale=(await tx.get(ref)).data();if(!sale)throw new Error('Venta no encontrada');const balance=Math.max(0,n(sale.balance_cop));if(value>balance)throw new Error('El abono supera el saldo pendiente.');const nextBalance=balance-value,nextStatus=nextBalance===0?'paid':'installments',payments=[...(sale.payments||[]),{amount_cop:value,date:new Date().toISOString(),method:s(method)||'cash',note:s(note)}];tx.update(ref,{paid_cop:n(sale.paid_cop)+value,balance_cop:nextBalance,status:nextStatus,payments,paid_at:nextStatus==='paid'?f.serverTimestamp():null,posted:nextStatus==='paid'});});return {ok:true}; },
  async updateSaleStatus(saleId, status, updatedBy = '') {
    const f = await sdk_();
    const db = getFirestoreDb();
    const ref = f.doc(db, 'sales', s(saleId));
    const next = s(status);

    await f.runTransaction(db, async tx => {
      const sale = (await tx.get(ref)).data();
      if (!sale) throw new Error('Venta no encontrada');

      if (next === 'paid' && sale.status !== 'paid') {
        const inventoryRows = [];
        for (const row of (sale.items || [])) {
          const productId = s(row.product_id);
          const inv = f.doc(db, 'inventory', productId);
          const cur = (await tx.get(inv)).data() || {};
          const stock = n(cur.stock) - n(row.qty);
          if (stock < 0) throw new Error('Stock insuficiente para ' + productId);
          inventoryRows.push({ row, productId, inv, cur, stock });
        }

        for (const { row, productId, inv, cur, stock } of inventoryRows) {
          const moveId = id('mov');
          tx.set(inv, { ...cur, product_id: productId, stock, updated_at: f.serverTimestamp() }, { merge: true });
          tx.set(f.doc(db, 'inventoryMoves', moveId), {
            move_id: moveId,
            product_id: productId,
            type: 'sale',
            qty: -n(row.qty),
            ref: s(saleId),
            note: 'Venta ' + s(saleId),
            date: f.serverTimestamp(),
          });
        }
      }

      const patch = {
        status: next,
        paid_at: next === 'paid' ? f.serverTimestamp() : null,
        posted: next === 'paid',
        updated_at: f.serverTimestamp(),
        updated_by: s(updatedBy),
      };

      if (next === 'paid') {
        const total = n(sale.total_cop);
        const currentPayments = Array.isArray(sale.payments) ? sale.payments : [];
        const alreadyPaid = currentPayments.reduce((sum, payment) => sum + n(payment.amount_cop), 0);
        const remaining = Math.max(0, total - alreadyPaid);
        patch.paid_cop = total;
        patch.balance_cop = 0;
        patch.payments = remaining > 0
          ? currentPayments.concat([{
            amount_cop: remaining,
            date: new Date().toISOString(),
            method: s(sale.payment_method),
            note: 'Pago completo',
          }])
          : currentPayments;
      }

      tx.update(ref, patch);
    });

    return { ok: true };
  },
  async updateSale(saleId, patch = {}) {
    const f = await sdk_(); const ref = f.doc(getFirestoreDb(), 'sales', s(saleId));
    const data = {};
    if ('customer_id' in patch) data.customer_id = s(patch.customer_id);
    if ('payment_method' in patch) data.payment_method = s(patch.payment_method);
    if ('notes' in patch) data.notes = s(patch.notes);
    if (!Object.keys(data).length) return { ok: true };
    data.updated_at = f.serverTimestamp();
    await f.updateDoc(ref, data);
    return { ok: true };
  },
  async deleteSale(saleId) {
    const f = await sdk_(), db = getFirestoreDb(), ref = f.doc(db, 'sales', s(saleId));
    await f.runTransaction(db, async tx => {
      const sale = (await tx.get(ref)).data();
      if (!sale) throw new Error('Venta no encontrada');
      const discounted = sale.status === 'paid' || sale.status === 'installments';
      if (discounted) {
        // Devolver el stock que la venta había descontado
        const rows = (sale.items || []).filter(r => s(r.product_id) && n(r.qty) > 0);
        const reads = [];
        for (const row of rows) {
          const inv = f.doc(db, 'inventory', s(row.product_id));
          reads.push([row, inv, (await tx.get(inv)).data() || {}]);
        }
        for (const [row, inv, cur] of reads) {
          const stock = n(cur.stock) + n(row.qty);
          const moveId = id('mov');
          tx.set(inv, { ...cur, product_id: s(row.product_id), stock, updated_at: f.serverTimestamp() }, { merge: true });
          tx.set(f.doc(db, 'inventoryMoves', moveId), { move_id: moveId, product_id: s(row.product_id), type: 'sale_delete', qty: n(row.qty), ref: s(saleId), note: 'Eliminación venta ' + s(saleId), date: f.serverTimestamp() });
        }
      }
      tx.delete(ref);
    });
    return { ok: true };
  },
  async updatePayment(saleId, index, { amount, method, note } = {}) {
    const f = await sdk_(), db = getFirestoreDb(), ref = f.doc(db, 'sales', s(saleId));
    await f.runTransaction(db, async tx => {
      const sale = (await tx.get(ref)).data();
      if (!sale) throw new Error('Venta no encontrada');
      const payments = [...(sale.payments || [])];
      const i = n(index);
      if (i < 0 || i >= payments.length) throw new Error('Abono no encontrado');
      const next = { ...payments[i] };
      if (amount !== undefined) next.amount_cop = Math.max(0, n(amount));
      if (method !== undefined) next.method = s(method) || 'cash';
      if (note !== undefined) next.note = s(note);
      next.edited_at = new Date().toISOString();
      payments[i] = next;
      const total = n(sale.total_cop);
      const paid = payments.reduce((a, p) => a + n(p.amount_cop), 0);
      if (paid > total) throw new Error('Los abonos superan el total de la venta.');
      const balance = total - paid;
      const status = balance === 0 ? 'paid' : 'installments';
      tx.update(ref, { payments, paid_cop: paid, balance_cop: balance, status, posted: status === 'paid', paid_at: status === 'paid' ? f.serverTimestamp() : null });
    });
    return { ok: true };
  },
  async deletePayment(saleId, index) {
    const f = await sdk_(), db = getFirestoreDb(), ref = f.doc(db, 'sales', s(saleId));
    await f.runTransaction(db, async tx => {
      const sale = (await tx.get(ref)).data();
      if (!sale) throw new Error('Venta no encontrada');
      const payments = [...(sale.payments || [])];
      const i = n(index);
      if (i < 0 || i >= payments.length) throw new Error('Abono no encontrado');
      payments.splice(i, 1);
      const total = n(sale.total_cop);
      const paid = payments.reduce((a, p) => a + n(p.amount_cop), 0);
      const balance = total - paid;
      const status = balance === 0 && total > 0 ? 'paid' : 'installments';
      tx.update(ref, { payments, paid_cop: paid, balance_cop: balance, status, posted: status === 'paid', paid_at: status === 'paid' ? f.serverTimestamp() : null });
    });
    return { ok: true };
  },
  /* =========================
     Interesados (leads)
     -------------------------
     Gente que preguntó por algo y todavía no compra. Se les hace seguimiento
     hasta que se convierte en venta (o se marca como perdido).
  ========================= */
  async listLeads(limit = 500) {
    const items = await all_('leads', 'updated_at');
    return { ok: true, items: items.map(x => ({ ...x, created_at: iso(x.created_at), updated_at: iso(x.updated_at) })).slice(0, limit) };
  },

  async upsertLead(lead = {}, updatedBy = '') {
    const f = await sdk_(); const db = getFirestoreDb();
    const leadId = s(lead.id) || id('lead');
    const ref = f.doc(db, 'leads', leadId);
    const previous = await f.getDoc(ref);

    const data = {
      id: leadId,
      name: s(lead.name),
      phone: s(lead.phone),
      interest: s(lead.interest),
      product_id: s(lead.product_id),
      product_name: s(lead.product_name),
      status: ['nuevo', 'seguimiento', 'ganado', 'perdido'].includes(s(lead.status)) ? s(lead.status) : 'nuevo',
      next_contact_at: s(lead.next_contact_at),
      notes: s(lead.notes),
      updated_at: f.serverTimestamp(),
      updated_by: s(updatedBy),
    };

    if (!previous.exists()) {
      data.created_at = f.serverTimestamp();
      data.created_by = s(updatedBy);
      data.history = [];
    }

    await f.setDoc(ref, data, { merge: true });
    return { ok: true, mode: previous.exists() ? 'updated' : 'created', id: leadId };
  },

  /* Registra un contacto y reprograma el siguiente. */
  async addLeadFollowUp(leadId, { note = '', nextContactAt = '', by = '' } = {}) {
    const f = await sdk_(); const db = getFirestoreDb();
    const ref = f.doc(db, 'leads', s(leadId));

    await f.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const lead = snap.data();
      if (!lead) throw new Error('Interesado no encontrado');

      const history = [...(lead.history || []), { at: new Date().toISOString(), note: s(note), by: s(by) }];
      tx.update(ref, {
        history,
        next_contact_at: s(nextContactAt),
        status: lead.status === 'nuevo' ? 'seguimiento' : lead.status,
        updated_at: f.serverTimestamp(),
        updated_by: s(by),
      });
    });

    return { ok: true };
  },

  async setLeadStatus(leadId, status, extra = {}) {
    const f = await sdk_();
    const next = ['nuevo', 'seguimiento', 'ganado', 'perdido'].includes(s(status)) ? s(status) : 'seguimiento';
    const data = { status: next, updated_at: f.serverTimestamp(), updated_by: s(extra.by) };

    if (next === 'ganado') { data.sale_id = s(extra.saleId); data.next_contact_at = ''; }
    if (next === 'perdido') { data.lost_reason = s(extra.reason); data.next_contact_at = ''; }

    await f.updateDoc(f.doc(getFirestoreDb(), 'leads', s(leadId)), data);
    return { ok: true, status: next };
  },

  async deleteLead(leadId) {
    const f = await sdk_();
    await f.deleteDoc(f.doc(getFirestoreDb(), 'leads', s(leadId)));
    return { ok: true };
  },

  async dashboard() { const [products,inventory,sales]=await Promise.all([all_('products'),all_('inventory'),allIncludingMissing_('sales','created_at')]); const paid=sales.filter(x=>x.status==='paid'); const today=new Date().toISOString().slice(0,10); return {ok:true,products_count:products.length,low_stock:inventory.filter(x=>n(x.stock)<=n(x.min_stock)),today_total_cop:paid.filter(x=>iso(x.created_at).slice(0,10)===today).reduce((a,x)=>a+n(x.total_cop),0),total_cop:paid.reduce((a,x)=>a+n(x.total_cop),0),sales_count:paid.length}; },
};
