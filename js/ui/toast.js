'use strict';

import { $ } from '../utils/dom.js';

let timer = 0;

export function toast(message, type = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = String(message || '');
  const bad = type === false || type === 'bad' || type === 'error';
  el.classList.toggle('is-bad', bad);
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, 2600);
}

export function clearToast() {
  const el = $('toast');
  if (el) el.hidden = true;
  clearTimeout(timer);
}
