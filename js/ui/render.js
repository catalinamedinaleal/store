'use strict';

import { escapeHtml } from '../utils/dom.js';

export function emptyRow(colspan, message = 'No hay resultados.') {
  return `<tr><td colspan="${Number(colspan) || 1}" class="muted">${escapeHtml(message)}</td></tr>`;
}

export function badge(text, kind = '') {
  const cls = ['badge', kind ? `badge--${kind}` : ''].filter(Boolean).join(' ');
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

export function stockBadge(stock, minStock) {
  return Number(minStock) > 0 && Number(stock) <= Number(minStock) ? badge('Bajo', 'warn') : '';
}

export function productCell({ title, meta, id }) {
  return `
    <div class="productCell">
      <div class="productCell__title">${escapeHtml(title || '')}</div>
      ${meta ? `<div class="productCell__meta">${escapeHtml(meta)}</div>` : ''}
      ${id ? `<div class="productCell__id">ID interno: ${escapeHtml(id)}</div>` : ''}
    </div>
  `;
}

export function actionButtons(buttons = []) {
  return buttons.filter(Boolean).join('');
}
