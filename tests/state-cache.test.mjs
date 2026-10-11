import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../js/state.js', import.meta.url), 'utf8').replace('export const State =', 'globalThis.State =');
const key = 'store_manager_state_v5';
function session(seed) {
  const cache = new Map(seed ? [[key, JSON.stringify(seed)]] : []);
  const context = vm.createContext({
    console, setTimeout, clearTimeout, structuredClone,
    window: { addEventListener() {} }, document: { addEventListener() {} },
    localStorage: { getItem: k => cache.get(k) || null, setItem: (k, v) => cache.set(k, v), removeItem: k => cache.delete(k) },
  });
  vm.runInContext(source, context);
  return { state: context.State, cached: () => JSON.parse(cache.get(key)) };
}
test('costos no se persisten; borrador de reposición mantiene cantidades y costo en RAM', () => {
  const { state, cached } = session();
  state.setProducts([{ id: 'piano', name: 'Piano', price_cop: 145, cost_cop: 100, margin_pct: 45 }]);
  state.restockAddProduct({ id: 'piano', name: 'Piano', cost_cop: 100 }, 2);
  state._flushCacheNow();
  assert.equal(state.getRestock().items[0].cost_cop, 100);
  assert.equal(cached().data.restock.items[0].qty, 2);
  assert.equal(cached().data.products[0].price_cop, 145);
  assert.equal(cached().data.products[0].cost_cop, undefined);
  assert.equal(cached().data.products[0].margin_pct, undefined);
  assert.equal(cached().data.restock.items[0].cost_cop, undefined);
});
test('caché histórico se limpia al restaurar y nunca restaura token', () => {
  const { state } = session({ v: 5, savedAt: Date.now(), ttlMs: 21600000, data: {
    idToken: 'old-secret', products: [{ id: 'piano', name: 'Piano', costo: 100, precioCompetencia: 150 }],
    restock: { supplier: 'Proveedor', items: [{ id: 'piano', name: 'Piano', qty: 3, unit_cost: 100 }] },
  } });
  assert.equal(state.hydrateFromCache(), true);
  assert.equal(state.get().idToken, '');
  assert.equal(state.get().products[0].costo, undefined);
  assert.equal(state.get().products[0].precioCompetencia, undefined);
  assert.equal(state.getRestock().items[0].qty, 3);
  assert.equal(state.getRestock().items[0].cost_cop, 0);
  state._flushCacheNow();
});
