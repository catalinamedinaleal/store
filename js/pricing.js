'use strict';

/* =============================================================================
  Musicala Store · pricing.js
  ------------------------------------------------
  Regla automática de precio de venta a partir del costo del proveedor.

  Modelo: % de ganancia POR RANGOS DE COSTO.
    costo hasta X   -> +A%
    X+1 .. Y        -> +B%
    más de Y        -> +C%

  ⚠ Los porcentajes REALES no viven en este archivo a propósito.
    Este repositorio es público: dejarlos aquí los volvería visibles para
    cualquiera, incluido el equipo al que se le ocultan los márgenes en la app.
    La regla real se guarda en Firestore (settings/pricing), que solo el admin
    puede escribir y que no es legible desde el código publicado.

    Mientras no exista esa regla, `configured` es false y la app NO sugiere
    precio: avisa que falta configurarla (mejor eso que vender al costo por
    culpa de un valor por defecto inventado).

  Precio = costo * (1 + margen/100), redondeado según round_to / round_mode.
============================================================================= */

export const DEFAULT_PRICING = Object.freeze({
  version: 1,
  tiers: Object.freeze([]),   // vacío = sin configurar
  round_to: 1000,             // múltiplo al que se redondea el precio final
  round_mode: 'up',           // 'up' | 'nearest' | 'none'
  updated_at: '',
  updated_by: '',
});

/* =========================
   Helpers numéricos
========================= */
const toInt_ = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v).replace(/[^\d\-]/g, '').trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
};

const toFloat_ = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, '.').replace(/[^\d.\-]/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/* =========================
   Normalización de la regla
========================= */
export function normalizePricing(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};

  let tiers = Array.isArray(src.tiers) ? src.tiers : [];
  tiers = tiers
    .map(t => ({
      max: Math.max(0, toInt_(t?.max)),
      margin_pct: Math.max(0, toFloat_(t?.margin_pct)),
    }))
    .filter(t => t.margin_pct > 0 || t.max > 0);

  const roundTo = Math.max(0, toInt_(src.round_to ?? DEFAULT_PRICING.round_to));
  const mode = ['up', 'nearest', 'none'].includes(String(src.round_mode || '').trim())
    ? String(src.round_mode).trim()
    : DEFAULT_PRICING.round_mode;

  const base = {
    version: Math.max(1, toInt_(src.version) || 1),
    round_to: roundTo,
    round_mode: roundTo > 0 ? mode : 'none',
    updated_at: String(src.updated_at || ''),
    updated_by: String(src.updated_by || ''),
  };

  // Sin rangos = regla sin configurar. No inventamos porcentajes.
  if (!tiers.length) return { ...base, tiers: [], configured: false };

  // Los tramos con tope van primero y en orden ascendente; el abierto (max=0) al final.
  const capped = tiers.filter(t => t.max > 0).sort((a, b) => a.max - b.max);
  const open = tiers.filter(t => t.max <= 0);

  const lastOpen = open.length
    ? { max: 0, margin_pct: open[open.length - 1].margin_pct }
    : { max: 0, margin_pct: capped[capped.length - 1].margin_pct };

  return { ...base, tiers: capped.concat([lastOpen]), configured: true };
}

export function isPricingConfigured(settings) {
  return normalizePricing(settings).configured === true;
}

/* =========================
   Cálculo
========================= */
export function tierForCost(cost, settings) {
  const s = normalizePricing(settings);
  const c = Math.max(0, toInt_(cost));
  const tiers = s.tiers;

  if (!tiers.length) return { index: -1, margin_pct: 0, tier: null, label: '' };

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.max <= 0 || c <= t.max) {
      return { index: i, margin_pct: t.margin_pct, tier: t, label: tierLabel(tiers, i) };
    }
  }

  const last = tiers[tiers.length - 1];
  return { index: tiers.length - 1, margin_pct: last.margin_pct, tier: last, label: tierLabel(tiers, tiers.length - 1) };
}

export function applyRounding(value, settings) {
  const s = normalizePricing(settings);
  const v = Math.max(0, Math.round(toFloat_(value)));
  const step = Math.max(0, toInt_(s.round_to));

  if (!step || s.round_mode === 'none') return v;
  if (!v) return 0;

  if (s.round_mode === 'nearest') return Math.round(v / step) * step;
  return Math.ceil(v / step) * step; // 'up'
}

/**
 * priceFromCost: el corazón del asunto.
 * La asesora escribe el costo del proveedor y esto devuelve el precio al público.
 */
export function priceFromCost(cost, settings) {
  const s = normalizePricing(settings);
  const c = Math.max(0, toInt_(cost));

  const empty = { price_cop: 0, margin_pct: 0, raw_price: 0, tier_label: '', tier_index: -1, configured: s.configured };
  if (!c) return empty;

  // Sin regla configurada no adivinamos un precio.
  if (!s.configured) return empty;

  const t = tierForCost(c, s);
  const raw = c * (1 + (t.margin_pct / 100));
  const price = applyRounding(raw, settings);

  return {
    price_cop: Math.max(c, price), // nunca por debajo del costo
    margin_pct: t.margin_pct,
    raw_price: Math.round(raw),
    tier_label: t.label,
    tier_index: t.index,
    configured: true,
  };
}

export function marginFromCostPrice(cost, price) {
  const c = Math.max(0, toInt_(cost));
  const p = Math.max(0, toInt_(price));
  if (!c) return 0;
  return Math.max(0, Math.round((((p / c) - 1) * 100) * 10) / 10);
}

export function profitOf(cost, price) {
  return Math.max(0, toInt_(price) - toInt_(cost));
}

/* =========================
   Etiquetas para la UI (admin)
========================= */
const fmt_ = (n) => {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(toInt_(n));
  } catch {
    return '$' + String(toInt_(n));
  }
};

export function tierLabel(tiers, index) {
  const list = Array.isArray(tiers) ? tiers : [];
  const t = list[index];
  if (!t) return '';

  const prev = index > 0 ? list[index - 1] : null;
  const from = prev && prev.max > 0 ? prev.max + 1 : 0;

  if (t.max <= 0) return `Más de ${fmt_(from ? from - 1 : 0)}`;
  if (!from) return `Hasta ${fmt_(t.max)}`;
  return `${fmt_(from)} – ${fmt_(t.max)}`;
}

export function describeTiers(settings) {
  const s = normalizePricing(settings);
  return s.tiers.map((t, i) => ({
    ...t,
    label: tierLabel(s.tiers, i),
  }));
}

/**
 * tierWarnings: avisa saltos raros en las fronteras de rango.
 * Con % por rangos puede pasar que un producto MÁS caro se venda MÁS barato
 * (ej: costo 50.000 → 85.000, pero costo 50.001 → 73.000). No es un error del
 * cálculo, es cómo funciona cobrar distinto % por tramo, pero conviene verlo.
 */
export function tierWarnings(settings) {
  const s = normalizePricing(settings);
  const out = [];

  for (let i = 0; i < s.tiers.length - 1; i++) {
    const edge = s.tiers[i].max;
    if (edge <= 0) continue;

    const below = priceFromCost(edge, s);
    const above = priceFromCost(edge + 1, s);
    if (above.price_cop < below.price_cop) {
      out.push({
        at: edge,
        below: below.price_cop,
        above: above.price_cop,
        message: `En ${fmt_(edge)} el precio salta hacia abajo: costo ${fmt_(edge)} → ${fmt_(below.price_cop)}, pero costo ${fmt_(edge + 1)} → ${fmt_(above.price_cop)}.`,
      });
    }
  }

  return out;
}

export function describeRounding(settings) {
  const s = normalizePricing(settings);
  if (!s.round_to || s.round_mode === 'none') return 'Sin redondeo';
  const word = s.round_mode === 'nearest' ? 'al más cercano' : 'hacia arriba';
  return `Redondeo ${word} a múltiplos de ${fmt_(s.round_to)}`;
}
