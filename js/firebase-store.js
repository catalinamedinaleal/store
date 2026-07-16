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

export const StoreAPI = {
  async ping() { return { ok: true }; },
  async listProducts() { return { ok: true, items: await all_('products') }; },
  async listInventory() { return { ok: true, items: await all_('inventory') }; },
  async listMoves(q = '', limit = 200) {
    const products = new Map((await all_('products')).map(p => [p.id, p.name || '']));
    const term = s(q).toLowerCase();
    let items = await all_('inventoryMoves', 'date');
    items = items.map(x => ({ ...x, product_name: products.get(x.product_id) || '', date: iso(x.date) }));
    if (term) items = items.filter(x => [x.move_id,x.product_id,x.product_name,x.type,x.ref,x.note].join(' ').toLowerCase().includes(term));
    return { ok: true, items: items.slice(0, limit) };
  },
  async upsertProduct(product = {}) {
    const f = await sdk_(); const db = getFirestoreDb();
    const productId = s(product.id || product.product_id) || id('prod');
    const ref = f.doc(db, 'products', productId); const previous = await f.getDoc(ref);
    const data = { ...product, id: productId, name: s(product.name), brand: s(product.brand), category: s(product.category), desc: s(product.desc), sku: s(product.sku), image_url: s(product.image_url), price_cop: n(product.price_cop), cost_cop: n(product.cost_cop), competitor_price_cop: n(product.competitor_price_cop), competitor_url: s(product.competitor_url), active: product.active !== false, updated_at: f.serverTimestamp() };
    await f.setDoc(ref, data, { merge: true });
    if (!previous.exists()) await f.setDoc(f.doc(db, 'inventory', productId), { product_id: productId, stock: 0, min_stock: 0, location: '', updated_at: f.serverTimestamp() }, { merge: true });
    return { ok: true, mode: previous.exists() ? 'updated' : 'created', id: productId, product: data };
  },
  async setProductActive(productId, active) { const f = await sdk_(); await f.updateDoc(f.doc(getFirestoreDb(), 'products', s(productId)), { active: !!active, updated_at: f.serverTimestamp() }); return { ok: true, active: !!active }; },
  async updateInventoryMeta(data = {}) { const f = await sdk_(); const pid = s(data.product_id); await f.setDoc(f.doc(getFirestoreDb(), 'inventory', pid), { product_id: pid, min_stock: Math.max(0,n(data.min_stock)), location: s(data.location), updated_at: f.serverTimestamp() }, { merge: true }); return { ok: true }; },
  async adjustStock(data = {}) {
    const f = await sdk_(), db = getFirestoreDb(), pid = s(data.product_id), delta = n(data.qty); if (!pid || !delta) throw new Error('Producto y cantidad válidos son obligatorios.');
    const invRef = f.doc(db, 'inventory', pid), moveId = id('mov');
    await f.runTransaction(db, async tx => { const current = (await tx.get(invRef)).data() || {}; const stock = n(current.stock) + delta; if (stock < 0) throw new Error('No hay stock suficiente.'); tx.set(invRef, { product_id: pid, stock, min_stock:n(current.min_stock), location:s(current.location), updated_at:f.serverTimestamp() }, { merge:true }); tx.set(f.doc(db,'inventoryMoves',moveId), { move_id:moveId, product_id:pid, type:s(data.type)||'adjust', qty:delta, ref:s(data.ref), note:s(data.note), date:f.serverTimestamp() }); });
    const now = await f.getDoc(invRef); return { ok:true, move_id:moveId, stock:n(now.data()?.stock) };
  },
  async listSales(status = 'pending', includeItems = false, limit = 200) { let sales = await all_('sales','created_at'); if (status && status !== 'all') sales = sales.filter(x => x.status === status); return { ok:true, items:sales.slice(0,limit).map(x => ({...x,created_at:iso(x.created_at),paid_at:iso(x.paid_at),items:includeItems ? (x.items||[]) : undefined})) }; },
  async getSale(saleId) { const f=await sdk_(); const snap=await f.getDoc(f.doc(getFirestoreDb(),'sales',s(saleId))); if(!snap.exists()) throw new Error('Venta no encontrada'); const x=item(snap); return {ok:true,sale:{...x,created_at:iso(x.created_at),paid_at:iso(x.paid_at)},items:x.items||[]}; },
  async createSale({ sale = {}, items = [] } = {}) {
    const f=await sdk_(), db=getFirestoreDb(), saleId=id('sale'), clean=items.map(x=>({product_id:s(x.product_id),qty:n(x.qty),unit_price:n(x.unit_price),subtotal:n(x.qty)*n(x.unit_price)})).filter(x=>x.product_id&&x.qty>0); if(!clean.length) throw new Error('Agrega al menos un producto.'); const total=clean.reduce((a,x)=>a+x.subtotal,0), requested=s(sale.status)||'paid', initial=Math.min(total,Math.max(0,n(sale.initial_payment_cop))), status=requested==='installments'?(initial>=total?'paid':'installments'):requested, paid=status==='paid'?total:(status==='installments'?initial:0), balance=Math.max(0,total-paid), payments=paid?[{amount_cop:paid,date:new Date().toISOString(),method:s(sale.payment_method),note:requested==='installments'?'Abono inicial':'Pago completo'}]:[];
    await f.runTransaction(db, async tx => { if(status==='paid'||status==='installments') for(const row of clean){const ref=f.doc(db,'inventory',row.product_id), cur=(await tx.get(ref)).data()||{}, stock=n(cur.stock)-row.qty; if(stock<0) throw new Error('Stock insuficiente para '+row.product_id); const moveId=id('mov'); tx.set(ref,{...cur,product_id:row.product_id,stock,updated_at:f.serverTimestamp()},{merge:true}); tx.set(f.doc(db,'inventoryMoves',moveId),{move_id:moveId,product_id:row.product_id,type:'sale',qty:-row.qty,ref:saleId,note:'Venta '+saleId,date:f.serverTimestamp()});} tx.set(f.doc(db,'sales',saleId),{id:saleId,customer_id:s(sale.customer_id),payment_method:s(sale.payment_method),status,total_cop:total,paid_cop:paid,balance_cop:balance,payments,notes:s(sale.notes),created_at:f.serverTimestamp(),paid_at:status==='paid'?f.serverTimestamp():null,posted:status==='paid',items:clean}); }); return {ok:true,id:saleId,total_cop:total,balance_cop:balance};
  },
  async addPayment(saleId, amount, method = 'cash', note = '') { const f=await sdk_(),db=getFirestoreDb(),ref=f.doc(db,'sales',s(saleId)),value=Math.max(0,n(amount));if(!value)throw new Error('Ingresa un abono válido.');await f.runTransaction(db,async tx=>{const sale=(await tx.get(ref)).data();if(!sale)throw new Error('Venta no encontrada');const balance=Math.max(0,n(sale.balance_cop));if(value>balance)throw new Error('El abono supera el saldo pendiente.');const nextBalance=balance-value,nextStatus=nextBalance===0?'paid':'installments',payments=[...(sale.payments||[]),{amount_cop:value,date:new Date().toISOString(),method:s(method)||'cash',note:s(note)}];tx.update(ref,{paid_cop:n(sale.paid_cop)+value,balance_cop:nextBalance,status:nextStatus,payments,paid_at:nextStatus==='paid'?f.serverTimestamp():null,posted:nextStatus==='paid'});});return {ok:true}; },
  async updateSaleStatus(saleId, status) { const f=await sdk_(),db=getFirestoreDb(),ref=f.doc(db,'sales',s(saleId)),next=s(status); await f.runTransaction(db,async tx=>{const sale=(await tx.get(ref)).data(); if(!sale) throw new Error('Venta no encontrada'); if(next==='paid'&&sale.status!=='paid') for(const row of (sale.items||[])){const inv=f.doc(db,'inventory',s(row.product_id)),cur=(await tx.get(inv)).data()||{},stock=n(cur.stock)-n(row.qty);if(stock<0)throw new Error('Stock insuficiente para '+s(row.product_id));const moveId=id('mov');tx.set(inv,{...cur,product_id:s(row.product_id),stock,updated_at:f.serverTimestamp()},{merge:true});tx.set(f.doc(db,'inventoryMoves',moveId),{move_id:moveId,product_id:s(row.product_id),type:'sale',qty:-n(row.qty),ref:s(saleId),note:'Venta '+s(saleId),date:f.serverTimestamp()});}tx.update(ref,{status:next,paid_at:next==='paid'?f.serverTimestamp():null,posted:next==='paid'});}); return {ok:true}; },
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
  async dashboard() { const [products,inventory,sales]=await Promise.all([all_('products'),all_('inventory'),all_('sales','created_at')]); const paid=sales.filter(x=>x.status==='paid'); const today=new Date().toISOString().slice(0,10); return {ok:true,products_count:products.length,low_stock:inventory.filter(x=>n(x.stock)<=n(x.min_stock)),today_total_cop:paid.filter(x=>iso(x.created_at).slice(0,10)===today).reduce((a,x)=>a+n(x.total_cop),0),total_cop:paid.reduce((a,x)=>a+n(x.total_cop),0),sales_count:paid.length}; },
};
