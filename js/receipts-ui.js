import { buildReceiptSnapshot, normalizeReceiptIssuer, receiptSaleSignature, receiptText, createReceiptPdf, RECEIPT_NOTICE } from './receipts.js';

export function initReceipts({ api, roles, showTab, toast }) {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cop = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  const inputIssuer = () => Object.fromEntries(['name', 'document', 'address', 'phone', 'brand'].map(key => [key, $('issuer_' + key).value]));
  let sales = [], issuer = null, selected = null, preview = null, loading = null, generation = 0, issuing = false;
  const notice = (message, error = false) => { $('receiptsStatus').textContent = message; $('receiptsStatus').classList.toggle('receiptError', error); };
  function render() {
    if (!roles.isStaff()) return;
    $('receiptIssuerForm').hidden = !roles.isAdmin();
    $('receiptIssuerSummary').textContent = issuer ? `Vendedora: ${issuer.name} · CC. ${issuer.document} · ${issuer.address} · Tel. ${issuer.phone}` : 'Emisor sin configurar. Un administrador debe registrar los datos de la vendedora antes de emitir.';
    const q = $('receiptsSearch').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const filter = $('receiptsFilter').value;
    const rows = sales.filter(s => (['paid', 'pagado', 'installments'].includes(s.status) || s.receipt)
      && (!q || [s.customer_id, s.customer_phone, s.id, s.receipt?.number, s.receipt?.buyer?.name].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q))
      && (filter === 'all' || filter === 'issued' && s.receipt && !s.receipt_void || filter === 'unissued' && !s.receipt || filter === 'void' && s.receipt_void));
    $('receiptsBody').innerHTML = rows.length ? rows.map(s => `<tr>
      <td><strong>${esc(s.receipt?.number || 'Por emitir')}</strong><div class="tiny muted">${esc(s.id)}</div></td>
      <td>${esc(s.receipt?.buyer?.name || s.customer_id || 'Sin nombre de cliente')}</td>
      <td class="num">${cop(s.receipt?.total_cop ?? s.total_cop)}</td>
      <td>${s.receipt_void ? '<span class="badge badge--warn">Anulado</span>' : s.receipt ? '<span class="badge">Emitido</span>' : '<span class="tiny muted">Venta confirmada</span>'}</td>
      <td><button class="btn btn--ghost btn--tiny" type="button" data-receipt-sale="${esc(s.id)}">${s.receipt ? 'Ver / descargar' : roles.isAdmin() ? 'Preparar comprobante' : 'Ver venta'}</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">No hay comprobantes o ventas confirmadas con este filtro.</td></tr>';
  }
  async function load() {
    if (!roles.isStaff()) return;
    if (loading) return loading;
    const revision = generation;
    notice('Actualizando comprobantes…');
    loading = (async () => {
      try {
        const [settings, result] = await Promise.all([api.getReceiptSettings(), api.listSales('all', true, 500)]);
        if (revision !== generation || !roles.isStaff()) return;
        issuer = settings.issuer; sales = result.items || [];
        for (const key of ['name', 'document', 'address', 'phone', 'brand']) $('issuer_' + key).value = issuer?.[key] || (key === 'brand' ? 'Musicala Store' : '');
        notice('Últimas 500 ventas. Los comprobantes conservan los datos y valores del momento de emisión.');
        render();
      } catch (error) { if (revision === generation) notice('No pude actualizar los comprobantes. ' + error.message, true); }
    })().finally(() => { if (revision === generation) loading = null; });
    return loading;
  }
  const buyer = () => Object.fromEntries(['name', 'document', 'address', 'phone'].map(key => [key, $('receiptBuyer_' + key).value]));
  const voidInfo = () => selected?.receipt_void || (selected?.status === 'cancelled' && selected?.receipt ? { reason: 'Venta cancelada' } : null);
  function renderPreview() {
    if (!selected) return;
    const issued = !!selected.receipt;
    $('receiptBuyerFields').hidden = issued || !roles.isAdmin();
    $('btnIssueReceipt').hidden = issued || !roles.isAdmin();
    $('btnIssueReceipt').disabled = !issuer || issuing || !['paid', 'pagado', 'installments'].includes(selected.status);
    $('btnReceiptPdf').disabled = !issued;
    $('btnReceiptCopy').disabled = !issued;
    $('btnVoidReceipt').hidden = !issued || !roles.isAdmin() || !!voidInfo();
    $('receiptModalStatus').textContent = issued ? 'Documento emitido. Descargar o copiar no genera otro número. Pagos posteriores no modifican esta copia.' : 'Borrador sin validez como documento emitido. Revisa cliente y valores; emitir no registra un pago ni cambia inventario.';
    try {
      preview = selected.receipt || buildReceiptSnapshot({ sale: selected, saleId: selected.id, issuer, buyer: buyer(), products: selected.receiptProducts || [], number: 'BORRADOR SIN EMITIR', by: roles.email(), note: $('receiptNote').value });
      const r = preview;
      $('receiptPreview').innerHTML = `<div class="receiptPaper__head"><div><p class="eyebrow">${esc(r.issuer.brand)}</p><h3>Comprobante comercial</h3><strong>${esc(r.number)}</strong></div><div class="tiny">${esc(new Date(r.issued_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }))}</div></div>
        ${voidInfo() ? `<p class="receiptError"><strong>ANULADO</strong> · ${esc(voidInfo().reason)}</p>` : ''}
        <p><strong>Vendedora: ${esc(r.issuer.name)}</strong><br>CC. ${esc(r.issuer.document)}<br>${esc(r.issuer.address)}<br>Tel. ${esc(r.issuer.phone)}</p>
        <p><strong>Cliente: ${esc(r.buyer.name)}</strong>${r.buyer.document ? `<br>Identificación: ${esc(r.buyer.document)}` : ''}${r.buyer.phone ? `<br>Tel. ${esc(r.buyer.phone)}` : ''}${r.buyer.address ? `<br>${esc(r.buyer.address)}` : ''}</p>
        <div class="tablewrap"><table class="table"><thead><tr><th>Producto</th><th>Cant.</th><th>Unitario</th><th>Total</th></tr></thead><tbody>${r.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${cop(i.unit_price)}</td><td>${cop(i.subtotal)}</td></tr>`).join('')}</tbody></table></div>
        <div class="receiptTotals"><p>Total de la venta <strong>${cop(r.total_cop)}</strong></p><p>Pagado al emitir <strong>${cop(r.paid_cop)}</strong></p><p>Saldo al emitir <strong>${cop(r.balance_cop)}</strong></p></div>
        <p class="tiny muted">Valores al momento de emisión. No certifica pagos posteriores.</p>
        ${r.note ? `<p>${esc(r.note)}</p>` : ''}<p class="tiny">${esc(r.notice)}</p><p class="tiny muted">Referencia de venta: ${esc(r.sale_id)}</p>`;
    } catch (error) { preview = null; $('receiptPreview').textContent = error.message; $('btnIssueReceipt').disabled = true; }
  }
  async function openSale(id) {
    if (issuing) return;
    const revision = generation;
    try {
      const [result, settings, products] = await Promise.all([api.getSale(id, true), api.getReceiptSettings(), api.listProducts()]);
      if (revision !== generation || !roles.isStaff()) return;
      selected = { ...result.sale, id, items: result.items || result.sale.items, receiptProducts: products.items || [] };
      issuer = settings.issuer;
      for (const key of ['name', 'document', 'address', 'phone']) $('receiptBuyer_' + key).value = selected.receipt?.buyer?.[key] || (key === 'name' ? selected.customer_id : key === 'phone' ? selected.customer_phone : '') || '';
      $('receiptNote').value = '';
      renderPreview(); $('modalReceipt').showModal();
    } catch (error) { toast(error.message, false); }
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-receipt-sale]');
    if (trigger && roles.isStaff()) openSale(trigger.dataset.receiptSale);
  });
  $('btnRefreshReceipts').addEventListener('click', load);
  $('receiptsSearch').addEventListener('input', render);
  $('receiptsFilter').addEventListener('change', render);
  $('receiptIssuerForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!roles.isAdmin()) return;
    const button = $('btnSaveIssuer'); button.disabled = true;
    try { const result = await api.saveReceiptIssuer(normalizeReceiptIssuer(inputIssuer()), roles.email()); issuer = result.issuer; render(); toast('Emisor guardado y verificado.', true); }
    catch (error) { toast(error.message, false); } finally { button.disabled = false; }
  });
  $('receiptBuyerFields').addEventListener('input', renderPreview);
  $('btnIssueReceipt').addEventListener('click', async () => {
    if (!roles.isAdmin() || !selected || issuing || !preview || selected.receipt) return;
    if (!$('receiptBuyerFields').reportValidity()) return;
    if (!confirm('¿Emitir el comprobante comercial con estos datos? Se asignará un número interno y se conservará esta copia. No es una factura DIAN.')) return;
    issuing = true; renderPreview();
    const target = selected, revision = generation;
    try {
      const result = await api.issueReceipt(target.id, { buyer: buyer(), note: $('receiptNote').value, expectedSignature: receiptSaleSignature(target), by: roles.email() });
      if (revision !== generation || selected !== target) return;
      target.receipt = result.receipt;
      // Leer también la eventual anulación concurrente, sin regenerar el documento.
      const fresh = await api.getSale(target.id, true);
      if (revision !== generation || selected !== target) return;
      selected = { ...target, ...fresh.sale };
      renderPreview(); toast('Comprobante emitido y guardado.', true); await load();
    } catch (error) { toast(error.message + ' Si perdiste la conexión, vuelve a abrir la venta antes de reintentar.', false); }
    finally { if (revision === generation) { issuing = false; renderPreview(); } }
  });
  $('btnReceiptPdf').addEventListener('click', async () => {
    if (!selected?.receipt) return;
    try {
      const target = selected, revision = generation;
      const fresh = await api.getSale(target.id, true);
      if (revision !== generation || selected !== target) return;
      selected = { ...target, ...fresh.sale }; renderPreview();
      const pdf = createReceiptPdf(selected.receipt, { jsPDF: globalThis.jspdf?.jsPDF, voidInfo: voidInfo() });
      pdf.save(`${selected.receipt.number}${voidInfo() ? '-ANULADO' : ''}.pdf`);
    } catch (error) { toast('No pude verificar y descargar el comprobante: ' + error.message, false); }
  });
  $('btnReceiptCopy').addEventListener('click', async () => {
    if (!selected?.receipt) return;
    try {
      const target = selected, revision = generation;
      const fresh = await api.getSale(target.id, true);
      if (revision !== generation || selected !== target) return;
      selected = { ...target, ...fresh.sale }; renderPreview();
      await navigator.clipboard.writeText(receiptText(selected.receipt, voidInfo())); toast('Comprobante copiado.', true);
    } catch (error) { toast('No pude copiarlo. Usa Descargar PDF. ' + error.message, false); }
  });
  $('btnVoidReceipt').addEventListener('click', async () => {
    if (!roles.isAdmin() || !selected?.receipt || voidInfo()) return;
    const reason = prompt('Motivo para anular el comprobante (no cancela la venta ni devuelve dinero):');
    if (!reason?.trim()) return;
    try {
      const target = selected, revision = generation;
      await api.voidReceipt(target.id, reason, roles.email()); const fresh = await api.getSale(target.id, true);
      if (revision !== generation || selected !== target) return;
      selected = { ...target, ...fresh.sale }; renderPreview(); await load(); toast('Comprobante anulado; historial conservado.', true);
    }
    catch (error) { toast(error.message, false); }
  });
  $('receiptLegalNotice').textContent = RECEIPT_NOTICE;
  return {
    load, render, openSale,
    reset() {
      generation++; sales = []; issuer = selected = preview = loading = null; issuing = false;
      $('modalReceipt').close(); $('receiptIssuerForm').reset(); $('receiptBuyerFields').reset();
      $('receiptPreview').textContent = ''; $('receiptIssuerSummary').textContent = ''; $('receiptsBody').textContent = ''; notice('');
    },
  };
}
