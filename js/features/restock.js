'use strict';

import { State } from '../state.js';

export function addProductToRestock(product, qty = 1) {
  return State.restockAddProduct(product, qty);
}

export function clearRestock(keepMeta = true) {
  State.restockClear(keepMeta);
}

export function getRestock() {
  return State.getRestock();
}
