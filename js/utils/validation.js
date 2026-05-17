'use strict';

import { toInt, safeStr } from './format.js';

export function requireText(value, label = 'Campo') {
  const v = safeStr(value);
  if (!v) throw new Error(`${label} es requerido`);
  return v;
}

export function requireNumber(value, label = 'Número') {
  const n = toInt(value);
  if (!Number.isFinite(n)) throw new Error(`${label} inválido`);
  return n;
}

export function validateProduct(product = {}) {
  requireText(product.name, 'Nombre');
  return true;
}

export function validateStockAdjustment({ product_id, qty }) {
  requireText(product_id, 'Producto');
  if (!toInt(qty)) throw new Error('Cantidad inválida');
  return true;
}

export function validateSaleItems(items = []) {
  if (!Array.isArray(items) || !items.length) throw new Error('Agrega al menos un producto');
  items.forEach((it) => {
    requireText(it.product_id, 'Producto');
    if (toInt(it.qty) <= 0) throw new Error('Cantidad inválida');
  });
  return true;
}
