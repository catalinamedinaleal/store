'use strict';

import { StoreAPI } from '../api.js';
import { State } from '../state.js';

export async function loadCatalog(force = false) {
  const has = Array.isArray(State.get().products) && State.get().products.length > 0;
  if (!force && has) return State.get().products;
  const res = await StoreAPI.listProducts('');
  State.setProducts(Array.isArray(res?.items) ? res.items : []);
  return State.get().products;
}

export function getCatalogProducts() {
  return State.get().products || [];
}
