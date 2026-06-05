'use strict';

export const BUILD_VERSION = '2026-05-17.4';

const API_BASE_RAW = 'https://script.google.com/macros/s/AKfycbzIBInWsnCEiCToJLQdnlHFhrzCpxWszBrTte_cN8pSYiSMxj4w0356AOCGc4r-k1VNgg/exec';

export const API_BASE = String(API_BASE_RAW || '').trim().replace(/\/+$/, '');
export const CURRENCY = 'COP';
export const LOCALE = 'es-CO';
export const API_TIMEOUT_MS = 25000;
export const API_FORCE_POST = true;
export const API_COALESCE = true;
export const API_JSONP_FALLBACK = false;
export const RESTOCK_PDF_HIDE_PRICES = true;

export const ALLOWED_EMAILS = new Set([
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com',
  'musicalaasesor@gmail.com',
]);

export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyBm8RWGMxw9uz4iMmr0Chf3uiLzMY7TzOE',
  authDomain: 'store2026-77c54.firebaseapp.com',
  projectId: 'store2026-77c54',
  storageBucket: 'store2026-77c54.firebasestorage.app',
  messagingSenderId: '190041780965',
  appId: '1:190041780965:web:a594ed82ca71f826f3da0c',
});

export const STORE_CFG = Object.freeze({
  API_BASE,
  CURRENCY,
  LOCALE,
  BUILD: BUILD_VERSION,
  API_TIMEOUT_MS,
  API_FORCE_POST,
  API_COALESCE,
  API_JSONP_FALLBACK,
  RESTOCK_PDF_HIDE_PRICES,
});

globalThis.__BUILD__ = BUILD_VERSION;
globalThis.STORE_CFG = STORE_CFG;
