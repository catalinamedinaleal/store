'use strict';

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
export const on = (node, ev, fn, opts) => node && node.addEventListener(ev, fn, opts);

export function delegate(root, ev, selector, handler, opts) {
  if (!root || !selector || typeof handler !== 'function') return () => {};
  const listener = (event) => {
    const target = event.target;
    const hit = target && target.closest ? target.closest(selector) : null;
    if (!hit || !root.contains(hit)) return;
    handler(event, hit);
  };
  root.addEventListener(ev, listener, opts);
  return () => root.removeEventListener(ev, listener, opts);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function cssEscape(s) {
  const str = String(s ?? '');
  try {
    if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(str);
  } catch {}
  return str.replace(/["\\]/g, '\\$&').replace(/\s/g, '\\ ');
}

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
