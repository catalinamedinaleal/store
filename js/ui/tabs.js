'use strict';

import { $$ } from '../utils/dom.js';
import { State } from '../state.js';

export const TAB_IDS = ['catalog', 'inventory', 'sales', 'moves', 'dashboard', 'restock'];

export function getCurrentTab() {
  const tab = String(State.get().tab || '').trim();
  return TAB_IDS.includes(tab) ? tab : 'catalog';
}

export function showTab(tabName) {
  const next = TAB_IDS.includes(tabName) ? tabName : 'catalog';
  State.setTab(next);
  $$('.tab').forEach((btn) => {
    const on = btn.dataset.tab === next;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  TAB_IDS.forEach((name) => {
    const section = document.getElementById(`tab-${name}`);
    if (section) section.hidden = name !== next;
  });
}

export function initTabs(onChange) {
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
      if (typeof onChange === 'function') onChange(getCurrentTab());
    });
  });
}
