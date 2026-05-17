'use strict';

import { CURRENCY, LOCALE } from '../config.js';

export function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v).replace(/[^\d\-]/g, '').trim();
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

export function toFloat(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, '.').replace(/[^\d.\-]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function fmtCOP(n) {
  const v = Number.isFinite(n) ? n : toInt(n);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: CURRENCY,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return '$' + String(Math.round(v));
  }
}

export function safeStr(v, max = 4000) {
  const s = String(v ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function formatDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v || '');
  return d.toLocaleString(LOCALE);
}

export function nowLocalStamp() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
