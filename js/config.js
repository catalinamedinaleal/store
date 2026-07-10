'use strict';

export const BUILD_VERSION = '2026-07-10.2';

export const CURRENCY = 'COP';
export const LOCALE = 'es-CO';
export const RESTOCK_PDF_HIDE_PRICES = true;

export const ALLOWED_EMAILS = new Set([
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com',
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
  CURRENCY,
  LOCALE,
  BUILD: BUILD_VERSION,
  RESTOCK_PDF_HIDE_PRICES,
});

globalThis.__BUILD__ = BUILD_VERSION;
globalThis.STORE_CFG = STORE_CFG;
