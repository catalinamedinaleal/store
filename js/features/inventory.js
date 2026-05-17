'use strict';

import { StoreAPI } from '../api.js';
import { State } from '../state.js';
import { buildProductOptionLabel, inventoryByProductId, resolveProductIdFromQuery } from '../utils/product.js';
import { toInt } from '../utils/format.js';

export async function loadInventoryWithProducts() {
  const [productsRes, inventoryRes] = await Promise.all([
    StoreAPI.listProducts(''),
    StoreAPI.listInventory(),
  ]);
  State.setProducts(Array.isArray(productsRes?.items) ? productsRes.items : []);
  State.setInventory(Array.isArray(inventoryRes?.items) ? inventoryRes.items : []);
  return { products: State.get().products, inventory: State.get().inventory };
}

export function buildInventoryOptions(products, inventory) {
  const inventoryIds = new Set((inventory || []).map(r => String(r?.product_id || '').trim()).filter(Boolean));
  return (products || [])
    .filter(p => p && String(p.id || '').trim() && (p.active !== false || inventoryIds.has(String(p.id || '').trim())))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
    .map(buildProductOptionLabel);
}

export function resolveInventoryProduct(raw) {
  const st = State.get();
  return resolveProductIdFromQuery(raw, st.products || [], st.inventory || []);
}

export function calculateStockDelta(productId, targetStock) {
  const inv = inventoryByProductId(State.get().inventory || [], productId);
  return toInt(targetStock) - toInt(inv?.stock);
}

export async function updateInventoryMeta({ product_id, min_stock, location }) {
  return StoreAPI.updateInventoryMeta({ product_id, min_stock, location });
}
