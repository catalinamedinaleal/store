'use strict';

import { toInt } from './format.js';

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
}

export function genProductId({ name, category } = {}) {
  const base = slug(name) || slug(category) || 'prod';
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `${base}-${stamp}${rand}`;
}

export function pickPriceCOP(p) {
  return toInt(p?.price_cop ?? p?.price ?? p?.precio_cop ?? p?.precio);
}

export function pickCostCOP(p) {
  return toInt(p?.cost_cop ?? p?.cost ?? p?.costo_cop ?? p?.costo);
}

export function pickCompetitorCOP(p) {
  return toInt(
    p?.competitor_price_cop ??
    p?.competitor_price ??
    p?.precio_competencia ??
    p?.precio_competencia_cop ??
    p?.precioCompetencia ??
    p?.precioCompetenciaCOP
  );
}

export function buildProductOptionLabel(p) {
  const id = String(p?.id || '').trim();
  const name = String(p?.name || '').trim() || id;
  const brand = String(p?.brand || '').trim();
  const sku = String(p?.sku || '').trim();
  const meta = [brand, sku ? `SKU: ${sku}` : ''].filter(Boolean).join(' · ');
  return `${name}${meta ? ' — ' + meta : ''} (${id})`;
}

export function inventoryByProductId(inventory, productId) {
  const pid = String(productId || '').trim();
  return (Array.isArray(inventory) ? inventory : [])
    .find(r => String(r?.product_id || '').trim() === pid) || null;
}

export function productSearchText(p, inv = null) {
  return [
    p?.id,
    p?.name,
    p?.brand,
    p?.category,
    p?.sku,
    inv?.location,
    inv?.stock,
    inv?.min_stock,
  ].map(x => String(x || '').toLowerCase()).join(' ');
}

export function resolveProductIdFromQuery(raw, products = [], inventory = []) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const needle = s.toLowerCase();
  const m = s.match(/\(([^)]+)\)\s*$/);
  if (m && m[1]) return String(m[1]).trim();
  const exact = products.find(p => String(p?.id || '').trim().toLowerCase() === needle);
  if (exact) return String(exact.id || '').trim();
  const invExact = inventory.find(r => String(r?.product_id || '').trim().toLowerCase() === needle);
  if (invExact) return String(invExact.product_id || '').trim();
  const sku = products.find(p => String(p?.sku || '').trim().toLowerCase() === needle);
  if (sku) return String(sku.id || '').trim();
  const name = products.find(p => String(p?.name || '').trim().toLowerCase() === needle);
  if (name) return String(name.id || '').trim();
  const partial = products.find(p => productSearchText(p).includes(needle));
  return partial ? String(partial.id || '').trim() : '';
}
