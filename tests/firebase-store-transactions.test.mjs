import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Ejecuta el StoreAPI real, sustituyendo únicamente sus dos entradas Firebase.
// El mock rechaza lecturas posteriores a escrituras igual que Firestore, y
// aplica cambios solo al terminar la transacción para comprobar atomicidad.
const source = fs.readFileSync(new URL('../js/firebase-store.js', import.meta.url), 'utf8')
  .replace("import { getFirestoreDb } from './firebase.js';", 'const getFirestoreDb = () => ({});')
  .replace('let fs = null;', 'let fs = globalThis.mockSdk;')
  .replace('export const StoreAPI =', 'globalThis.StoreAPI =');

function store(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  let timestamp = 0;
  const snapshot = path => ({
    id: path.split('/').at(-1), exists: () => docs.has(path),
    data: () => docs.has(path) ? structuredClone(docs.get(path)) : undefined,
  });
  const sdk = {
    doc: (_db, collection, id) => `${collection}/${id}`,
    serverTimestamp: () => `server-time-${++timestamp}`,
    getDoc: async path => snapshot(path),
    runTransaction: async (_db, callback) => {
      const writes = [];
      let writing = false;
      const tx = {
        get: async path => {
          assert.equal(writing, false, 'Firestore exige todas las lecturas antes de escribir');
          return snapshot(path);
        },
        set: (path, data, options) => { writing = true; writes.push(['set', path, data, options]); },
        update: (path, data) => { writing = true; writes.push(['update', path, data]); },
        delete: path => { writing = true; writes.push(['delete', path]); },
      };
      await callback(tx);
      for (const [type, path, data, options] of writes) {
        if (type === 'delete') docs.delete(path);
        else docs.set(path, structuredClone(type === 'update' || options?.merge
          ? { ...(docs.get(path) || {}), ...data } : data));
      }
    },
  };
  const context = vm.createContext({ mockSdk: sdk, console });
  vm.runInContext(source, context, { filename: 'firebase-store.js' });
  return {
    api: context.StoreAPI,
    read: path => docs.get(path),
    stock: id => docs.get(`inventory/${id}`)?.stock,
    moves: () => [...docs].filter(([path]) => path.startsWith('inventoryMoves/')).map(([, data]) => data),
    sales: () => [...docs].filter(([path]) => path.startsWith('sales/')).map(([, data]) => data),
  };
}

const lines = [{ product_id: 'piano', qty: 2, unit_price: 100 }];
const inventory = { 'inventory/piano': { product_id: 'piano', stock: 10, location: 'Sala' } };
const sale = (status, extra = {}) => ({
  id: 'old', items: lines, total_cop: 200, paid_cop: 0, balance_cop: 200,
  payments: [], status, posted: false, payment_method: 'cash', ...extra,
});

test('venta pagada: consolida líneas repetidas para stock y conserva precios por línea', async () => {
  const st = store(inventory);
  const items = [{ product_id: 'piano', qty: 2, unit_price: 100 }, { product_id: 'piano', qty: 3, unit_price: 90 }];
  const result = await st.api.createSale({ sale: { status: 'paid' }, items });
  assert.equal(st.stock('piano'), 5);
  assert.equal(st.moves().length, 1);
  assert.equal(st.moves()[0].qty, -5);
  assert.equal(st.read(`sales/${result.id}`).total_cop, 470);
  assert.equal(st.read(`sales/${result.id}`).items.length, 2);
  assert.equal(st.read(`sales/${result.id}`).posted, true);
});

test('stock insuficiente al sumar duplicados no guarda venta, cobro ni movimientos', async () => {
  const st = store({ 'inventory/piano': { stock: 4 } });
  await assert.rejects(st.api.createSale({ sale: { status: 'paid' }, items: [...lines, ...lines, ...lines] }), /Stock insuficiente/);
  assert.equal(st.stock('piano'), 4);
  assert.equal(st.sales().length, 0);
  assert.equal(st.moves().length, 0);
});

test('carrito con varios productos cumple lecturas antes de escrituras', async () => {
  const st = store({ ...inventory, 'inventory/pincel': { stock: 4 } });
  await st.api.createSale({ sale: { status: 'installments', initial_payment_cop: 10 }, items: [...lines, { product_id: 'pincel', qty: 1, unit_price: 30 }] });
  assert.equal(st.stock('piano'), 8);
  assert.equal(st.stock('pincel'), 3);
  assert.equal(st.sales()[0].posted, true);
});

test('pedido pendiente recibe primer abono y descuenta inventario una sola vez', async () => {
  const st = store({ ...inventory, 'sales/old': sale('pending') });
  await st.api.addPayment('old', 50, 'transfer', 'Anticipo', 'asesor@example.com');
  assert.equal(st.stock('piano'), 8);
  assert.equal(st.read('sales/old').status, 'installments');
  assert.equal(st.read('sales/old').posted, true);
  assert.equal(st.read('sales/old').updated_by, 'asesor@example.com');
  await st.api.addPayment('old', 150);
  assert.equal(st.stock('piano'), 8);
  assert.equal(st.moves().length, 1);
  assert.equal(st.read('sales/old').paid_cop, 200);
  assert.equal(st.read('sales/old').balance_cop, 0);
});

test('abonar pedido sin stock no registra dinero ni cambia su estado', async () => {
  const st = store({ 'inventory/piano': { stock: 1 }, 'sales/old': sale('pending') });
  await assert.rejects(st.api.addPayment('old', 50), /Stock insuficiente/);
  assert.equal(st.stock('piano'), 1);
  assert.equal(st.read('sales/old').status, 'pending');
  assert.equal(st.read('sales/old').payments.length, 0);
});

test('pagar cuotas antiguas con posted:false no descuenta inventario otra vez', async () => {
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': sale('installments', {
    paid_cop: 50, balance_cop: 150, payments: [{ amount_cop: 50 }],
  }) });
  await st.api.updateSaleStatus('old', 'paid', 'admin@example.com');
  await st.api.updateSaleStatus('old', 'paid');
  assert.equal(st.stock('piano'), 8);
  assert.equal(st.moves().length, 0);
  assert.equal(st.read('sales/old').payments.length, 2);
  assert.equal(st.read('sales/old').posted, true);
});

test('cancelar devuelve stock una vez y conservar/eliminar registro no vuelve a devolver', async () => {
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': sale('installments') });
  await st.api.updateSaleStatus('old', 'cancelled');
  await st.api.updateSaleStatus('old', 'cancelled');
  assert.equal(st.stock('piano'), 10);
  assert.equal(st.moves().length, 1);
  assert.equal(st.read('sales/old').posted, false);
  await st.api.deleteSale('old');
  assert.equal(st.stock('piano'), 10);
  assert.equal(st.read('sales/old'), undefined);
});

test('cancelada no admite añadir, editar o eliminar abonos', async () => {
  const st = store({ ...inventory, 'sales/old': sale('cancelled', { payments: [{ amount_cop: 50 }], paid_cop: 50 }) });
  await assert.rejects(st.api.addPayment('old', 50), /cancelada/);
  await assert.rejects(st.api.updatePayment('old', 0, { amount: 40 }), /cancelada/);
  await assert.rejects(st.api.deletePayment('old', 0), /cancelada/);
  assert.equal(st.stock('piano'), 10);
  assert.equal(st.read('sales/old').payments[0].amount_cop, 50);
});

test('reactivar una venta cancelada vuelve a descontar y al eliminar restituye', async () => {
  const st = store({ ...inventory, 'sales/old': sale('cancelled') });
  await st.api.updateSaleStatus('old', 'paid');
  assert.equal(st.stock('piano'), 8);
  await st.api.deleteSale('old');
  assert.equal(st.stock('piano'), 10);
});

test('editar y quitar el único pago cambia saldo sin alterar stock; volver a pagar tampoco', async () => {
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': sale('paid', {
    posted: true, paid_cop: 200, balance_cop: 0, payments: [{ amount_cop: 200 }],
  }) });
  await st.api.updatePayment('old', 0, { amount: 100, updatedBy: 'admin@example.com' });
  assert.equal(st.read('sales/old').balance_cop, 100);
  assert.equal(st.read('sales/old').posted, true);
  await st.api.deletePayment('old', 0);
  assert.equal(st.read('sales/old').paid_cop, 0);
  assert.equal(st.read('sales/old').balance_cop, 200);
  assert.equal(st.stock('piano'), 8);
  await st.api.updateSaleStatus('old', 'paid');
  assert.equal(st.stock('piano'), 8);
  assert.equal(st.read('sales/old').payments.length, 1);
});

test('eliminar una venta histórica pagada sin posted restituye stock', async () => {
  const historical = sale('paid');
  delete historical.posted;
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': historical });
  await st.api.deleteSale('old');
  assert.equal(st.stock('piano'), 10);
});

test('eliminar venta con líneas repetidas devuelve la suma de las unidades', async () => {
  const st = store({ 'inventory/piano': { stock: 6 }, 'sales/old': sale('paid', { posted: true, items: [...lines, ...lines] }) });
  await st.api.deleteSale('old');
  assert.equal(st.stock('piano'), 10);
  assert.equal(st.moves().length, 1);
  assert.equal(st.moves()[0].qty, 4);
});

test('abonos y estados inválidos se rechazan antes de escribir', async () => {
  const st = store({ ...inventory, 'sales/old': sale('pending') });
  await assert.rejects(st.api.addPayment('old', 201), /supera el saldo/);
  await assert.rejects(st.api.addPayment('old', 0), /abono válido/);
  await assert.rejects(st.api.updateSaleStatus('old', 'oops'), /Estado de venta inválido/);
  await assert.rejects(st.api.createSale({ sale: { status: 'installments', initial_payment_cop: 201 }, items: lines }), /abono inicial/);
  await assert.rejects(st.api.createSale({ sale: { status: 'paid' }, items: [{ ...lines[0], unit_price: -5 }] }), /precio de venta/);
  await assert.rejects(st.api.createSale({ sale: { status: 'paid' }, items: [{ ...lines[0], qty: 0 }] }), /cantidad inválidos/);
  await assert.rejects(st.api.createSale({ sale: { status: 'paid' }, items: [{ ...lines[0], unit_price: 'abc' }] }), /precio de venta/);
  assert.equal(st.stock('piano'), 10);
  assert.equal(st.moves().length, 0);
});

test('pagos antiguos sin detalle se conservan al añadir un abono', async () => {
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': sale('installments', { paid_cop: 50, balance_cop: 150 }) });
  await st.api.addPayment('old', 25);
  assert.equal(st.read('sales/old').paid_cop, 75);
  assert.equal(st.read('sales/old').payments.length, 2);
  assert.equal(st.stock('piano'), 8);
});

test('no se convierte en pending una venta que ya tiene dinero registrado', async () => {
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': sale('paid', { paid_cop: 200, payments: [{ amount_cop: 200 }] }) });
  await assert.rejects(st.api.updateSaleStatus('old', 'pending'), /con abonos/);
  assert.equal(st.stock('piano'), 8);
});

test('alias históricos en español conservan la señal de stock descontado', async () => {
  const historical = sale('pagado', { paid_cop: 200 });
  delete historical.posted;
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': historical });
  await st.api.updateSaleStatus('old', 'cancelado');
  assert.equal(st.stock('piano'), 10);
  assert.equal(st.read('sales/old').status, 'cancelled');
});

test('edición de abono rechaza montos no positivos e índices incompletos', async () => {
  const st = store({ 'inventory/piano': { stock: 8 }, 'sales/old': sale('installments', { payments: [{ amount_cop: 50 }] }) });
  await assert.rejects(st.api.updatePayment('old', 0, { amount: -10 }), /abono válido/);
  await assert.rejects(st.api.updatePayment('old', undefined, { amount: 40 }), /Abono no encontrado/);
  await assert.rejects(st.api.deletePayment('old', 0.4), /Abono no encontrado/);
  assert.equal(st.read('sales/old').payments[0].amount_cop, 50);
  assert.equal(st.stock('piano'), 8);
});

test('reabrir y confirmar actualiza el mismo pedido y conserva autor/fecha', async () => {
  const st = store({ ...inventory, 'sales/old': sale('pending', { created_by: 'original@example.com', created_at: 'original-date' }) });
  const result = await st.api.savePendingSale('old', { sale: { status: 'paid', created_by: 'editor@example.com', customer_phone: '3001234567', lead_id: 'lead-1' }, items: [{ ...lines[0], qty: 3 }] });
  assert.equal(result.id, 'old');
  assert.equal(st.sales().length, 1);
  assert.equal(st.stock('piano'), 7);
  assert.equal(st.read('sales/old').created_by, 'original@example.com');
  assert.equal(st.read('sales/old').updated_by, 'editor@example.com');
  assert.equal(st.read('sales/old').customer_phone, '3001234567');
  assert.equal(st.read('sales/old').lead_id, 'lead-1');
  assert.equal(st.read('sales/old').created_at, 'original-date');
  await assert.rejects(st.api.savePendingSale('old', { sale: { status: 'paid' }, items: lines }), /cambió de estado/);
  assert.equal(st.stock('piano'), 7);
});

test('guardar una propuesta no descuenta y confirmación sin stock es atómica', async () => {
  const st = store({ 'inventory/piano': { stock: 1 }, 'sales/old': sale('pending') });
  await st.api.savePendingSale('old', { sale: { status: 'pending' }, items: lines });
  assert.equal(st.stock('piano'), 1);
  await assert.rejects(st.api.savePendingSale('old', { sale: { status: 'paid' }, items: lines }), /Stock insuficiente/);
  assert.equal(st.read('sales/old').status, 'pending');
  assert.equal(st.stock('piano'), 1);
  assert.equal(st.moves().length, 0);
});

test('conteo físico usa existencias actuales y registra la diferencia real', async () => {
  const st = store({ 'inventory/piano': { stock: 7, location: 'Sala', min_stock: 1 } });
  const result = await st.api.adjustStock({ product_id: 'piano', qty: -1, target_stock: 9, updated_by: 'asesor@example.com' });
  assert.equal(result.stock, 9);
  assert.equal(st.moves()[0].qty, 2);
  assert.equal(st.read('inventory/piano').location, 'Sala');
  await st.api.adjustStock({ product_id: 'piano', target_stock: 9 });
  assert.equal(st.moves().length, 1);
  await assert.rejects(st.api.adjustStock({ product_id: 'piano', target_stock: -1 }), /entero/);
  assert.equal(st.stock('piano'), 9);
});
