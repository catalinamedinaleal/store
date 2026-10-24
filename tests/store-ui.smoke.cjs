/**
 * Local UI smoke check. Firebase auth/data modules are replaced in the browser,
 * and every external request is blocked: this script cannot write production.
 * Run: node tests/store-ui.smoke.cjs
 * Optional: STORE_TEST_NODE_MODULES, STORE_TEST_BROWSER, STORE_TEST_OUTPUT.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); }
  catch {
    const modules = process.env.STORE_TEST_NODE_MODULES || path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
    return require(path.join(modules, 'playwright'));
  }
}

const { chromium } = loadPlaywright();
const root = path.resolve(__dirname, '..');
const output = process.env.STORE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'store-ui-smoke-'));

function browserExecutable() {
  if (process.env.STORE_TEST_BROWSER) return process.env.STORE_TEST_BROWSER;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const installed = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(installed)) {
    for (const folder of fs.readdirSync(installed).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const candidate = path.join(installed, folder, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function fixtureData() {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return {
    products: [
      { id: 'p_piano', name: 'Piano eléctrico de estudio', brand: 'Musicala', category: 'Teclados', sku: 'PI-001', desc: '88 teclas, incluye pedal y soporte.', price_cop: 1450000, active: true, has_cost: true, image_url: '/assets/logo.png' },
      { id: 'p_brush', name: 'Pinceles artísticos', brand: 'Arte', category: 'Arte', sku: 'AR-001', desc: 'Set de 12 pinceles.', price_cop: 45000, active: true, has_cost: true, image_url: '' },
      { id: 'p_guitar', name: 'Guitarra clásica', brand: 'Cuerdas', category: 'Cuerdas', sku: 'GU-001', desc: 'Modelo de exhibición oculto.', price_cop: 350000, active: false, has_cost: true, image_url: '' },
    ],
    inventory: [
      { id: 'p_piano', product_id: 'p_piano', stock: 2, min_stock: 1, location: 'Salón 1', updated_at: now.toISOString() },
      { id: 'p_brush', product_id: 'p_brush', stock: 0, min_stock: 1, location: 'Bodega', updated_at: now.toISOString() },
      { id: 'p_guitar', product_id: 'p_guitar', stock: 1, min_stock: 0, location: 'Exhibición', updated_at: now.toISOString() },
    ],
    costs: [
      { id: 'p_piano', product_id: 'p_piano', cost_cop: 1000000, margin_pct: 45, competitor_price_cop: 1600000 },
      { id: 'p_brush', product_id: 'p_brush', cost_cop: 30000, margin_pct: 50 },
    ],
    issuer: { name: 'Vendedora de prueba local', document: '123456789', address: 'Dirección ficticia 123', phone: '3000000000', brand: 'Musicala Store' },
    sales: [
      { id: 'sale_pending', customer_id: 'Laura Pérez', customer_phone: '3008887777', status: 'pending', total_cop: 1450000, paid_cop: 0, balance_cop: 1450000, posted: false, created_at: now.toISOString(), created_by: 'adminmusicala@gmail.com', notes: 'Quiere piano para su hija', items: [{ product_id: 'p_piano', qty: 1, unit_price: 1450000, subtotal: 1450000 }] },
      { id: 'sale_abono', customer_id: 'Carlos Ruiz', status: 'installments', total_cop: 350000, paid_cop: 100000, balance_cop: 250000, posted: true, created_at: now.toISOString(), created_by: 'adminmusicala@gmail.com', notes: 'Entrega por confirmar', items: [{ product_id: 'p_guitar', qty: 1, unit_price: 350000, subtotal: 350000 }], payments: [{ amount_cop: 100000, method: 'cash', note: 'Primer abono', date: now.toISOString() }] },
      { id: 'sale_paid', customer_id: 'Ana Torres', status: 'paid', total_cop: 45000, paid_cop: 45000, balance_cop: 0, posted: true, created_at: now.toISOString(), created_by: 'alekcaballeromusic@gmail.com', items: [{ product_id: 'p_brush', qty: 1, unit_price: 45000, subtotal: 45000 }] },
    ],
    leads: [
      { id: 'lead_overdue', name: 'Diana Gómez', phone: '3001234567', product_id: 'p_piano', interest: 'Piano para principiante', next_contact_at: yesterday.toISOString().slice(0, 10), status: 'seguimiento', history: [{ at: yesterday.toISOString(), note: 'Pidió la ficha.', by: 'adminmusicala@gmail.com' }] },
      { id: 'lead_today', name: 'Mateo López', phone: '3007654321', product_id: 'p_brush', interest: 'Arte', next_contact_at: today, status: 'nuevo', history: [] },
      { id: 'lead_lost', name: 'Cliente cerrado', phone: '', interest: 'Guitarra', next_contact_at: '', status: 'perdido', history: [] },
    ],
  };
}

function firebaseMock(email) {
  return `
    const user = { uid: 'local-smoke-user', email: ${JSON.stringify(email)}, displayName: 'Prueba local', getIdToken: async () => 'local-smoke-token' };
    const auth = { currentUser: user };
    let callback;
    export const FirebaseAuth = {
      auth, googleProvider: {},
      onAuthStateChanged(_auth, cb) { callback = cb; setTimeout(() => cb(user), 0); return () => {}; },
      signInWithPopup: async () => ({ user }),
      signOut: async () => { auth.currentUser = null; if (callback) callback(null); },
    };
    export const initFirebase = async () => FirebaseAuth;
    export const getFirebaseAuth = () => auth;
    export const getFirebaseStorage = () => ({});
    export const getFirestoreDb = () => null;
    export const getCurrentUser = () => auth.currentUser;
    export const getIdToken = async () => 'local-smoke-token';
  `;
}

function apiMock(data, role) {
  return `
    import { buildReceiptSnapshot, receiptSaleSignature } from '/js/receipts.js';
    const data = ${JSON.stringify(data)};
    const calls = [];
    const copy = x => structuredClone(x);
    const record = (name, value) => { calls.push({ name, value: copy(value) }); };
    const save = (input, id) => {
      const total = input.items.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
      const row = { ...copy(input.sale), id, items: copy(input.items), created_at: new Date().toISOString(), total_cop: total, paid_cop: input.sale.status === 'paid' ? total : 0, balance_cop: input.sale.status === 'paid' ? 0 : total };
      const i = data.sales.findIndex(s => s.id === id);
      if (i < 0) data.sales.push(row); else data.sales[i] = { ...data.sales[i], ...row };
      return { ok: true, id, status: row.status, total_cop: total };
    };
    globalThis.__storeTestData = data;
    globalThis.__storeTestCalls = calls;
    const missing = name => { throw new Error('Unexpected mock operation: ' + name); };
    export const StoreAPI = {
      getReceiptSettings: async () => ({ ok: true, issuer: copy(data.issuer) }),
      saveReceiptIssuer: async issuer => { record('saveReceiptIssuer', issuer); data.issuer = copy(issuer); return { ok: true, issuer: copy(issuer) }; },
      issueReceipt: async (id, input) => { record('issueReceipt', { id, input }); const sale = data.sales.find(s => s.id === id); if (!sale.receipt) sale.receipt = buildReceiptSnapshot({ sale, saleId: id, issuer: data.issuer, buyer: input.buyer, note: input.note, by: input.by, products: data.products, number: 'CV-000001' }); return { ok: true, receipt: copy(sale.receipt) }; },
      voidReceipt: async (id, reason, by) => { record('voidReceipt', { id, reason, by }); data.sales.find(s => s.id === id).receipt_void = { reason, by, at: new Date().toISOString() }; return { ok: true }; },
      ping: async () => ({ ok: true }),
      listProducts: async () => ({ ok: true, items: copy(data.products) }),
      listInventory: async () => ({ ok: true, items: copy(data.inventory) }),
      listSales: async (status = 'all') => ({ ok: true, items: copy(data.sales.filter(s => status === 'all' || !status || s.status === status)) }),
      listLeads: async () => ({ ok: true, items: copy(data.leads) }),
      listMoves: async () => ({ ok: true, items: [] }),
      listProductCosts: async () => { record('listProductCosts', null); ${role === 'admin' ? 'return { ok: true, items: copy(data.costs) };' : "throw new Error('permission-denied');"} },
      getPricingSettings: async () => ({ ok: true, settings: { version: 1, tiers: [{ max: 0, margin_pct: 45 }], round_to: 1000, round_mode: 'up' } }),
      profitReport: async () => ({ ok: true, profit_today_cop: 15000, profit_cop: 15000, units_without_cost: 0 }),
      dashboard: async () => ({ ok: true, products_count: data.products.length, today_total_cop: 45000, low_stock: data.inventory.filter(i => i.stock <= i.min_stock) }),
      upsertProduct: async (product, opts) => { record('upsertProduct', { product, opts }); const i = data.products.findIndex(p => p.id === product.id); const publicProduct = copy(product); delete publicProduct.cost_cop; delete publicProduct.margin_pct; delete publicProduct.competitor_price_cop; publicProduct.has_cost = opts.writeCost || !!data.products[i]?.has_cost; if (i < 0) { data.products.push(publicProduct); data.inventory.push({ id: product.id, product_id: product.id, stock: 0, min_stock: 0, location: '' }); } else data.products[i] = { ...data.products[i], ...publicProduct }; return { ok: true, mode: i < 0 ? 'created' : 'updated' }; },
      upsertLead: async (lead, by) => { record('upsertLead', { lead, by }); const row = { ...copy(lead), id: lead.id || 'lead_new' }; const i = data.leads.findIndex(l => l.id === row.id); if (i < 0) data.leads.push(row); else data.leads[i] = row; return { ok: true, id: row.id }; },
      addLeadFollowUp: async (leadId, follow) => { record('addLeadFollowUp', { leadId, follow }); const lead = data.leads.find(l => l.id === leadId); lead.history.push({ at: new Date().toISOString(), note: follow.note, by: follow.by }); lead.next_contact_at = follow.nextContactAt; return { ok: true }; },
      getSale: async id => { const sale = data.sales.find(s => s.id === id); return { ok: true, sale: copy(sale), items: copy(sale.items) }; },
      createSale: async input => { record('createSale', input); return save(input, 'sale_new'); },
      savePendingSale: async (id, input) => { record('savePendingSale', { id, input }); return save(input, id); },
      updateSale: async () => missing('updateSale'),
      deleteSale: async () => missing('deleteSale'),
      adjustStock: async () => missing('adjustStock'),
      setProductActive: async () => missing('setProductActive'),
      setLeadStatus: async (id, status, extra) => { record('setLeadStatus', { id, status, extra }); data.leads.find(l => l.id === id).status = status; return { ok: true }; },
    };
  `;
}

async function localServer() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function selectLabel(page, selector, match) {
  const options = await page.locator(selector).locator('option').evaluateAll(nodes => nodes.map(n => ({ value: n.value, label: n.textContent })));
  const option = options.find(o => match.test(o.label));
  assert.ok(option, `${selector}: missing option ${match}; got ${JSON.stringify(options)}`);
  await page.locator(selector).selectOption(option.value);
}

async function runRole(browser, base, role, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, timezoneId: 'America/Bogota', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  const securityErrors = [];
  const blockedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Content Security Policy|violates.*directive|Refused to/.test(message.text())) securityErrors.push(message.text()); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const pdfLibrary = process.env.STORE_TEST_JSPDF;
    if (url.href === 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js' && pdfLibrary) {
      await route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(pdfLibrary, 'utf8') }); return;
    }
    if (url.href === 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js') {
      await route.fulfill({ contentType: 'text/javascript', body: `
        export const ref = (_storage, path) => ({ path });
        export const uploadBytes = async (ref, file, metadata) => { globalThis.__storeTestCalls.push({ name: 'uploadBytes', value: { path: ref.path, name: file.name, type: file.type, metadata } }); };
        export const getDownloadURL = async () => location.origin + '/assets/logo.png';
      ` }); return;
    }
    if (url.origin !== base) { blockedRequests.push(url.href); await route.abort(); return; }
    if (url.pathname === '/js/firebase.js') { await route.fulfill({ contentType: 'text/javascript', body: firebaseMock(role === 'admin' ? 'alekcaballeromusic@gmail.com' : 'adminmusicala@gmail.com') }); return; }
    if (url.pathname === '/js/firebase-store.js') { await route.fulfill({ contentType: 'text/javascript', body: apiMock(fixtureData(), role) }); return; }
    await route.continue();
  });

  try {
    await page.goto(base);
    await page.locator('body[data-view="app"]').waitFor();
    await page.locator('#catalogGrid').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#btnRefresh')?.disabled);
    assert.equal(await page.locator('body').getAttribute('data-user-role'), role);
    assert.match(await page.locator('#opsSummary').innerText(), /[12]/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page must fit viewport without horizontal overflow');
    await page.screenshot({ path: path.join(output, `${role}${mobile ? '-mobile' : ''}-catalog.png`), fullPage: true });

    await page.locator('#qCatalog').fill('piano electrico');
    await page.waitForFunction(() => document.querySelector('#catalogGrid')?.textContent.includes('Piano eléctrico de estudio') && !document.querySelector('#catalogGrid')?.textContent.includes('Pinceles artísticos'));
    assert.match(await page.locator('#catalogGrid').innerText(), /2/);
    await page.locator('#qCatalog').fill('');
    await selectLabel(page, '#catalogAvailability', /sin existencias|sin stock|agotado/i);
    await page.waitForFunction(() => document.querySelector('#catalogGrid')?.textContent.includes('Pinceles artísticos') && !document.querySelector('#catalogGrid')?.textContent.includes('Piano eléctrico de estudio'));
    await selectLabel(page, '#catalogAvailability', /cualquier|todas|todos/i);
    await selectLabel(page, '#catalogCategory', /^Teclados$/i);
    assert.match(await page.locator('#catalogGrid').innerText(), /Piano/);
    await selectLabel(page, '#catalogCategory', /todas|todos/i);
    await selectLabel(page, '#catalogStatus', /^Ocultos$/i);
    await page.waitForFunction(() => document.querySelector('#catalogGrid')?.textContent.includes('Guitarra clásica') && !document.querySelector('#catalogGrid')?.textContent.includes('Piano eléctrico de estudio'));
    await selectLabel(page, '#catalogStatus', /^Activos$/i);
    await selectLabel(page, '#catalogLayout', /Tabla/i);
    await page.locator('#tblCatalog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#catalogBody').innerText(), /Piano eléctrico de estudio/);
    await selectLabel(page, '#catalogLayout', /Tarjetas/i);

    await page.locator('#catalogGrid button.btn[data-act="share"][data-id="p_piano"]').click();
    await page.locator('#modalProductShare[open]').waitFor();
    await page.screenshot({ path: path.join(output, `${role}${mobile ? '-mobile' : ''}-product-sheet.png`) });
    assert.match(await page.locator('#productShareContent').innerText(), /Piano eléctrico de estudio/);
    assert.ok(!/1[.\s]?000[.\s]?000|margen|utilidad|competencia/i.test(await page.locator('#productShareContent').innerText()), 'Commercial sheet must not expose costs');
    await page.locator('#btnProductCopy').click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('Piano eléctrico de estudio'));
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /Piano eléctrico de estudio/);
    assert.match(copied, /Foto:/);
    assert.ok(!/1[.\s]?000[.\s]?000|margen|utilidad|competencia/i.test(copied), 'Copied sheet must not expose costs');
    await page.waitForFunction(() => !document.querySelector('#btnProductPhoto')?.disabled);
    await page.locator('#btnProductPhoto').click();
    await page.waitForFunction(async () => (await navigator.clipboard.read()).some(item => item.types.includes('image/png')));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => { globalThis.__storeTestShare = { text: payload.text, files: payload.files?.map(file => ({ type: file.type, name: file.name })) }; } });
    });
    await page.locator('#btnProductShare').click();
    const shared = await page.evaluate(() => globalThis.__storeTestShare);
    assert.match(shared.text, /Piano eléctrico de estudio/);
    assert.equal(shared.files.length, 1, 'Prepared photo is attached to supported share payload');
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
    await page.locator('#btnProductShare').click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('Piano eléctrico de estudio'));
    if (await page.locator('#btnProductDownload').isVisible()) {
      const download = page.waitForEvent('download');
      await page.locator('#btnProductDownload').click();
      const downloaded = await download;
      assert.match(downloaded.suggestedFilename(), /foto|piano|producto/i);
    }
    await page.locator('#btnProductLead').click();
    await page.locator('#modalLead[open]').waitFor();
    assert.equal(await page.locator('#l_product_id').inputValue(), 'p_piano');
    await page.locator('#l_name').fill('Cliente de prueba local');
    await page.locator('#l_phone').fill('3005556789');
    await page.locator('#btnSaveLead').click();
    await page.waitForFunction(() => !document.querySelector('#modalLead')?.open);
    const leadWrite = await page.evaluate(() => globalThis.__storeTestCalls.find(c => c.name === 'upsertLead'));
    assert.equal(leadWrite.value.lead.product_id, 'p_piano');

    await page.locator('[data-tab="catalog"]').click();
    await page.locator('#catalogGrid button.btn[data-act="share"][data-id="p_piano"]').click();
    await page.locator('#btnProductSell').click();
    await page.locator('#salePane').waitFor({ state: 'visible' });
    assert.match(await page.locator('#saleItemsBody').innerText(), /Piano eléctrico de estudio/);
    await page.locator('#ordersSearch').fill('Carlos');
    await page.waitForFunction(() => document.querySelector('#ordersBody')?.textContent.includes('Carlos Ruiz') && !document.querySelector('#ordersBody')?.textContent.includes('Laura Pérez'));
    assert.match(await page.locator('#ordersBody').innerText(), /250[.\s]?000/);
    await page.locator('#btnCancelSale').click();
    await page.locator('#ordersSearch').fill('Laura');
    await page.waitForFunction(() => !!document.querySelector('[data-order-open="sale_pending"]'));
    await page.locator('[data-order-open="sale_pending"]').click();
    await page.locator('#salePane').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#saleCustomerPhone').inputValue(), '3008887777');
    await page.locator('#saleNotes').fill('Propuesta actualizada en prueba local');
    await page.locator('#btnSaveSale').click();
    await page.waitForFunction(() => document.querySelector('#salePane')?.hidden && globalThis.__storeTestCalls.some(c => c.name === 'savePendingSale'));
    assert.equal(await page.evaluate(() => globalThis.__storeTestData.sales.filter(s => s.id === 'sale_pending').length), 1);
    const pendingWrite = await page.evaluate(() => globalThis.__storeTestCalls.find(c => c.name === 'savePendingSale'));
    assert.equal(pendingWrite.value.id, 'sale_pending');
    assert.equal(pendingWrite.value.input.sale.customer_phone, '3008887777');
    assert.equal(await page.evaluate(() => globalThis.__storeTestCalls.filter(c => c.name === 'createSale').length), 0);

    await page.locator('[data-tab="leads"]').click();
    await page.locator('#onlyLeadsDue').check();
    await page.waitForFunction(() => document.querySelector('#leadsBody')?.textContent.includes('Diana Gómez') && document.querySelector('#leadsBody')?.textContent.includes('Mateo López'));
    assert.ok(!(await page.locator('#leadsBody').innerText()).includes('Cliente cerrado'));
    await page.screenshot({ path: path.join(output, `${role}${mobile ? '-mobile' : ''}-leads.png`), fullPage: true });
    await page.locator('#onlyLeadsDue').uncheck();
    await page.locator('[data-lead-act="convert"][data-id="lead_new"]').click();
    await page.locator('#salePane').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#saleCustomerPhone').inputValue(), '3005556789');
    await page.locator('#saleStatus').selectOption('pending');
    await page.locator('#btnSaveSale').click();
    await page.waitForFunction(() => document.querySelector('#salePane')?.hidden && globalThis.__storeTestCalls.some(c => c.name === 'createSale'));
    assert.equal(await page.evaluate(() => globalThis.__storeTestData.sales.find(s => s.id === 'sale_new').lead_id), 'lead_new');
    assert.equal(await page.evaluate(() => globalThis.__storeTestCalls.filter(c => c.name === 'setLeadStatus').length), 0, 'A proposal must not mark the lead as won');
    await page.locator('#ordersSearch').fill('');
    await page.waitForFunction(() => document.querySelector('#ordersBody')?.textContent.includes('Carlos Ruiz'));
    assert.match(await page.locator('#salesSummary').innerText(), /250[.\s]?000/, 'Only installment balances count as receivables');

    await page.locator('[data-tab="catalog"]').click();
    await page.locator('#btnNewProduct').click();
    await page.locator('#p_image_file').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'assets', 'logo.png')) });
    await page.waitForFunction(() => { const image = document.querySelector('#p_image_preview img'); return image && image.complete && image.naturalWidth > 0; });
    await page.locator('#p_image_preview').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${role}${mobile ? '-mobile' : ''}-photo-preview.png`) });
    await page.locator('[data-close-dialog="modalProduct"]').first().click();

    await page.locator('#btnNewProduct').click();
    await page.locator('#p_name').fill('Atril de prueba local');
    await page.locator('#p_category').fill('Accesorios');
    await page.locator('#p_image_file').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'assets', 'logo.png')) });
    await page.locator('#p_cost').fill('100000');
    await page.waitForFunction(() => document.querySelector('#p_price')?.value === '145000');
    await page.locator('#btnSaveProduct').click();
    await page.waitForFunction(() => !document.querySelector('#modalProduct')?.open);
    const productWrite = await page.evaluate(() => globalThis.__storeTestCalls.find(c => c.name === 'upsertProduct'));
    assert.equal(productWrite.value.product.name, 'Atril de prueba local');
    assert.equal(productWrite.value.product.price_cop, 145000);
    assert.equal(productWrite.value.opts.writeCost, true);
    assert.match(productWrite.value.product.image_url, /\/assets\/logo\.png$/);
    const upload = await page.evaluate(() => globalThis.__storeTestCalls.find(c => c.name === 'uploadBytes'));
    assert.match(upload.value.path, /^products\/.+\/\d+\.png$/);
    assert.equal(upload.value.type, 'image/png');

    await page.locator('[data-tab="receipts"]').click();
    await page.waitForFunction(() => document.querySelector('#receiptsBody')?.textContent.includes('Carlos Ruiz'));
    assert.match(await page.locator('#receiptIssuerSummary').innerText(), /Vendedora de prueba local/);
    assert.equal(await page.locator('#receiptIssuerForm').isVisible(), false, 'Configuration is collapsed by default');
    await page.locator('#receiptsBody [data-receipt-sale="sale_abono"]').click();
    await page.locator('#modalReceipt[open]').waitFor();
    assert.match(await page.locator('#receiptPreview').innerText(), /250[.\s]?000/);
    assert.doesNotMatch(await page.locator('#receiptPreview').innerText(), /cost_cop|margen|1[.\s]?000[.\s]?000/);
    if (role === 'admin') {
      await page.locator('#receiptBuyer_document').fill('9999999');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#btnIssueReceipt').click();
      await page.waitForFunction(() => document.querySelector('#receiptPreview')?.textContent.includes('CV-000001'));
      assert.equal(await page.locator('#btnIssueReceipt').isVisible(), false);
      await page.locator('#btnReceiptCopy').click();
      await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('COMPROBANTE COMERCIAL CV-000001'));
      const receiptCopy = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(receiptCopy, /No es factura electrónica/);
      assert.match(receiptCopy, /CC: 123456789/);
      if (process.env.STORE_TEST_JSPDF) {
        const receiptDownload = page.waitForEvent('download');
        await page.locator('#btnReceiptPdf').click();
        const pdf = await receiptDownload;
        assert.equal(pdf.suggestedFilename(), 'CV-000001.pdf');
        await pdf.saveAs(path.join(output, 'receipt-example.pdf'));
        const multiPage = await page.evaluate(async () => {
          const { createReceiptPdf } = await import('/js/receipts.js?v=' + window.__BUILD__);
          const receipt = structuredClone(globalThis.__storeTestData.sales.find(s => s.id === 'sale_abono').receipt);
          receipt.items = Array.from({ length: 80 }, (_, i) => ({ name: `Producto ${i + 1} de descripción larga para revisar los saltos de página del comprobante comercial`, qty: 1, unit_price: 10000, subtotal: 10000 }));
          receipt.total_cop = 800000; receipt.paid_cop = 100000; receipt.balance_cop = 700000;
          const pdf = createReceiptPdf(receipt, { jsPDF: window.jspdf.jsPDF, voidInfo: { reason: 'Prueba de documento anulado de varias páginas' } });
          return { pages: pdf.getNumberOfPages(), bytes: Array.from(new Uint8Array(pdf.output('arraybuffer'))) };
        });
        assert.ok(multiPage.pages > 1, 'Long receipts paginate');
        fs.writeFileSync(path.join(output, 'receipt-multipage.pdf'), Buffer.from(multiPage.bytes));
      }
      await page.screenshot({ path: path.join(output, 'admin-receipt.png') });
      page.once('dialog', dialog => dialog.accept('Datos incorrectos - prueba local'));
      await page.locator('#btnVoidReceipt').click();
      await page.waitForFunction(() => document.querySelector('#receiptPreview')?.textContent.includes('ANULADO'));
      assert.equal(await page.evaluate(() => globalThis.__storeTestCalls.filter(c => c.name === 'issueReceipt').length), 1);
      assert.equal(await page.evaluate(() => globalThis.__storeTestData.sales.find(s => s.id === 'sale_abono').status), 'installments');
    } else {
      assert.equal(await page.locator('#btnIssueReceipt').isVisible(), false);
      assert.equal(await page.locator('#btnReceiptPdf').isDisabled(), true);
      await page.evaluate(async () => {
        const api = await import('/js/firebase-store.js?v=' + window.__BUILD__);
        await api.StoreAPI.issueReceipt('sale_abono', { buyer: { name: 'Carlos Ruiz' }, by: 'admin-test' });
      });
      await page.locator('[data-close-dialog="modalReceipt"]').click();
      await page.locator('#btnRefreshReceipts').click();
      await page.waitForFunction(() => document.querySelector('#receiptsBody')?.textContent.includes('CV-000001'));
      await page.locator('#receiptsBody [data-receipt-sale="sale_abono"]').click();
      await page.waitForFunction(() => document.querySelector('#receiptPreview')?.textContent.includes('CV-000001'));
      assert.equal(await page.locator('#btnIssueReceipt').isVisible(), false);
      assert.equal(await page.locator('#btnVoidReceipt').isVisible(), false);
      assert.equal(await page.locator('#btnReceiptPdf').isDisabled(), false);
      await page.screenshot({ path: path.join(output, 'asesor-mobile-receipt.png') });
    }
    await page.locator('[data-close-dialog="modalReceipt"]').click();

    if (role === 'asesor') {
      assert.equal(await page.locator('[data-tab="dashboard"]').isVisible(), false);
      const calls = await page.evaluate(() => globalThis.__storeTestCalls.filter(c => c.name === 'listProductCosts'));
      assert.equal(calls.length, 0, 'Advisor must not read product costs');
    }
    assert.deepEqual(errors, [], `${role}: browser exceptions`);
    assert.deepEqual(securityErrors, [], `${role}: CSP violations`);
    assert.ok(!blockedRequests.some(url => /firestore|identitytoolkit|firebasestorage/.test(url)), 'UI must not attempt a real Firebase request');
    console.log(`PASS ${role}${mobile ? ' mobile' : ''}: catalog, photos, sales, leads, receipts, role controls, receipt copy/download and annulment`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${role}${mobile ? '-mobile' : ''}-failure.png`), fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ role, mobile, errors, securityErrors, blockedRequests }, null, 2));
    throw error;
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { server, url } = await localServer();
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable() });
  try {
    await runRole(browser, url, 'admin');
    await runRole(browser, url, 'asesor', true);
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); console.error(`Artifacts: ${output}`); process.exitCode = 1; });
