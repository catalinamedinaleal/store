// Comprobantes comerciales internos. Sin afirmaciones de régimen tributario.
const recText_ = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const recAmount_ = v => {
  const amount = Number(v);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('La venta contiene valores monetarios inválidos.');
  return amount;
};
const recCOP_ = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
const recMethod_ = value => ({ cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', mixed: 'Mixto' }[value] || value || 'No registrado');
export const RECEIPT_NOTICE = 'Comprobante comercial interno. No es factura electrónica ni documento equivalente validado por la DIAN. No sustituye la factura cuando exista obligación de expedirla.';
export function receiptSaleSignature(sale) {
  return JSON.stringify([sale.status, sale.customer_id || '', sale.customer_phone || '', sale.total_cop, sale.paid_cop ?? null, sale.items || [], sale.payments || []]);
}
export function normalizeReceiptIssuer(value = {}) {
  const issuer = {
    name: recText_(value.name, 180), document: recText_(value.document, 40),
    address: recText_(value.address, 220), phone: recText_(value.phone, 40),
    brand: recText_(value.brand, 80) || 'Musicala Store',
  };
  if (Object.values(issuer).some(v => !v)) throw new Error('Completa nombre, cédula, dirección y teléfono del emisor.');
  return issuer;
}
export function buildReceiptSnapshot({ sale, saleId, issuer, buyer = {}, products = [], number, by, now = new Date().toISOString(), note = '' }) {
  if (!['paid', 'pagado', 'installments'].includes(sale?.status)) throw new Error('Solo se emiten comprobantes de ventas confirmadas, no de propuestas o cancelaciones.');
  const customer = {
    name: recText_(buyer.name || sale.customer_id, 180), document: recText_(buyer.document, 60),
    address: recText_(buyer.address, 220), phone: recText_(buyer.phone || sale.customer_phone, 40),
  };
  if (!customer.name) throw new Error('Indica el nombre del cliente o consumidor final.');
  const index = new Map(products.map(p => [String(p.id), p]));
  const items = (sale.items || []).map(item => {
    const qty = recAmount_(item.qty), unit_price = recAmount_(item.unit_price);
    if (!qty || !item.product_id) throw new Error('El detalle de productos está incompleto.');
    return { product_id: recText_(item.product_id, 180), name: recText_(index.get(String(item.product_id))?.name || item.name || item.product_id, 220), qty, unit_price, subtotal: recAmount_(qty * unit_price) };
  });
  const total = recAmount_(sale.total_cop);
  if (!items.length || items.reduce((sum, item) => sum + item.subtotal, 0) !== total) throw new Error('El detalle no coincide con el total de la venta. Revisa la venta antes de emitir.');
  const payments = (sale.payments || []).map(p => ({ amount_cop: recAmount_(p.amount_cop), date: recText_(p.date?.toDate ? p.date.toDate().toISOString() : p.date, 80), method: recText_(p.method, 40) }));
  const paid = recAmount_(sale.paid_cop ?? (sale.status === 'paid' || sale.status === 'pagado' ? total : payments.reduce((a, p) => a + p.amount_cop, 0)));
  if (paid > total || payments.length && payments.reduce((a, p) => a + p.amount_cop, 0) !== paid) throw new Error('Los pagos no coinciden con el valor registrado. Revisa los abonos.');
  if (['paid', 'pagado'].includes(sale.status) && paid !== total || sale.balance_cop !== undefined && recAmount_(sale.balance_cop) !== total - paid) throw new Error('El estado o saldo no coincide con los pagos. Revisa la venta antes de emitir.');
  return {
    version: 1, kind: 'commercial_receipt', number: recText_(number, 32), sale_id: recText_(saleId, 180),
    issued_at: now, issued_by: recText_(by, 180), issuer: normalizeReceiptIssuer(issuer), buyer: customer,
    items, total_cop: total, paid_cop: paid, balance_cop: total - paid, payments,
    payment_method: recText_(sale.payment_method, 40), note: recText_(note, 600), notice: RECEIPT_NOTICE,
  };
}
export function receiptText(receipt, voidInfo) {
  const r = receipt;
  return [
    `COMPROBANTE COMERCIAL ${r.number}`, voidInfo ? `ANULADO: ${voidInfo.reason}` : '',
    `Emisión: ${new Date(r.issued_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`,
    `Vendedora: ${r.issuer.name}`, `CC: ${r.issuer.document}`, `Dirección: ${r.issuer.address}`, `Teléfono: ${r.issuer.phone}`,
    `Referencia comercial: ${r.issuer.brand}`, `Cliente: ${r.buyer.name}`,
    r.buyer.document ? `Identificación: ${r.buyer.document}` : '', r.buyer.phone ? `Teléfono cliente: ${r.buyer.phone}` : '',
    r.buyer.address ? `Dirección cliente: ${r.buyer.address}` : '', '',
    ...r.items.map(i => `${i.qty} x ${i.name} - ${recCOP_(i.unit_price)} c/u - ${recCOP_(i.subtotal)}`),
    `Total de la venta: ${recCOP_(r.total_cop)}`, `Pagado al emitir: ${recCOP_(r.paid_cop)}`, `Saldo al emitir: ${recCOP_(r.balance_cop)}`,
    `Medio de pago registrado: ${recMethod_(r.payment_method)}`,
    'Valores y pagos corresponden al momento de emisión; no certifica pagos posteriores.',
    r.note, `Venta: ${r.sale_id}`, r.notice,
  ].filter(Boolean).join('\n');
}
export function createReceiptPdf(r, { jsPDF, voidInfo } = {}) {
  if (!jsPDF) throw new Error('No se cargó el generador PDF. Actualiza la página e inténtalo de nuevo.');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 22;
  const left = 18, width = 174, bottom = 270;
  const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[\u2010-\u2015]/g, '-');
  const ensure = height => { if (y + height > bottom) { pdf.addPage(); y = 22; } };
  const text = (value, size = 10, bold = false, color = [40, 49, 46]) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(clean(value), width);
    for (const line of lines) { ensure(size * .48 + 1); pdf.text(line, left, y); y += size * .48 + 1; }
  };
  text('COMPROBANTE COMERCIAL', 19, true, [41, 70, 65]);
  text(`${r.number} | ${new Date(r.issued_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`, 10);
  if (voidInfo) { y += 3; text(`ANULADO: ${voidInfo.reason}`, 12, true, [150, 35, 35]); }
  y += 5;
  text(r.issuer.name, 13, true); text(`CC. ${r.issuer.document}`); text(r.issuer.address); text(`Tel. ${r.issuer.phone}`);
  text(`Referencia comercial: ${r.issuer.brand}`, 9);
  y += 5;
  text(`Cliente: ${r.buyer.name}`, 11, true);
  if (r.buyer.document) text(`Identificación: ${r.buyer.document}`);
  if (r.buyer.phone) text(`Teléfono: ${r.buyer.phone}`);
  if (r.buyer.address) text(`Dirección: ${r.buyer.address}`);
  y += 6;
  for (const i of r.items) {
    ensure(23); text(i.name, 10, true);
    text(`${i.qty} ${i.qty === 1 ? 'unidad' : 'unidades'} x ${recCOP_(i.unit_price)} = ${recCOP_(i.subtotal)}`, 10);
    y += 3;
  }
  ensure(38); y += 4;
  text(`TOTAL DE LA VENTA: ${recCOP_(r.total_cop)}`, 13, true, [41, 70, 65]);
  text(`Pagado al emitir: ${recCOP_(r.paid_cop)}`, 11);
  text(`Saldo al emitir: ${recCOP_(r.balance_cop)}`, 11, true);
  text(`Medio de pago registrado: ${recMethod_(r.payment_method)}`, 9);
  text('Valores y pagos al momento de emisión. No certifica pagos posteriores.', 8);
  if (r.payments.length) {
    y += 5; text('Pagos registrados al emitir', 10, true);
    for (const p of r.payments) text(`${p.date ? new Date(p.date).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) : 'Fecha no registrada'} | ${recMethod_(p.method)} | ${recCOP_(p.amount_cop)}`, 9);
  }
  if (r.note) { y += 4; text(`Observaciones para el cliente: ${r.note}`, 9); }
  y += 5; text(r.notice, 8); text(`Referencia de venta: ${r.sale_id}`, 8);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
    pdf.text(`${r.number} | ${voidInfo ? 'ANULADO | ' : ''}Página ${page} de ${pages}`, left, 285);
  }
  return pdf;
}
