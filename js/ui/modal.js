'use strict';

import { $, $$, on } from '../utils/dom.js';

function resolveDialog(idOrElement) {
  if (!idOrElement) return null;
  return typeof idOrElement === 'string' ? $(idOrElement) : idOrElement;
}

export function openDialog(idOrElement) {
  const dlg = resolveDialog(idOrElement);
  if (!dlg) return;
  try {
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg.setAttribute('open', '');
  } catch {
    try { dlg.setAttribute('open', ''); } catch {}
  }
}

export function closeDialog(idOrElement) {
  const dlg = resolveDialog(idOrElement);
  if (!dlg) return;
  try {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  } catch {}
}

export function closeAllDialogs() {
  $$('dialog[open]').forEach(closeDialog);
}

export function initModalCloseButtons() {
  $$('[data-close-dialog]').forEach((btn) => {
    on(btn, 'click', () => closeDialog(btn.getAttribute('data-close-dialog')));
  });
}
