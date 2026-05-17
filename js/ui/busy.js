'use strict';

export function setBusy(message = 'Procesando…') {
  document.body.dataset.busy = 'true';
  document.body.dataset.busyLabel = String(message || 'Procesando…');
}

export function clearBusy() {
  delete document.body.dataset.busy;
  delete document.body.dataset.busyLabel;
}

export async function withBusy(label, fn) {
  setBusy(label);
  try {
    return await fn();
  } finally {
    clearBusy();
  }
}
