const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Subscriber = require('../models/Subscriber');
const { createDuftrollerResolver } = require('../services/duftrollerService');
const { createCartService } = require('../services/cartService');
const sourceProduct = require('../catalog/duftroller.json');
const env = { NODE_ENV: 'test', JWT_SECRET: 'synthetic-roller-secret-at-least-32-bytes', ADMIN_PASSWORD: 'synthetic-roller-admin', FRONTEND_PUBLIC_URL: 'http://localhost:5500', BACKEND_PUBLIC_URL: 'http://localhost:4242', INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic' };
const configs = new Map(), sessions = new Map();
const stripe = {
    webhooks: new (require('stripe'))('sk_test_synthetic').webhooks,
    coupons: { create: async config => ({ id: 'coupon_synthetic_roller', ...config }) },
    checkout: { sessions: {
        create: async config => {
            const id = 'cs_test_roller_' + crypto.randomUUID();
            configs.set(id, config);
            return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        },
        retrieve: async id => sessions.get(id),
        listLineItems: async id => ({ data: configs.get(id).line_items.map((item, index) => ({
            id: `li_${index}`, quantity: item.quantity, currency: 'eur',
            description: item.price_data.product_data.name,
            amount_subtotal: item.price_data.unit_amount * item.quantity,
            price: { unit_amount: item.price_data.unit_amount, product: item.price_data.product_data }
        })), has_more: false })
    } }
};
let database, server, base, cart;

before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.2.6' }, instance: { ip: '127.0.0.1', dbName: 'note-test-duftroller' }, spawn: { windowsHide: true } });
    env.MONGO_URI = database.getUri('note-test-duftroller');
    await mongoose.connect(env.MONGO_URI);
    const app = require('../app').createApp({ env, stripe });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    await Product.create(require('../fixtures/products.json').filter(product => product.id !== 'DUFTROLLER'));
    await Product.create(sourceProduct);
    await Product.create({ id: 'G999', name: 'Synthetic non-perfume', category: 'car-fragrance', variants: { 30: { price: 9 } } });
    await app.locals.refreshProductCache();
    cart = createCartService({ Product, resolveDuftrollerItem: createDuftrollerResolver({ Product }), resolveAutoduftItem: async () => null, resolveSummerBundleItem: async () => null, sanitizeQuantity: value => Number.isInteger(Number(value)) && value > 0 && value <= 20 ? Number(value) : null, mapSupplier: product => ['G1', 'L1'].includes(product.id) ? 'supplier-' + product.id : '' });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await require('../models/RateLimit').deleteMany({}); });
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (database) await database.stop();
});

function client() {
    const cookies = new Map();
    async function raw(url, options = {}) {
        const response = await fetch(base + url, { ...options, headers: { Origin: 'http://localhost:5500', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers } });
        for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
        return response;
    }
    return async (url, body, method = 'POST', headers = {}) => {
        const { csrfToken } = await (await raw('/api/csrf-token')).json();
        const response = await raw(url, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...headers } });
        return { status: response.status, body: await response.json() };
    };
}
const items = [{ id: 'DUFTROLLER-6-G1', quantity: 2 }, { id: 'DUFTROLLER-10-L1', quantity: 1 }, { id: 'DUFTROLLER-14-G1', quantity: 1 }];

test('catalog advertises exactly the approved roller sizes/prices and validates category-specific sizes', async () => {
    const catalog = await (await fetch(base + '/api/products')).json();
    const roller = catalog.find(product => product.id === 'DUFTROLLER');
    assert.equal(roller.category, 'duftroller');
    assert.deepEqual(roller.variants, { 6: { price: 12.5 }, 10: { price: 16 }, 14: { price: 19.5 } });
    assert.equal(roller.images.length, 6);
    await assert.rejects(new Product({ ...sourceProduct, variants: { 30: { price: 12.5 } } }).validate());
    await assert.rejects(new Product({ ...sourceProduct, variants: { 6: { price: 12.505 } } }).validate());
    await assert.rejects(new Product({ ...sourceProduct, category: 'men' }).validate());
});

test('server resolves every roller size, preserves size/scent/photos and ignores forged prices or labels', async () => {
    const quote = await cart.calculate(items.map(item => ({ ...item, price: 0.01, unitAmountCents: 1, name: 'Forged label', imageUrl: 'https://untrusted.test/image' })));
    assert.equal(quote.subtotalCents, 6050);
    assert.deepEqual(quote.items.map(item => item.unitAmountCents), [1250, 1600, 1950]);
    assert.deepEqual(quote.items.map(item => item.variant), ['6-G1', '10-L1', '14-G1']);
    assert.deepEqual(quote.items.map(item => item.sku), items.map(item => item.id));
    assert.deepEqual(quote.items.map(item => item.supplierId), ['supplier-G1', 'supplier-L1', 'supplier-G1']);
    for (const [index, item] of quote.items.entries()) {
        const size = ['6', '10', '14'][index];
        assert.match(item.description, new RegExp(`NØTE\\. Duftroller \\(${size} ml\\)`));
        assert.ok(item.imageUrl.endsWith(`note-duftroller-${size}-closed-v3.webp`));
        assert.equal(quote.stripeItems[index].price_data.product_data.metadata.variant, item.variant);
    }
});

test('invalid sizes, unavailable scents, conflicting selections and duplicate quantity overflow are rejected', async () => {
    for (const id of ['DUFTROLLER', 'DUFTROLLER-30', 'DUFTROLLER-30-G1', 'DUFTROLLER-10', 'DUFTROLLER-06-G1', 'DUFTROLLER-14-AUTODUFT', 'DUFTROLLER-14-G1-extra']) {
        await assert.rejects(cart.calculate([{ id, quantity: 1 }]), error => error.statusCode === 400);
    }
    for (const id of ['DUFTROLLER-6-L9999', 'DUFTROLLER-6-G999']) {
        await assert.rejects(cart.calculate([{ id, quantity: 1 }]), error => error.statusCode === 404);
    }
    for (const conflict of [{ size: 14 }, { scentId: 'L1' }, { productId: 'G1' }, { productType: 'perfume' }]) {
        await assert.rejects(cart.calculate([{ id: 'DUFTROLLER-6-G1', quantity: 1, ...conflict }]), error => error.statusCode === 400);
    }
    await assert.rejects(cart.calculate([{ id: 'DUFTROLLER-6-G1', quantity: 12 }, { id: 'duftroller-6-g1', quantity: 9 }]), error => error.statusCode === 400);
    await assert.rejects(cart.calculate([{ id: 'DUFTROLLER-6-G1', quantity: 1.5 }]), error => error.statusCode === 400);
    assert.equal((await cart.calculate([{ id: 'DUFTROLLER-6-G1', quantity: 20 }, { id: 'DUFTROLLER-10-G1', quantity: 20 }])).subtotalCents, 57000);
});

test('Stripe checkout uses the server quote, coupon and shipping policy for all three sizes', async () => {
    const buyer = client();
    await Subscriber.create({ email: 'roller-shipping@example.test', status: 'active', code: 'ROLLER-TEN', discount: 10, freeShipping: true });
    const result = await buyer('/create-checkout-session', { items: items.map(item => ({ ...item, quantity: 1, price: 0.01 })), couponCode: 'ROLLER-TEN' }, 'POST', { 'Idempotency-Key': crypto.randomUUID() });
    assert.equal(result.status, 200);
    const id = result.body.url.split('/').at(-1), config = configs.get(id);
    assert.deepEqual(config.line_items.map(item => item.price_data.unit_amount), [1250, 1600, 1950]);
    assert.equal(config.metadata.discountAmountCents, '480');
    assert.equal(config.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
    assert.equal(config.discounts[0].coupon, 'coupon_synthetic_roller');
    const single = await buyer('/create-checkout-session', { items: [items[1]] }, 'POST', { 'Idempotency-Key': crypto.randomUUID() });
    assert.equal(single.status, 200);
    assert.equal(configs.get(single.body.url.split('/').at(-1)).shipping_options[0].shipping_rate_data.fixed_amount.amount, 699);
});

test('HTTP checkout rejects forged selection IDs before contacting the payment provider', async () => {
    const buyer = client(), count = configs.size;
    for (const item of [
        { id: 'DUFTROLLER-50-G1', quantity: 1 },
        { id: 'DUFTROLLER-14-L9999', quantity: 1 },
        { id: 'DUFTROLLER-6-G1', size: 14, quantity: 1 },
        { id: 'DUFTROLLER-14-G1', scentId: 'L1', quantity: 1 }
    ]) {
        const result = await buyer('/create-checkout-session', { items: [item] }, 'POST', { 'Idempotency-Key': crypto.randomUUID() });
        assert.ok([400, 404].includes(result.status));
    }
    assert.equal(configs.size, count);
});

test('pickup stores all sizes and scents once with correct totals, coupon and confirmation descriptions', async () => {
    await Subscriber.create({ email: 'roller-pickup@example.test', status: 'active', code: 'ROLLER-PICKUP', discount: 10 });
    const buyer = client(), key = crypto.randomUUID();
    const body = { items, couponCode: 'ROLLER-PICKUP', customerName: 'Synthetic Roller Buyer', customerEmail: 'roller-pickup@example.test' };
    const result = await buyer('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key });
    assert.equal(result.status, 200);
    const order = await Order.findById(result.body.orderId);
    assert.equal(order.amount, 5445);
    assert.equal(order.discountAmount, 605);
    assert.deepEqual(order.items.map(item => item.variant), ['6-G1', '10-L1', '14-G1']);
    const again = await buyer('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key });
    assert.equal(again.body.orderId, result.body.orderId);
    assert.equal(await Order.countDocuments({ checkoutRequestId: key }), 1);
    const mail = await require('../models/MailJob').findOne({ key: `pickup-confirmation:${order._id}` }).select('+payload');
    assert.match(mail.payload.html, /Duftroller/);
    assert.match(mail.payload.html, /14 ml/);
    assert.match(mail.payload.html, /54,45/);
});

test('paid webhook and invoice snapshot retain roller volume and scent from signed checkout data', async () => {
    const result = await client()('/create-checkout-session', { items }, 'POST', { 'Idempotency-Key': crypto.randomUUID() });
    assert.equal(result.status, 200);
    const id = result.body.url.split('/').at(-1), config = configs.get(id);
    sessions.set(id, { id, status: 'complete', payment_status: 'paid', currency: 'eur', created: Math.floor(Date.now() / 1000), amount_subtotal: 6050, amount_total: 6050, total_details: { amount_discount: 0 }, shipping_cost: { amount_total: 0 }, metadata: config.metadata, payment_intent: { id: 'pi_synthetic_roller', latest_charge: { created: Math.floor(Date.now() / 1000) } }, customer_details: { email: 'roller-paid@example.test', name: 'Synthetic Roller Buyer', address: { line1: 'Testweg 1', postal_code: '12345', city: 'Teststadt', country: 'DE' } } });
    const payload = JSON.stringify({ id: 'evt_synthetic_roller', livemode: false, created: Math.floor(Date.now() / 1000), type: 'checkout.session.completed', data: { object: { id } } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
    const response = await fetch(base + '/webhook', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature } });
    assert.equal(response.status, 200);
    const order = await Order.findOne({ stripeSessionId: id });
    assert.equal(order.paymentStatus, 'paid');
    assert.deepEqual(order.items.map(item => item.sku), items.map(item => item.id));
    assert.deepEqual(order.items.map(item => item.variant), ['6-G1', '10-L1', '14-G1']);
    const snapshot = await require('../services/invoiceService').retrieveCheckoutSnapshot(stripe, order);
    assert.equal(snapshot.totalGrossCents, 6050);
    assert.deepEqual(snapshot.items.map(item => item.unitGrossCents), [1250, 1600, 1950]);
    for (const [index, item] of snapshot.items.entries()) {
        assert.match(item.description, new RegExp(`\\(${['6', '10', '14'][index]} ml\\)`));
        assert.match(item.description, index === 1 ? /L1/ : /G1/);
    }
});

test('admin perfume bulk edits preserve roller sizes; own price fields are authenticated and validated', async () => {
    const anonymous = client();
    assert.equal((await anonymous('/api/admin/products/DUFTROLLER', { price6: 0.01 }, 'PUT')).status, 401);
    const admin = client();
    assert.equal((await admin('/api/admin/login', { password: env.ADMIN_PASSWORD })).status, 200);
    assert.equal((await admin('/api/admin/products-bulk', { applyToAll: true, price30: 34.99 }, 'PUT')).status, 200);
    let roller = await Product.findOne({ id: 'DUFTROLLER' });
    assert.equal(roller.variants[30], undefined);
    assert.equal(roller.variants[6].price, 12.5);
    assert.equal((await admin('/api/admin/products-bulk', { ids: ['DUFTROLLER'], price30: 1 }, 'PUT')).status, 400);
    assert.equal((await admin('/api/admin/products/DUFTROLLER', { price30: 1 }, 'PUT')).status, 400);
    assert.equal((await admin('/api/admin/products/DUFTROLLER', { category: 'men' }, 'PUT')).status, 400);
    assert.equal((await admin('/api/admin/products/DUFTROLLER', { price6: 12.505 }, 'PUT')).status, 400);
    assert.equal((await admin('/api/admin/products/G1', { price6: 12.5 }, 'PUT')).status, 400);
    assert.equal((await admin('/api/admin/products/DUFTROLLER', { category: 'duftroller', price6: 13 }, 'PUT')).status, 200);
    assert.equal((await cart.calculate([items[0]])).subtotalCents, 2600);
    await Product.updateOne({ id: 'DUFTROLLER' }, { $set: { 'variants.6.price': 12.5 } });
});

test('upsert defaults to a catalog-only dry-run, rejects unconfirmed writes and safely updates only the roller', async () => {
    const childEnv = { ...process.env };
    delete childEnv.MONGO_URI; delete childEnv.DOTENV_CONFIG_PATH;
    const file = path.join(__dirname, '../scripts/upsert-duftroller.js');
    const dryRun = spawnSync(process.execPath, [file], { env: childEnv, encoding: 'utf8', windowsHide: true });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /"database": "not-connected"/);
    const emptyDatabaseName = 'note-test-duftroller-dry-run-empty';
    const emptyDatabase = mongoose.connection.getClient().db(emptyDatabaseName);
    assert.deepEqual(await emptyDatabase.listCollections({}, { nameOnly: true }).toArray(), []);
    const connectedDryRun = spawnSync(process.execPath, [file], { env: { ...childEnv, MONGO_URI: database.getUri(emptyDatabaseName) }, encoding: 'utf8', windowsHide: true });
    assert.equal(connectedDryRun.status, 0, connectedDryRun.stderr);
    assert.match(connectedDryRun.stdout, /"exists": false/);
    assert.deepEqual(await emptyDatabase.listCollections({}, { nameOnly: true }).toArray(), [], 'Connected dry-run must not create a collection or its indexes');
    const rejected = spawnSync(process.execPath, [file, '--apply'], { env: { ...childEnv, MONGO_URI: env.MONGO_URI }, encoding: 'utf8', windowsHide: true });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /--database und --host/);
    const target = new URL(env.MONGO_URI);
    const count = await Product.countDocuments({});
    await Product.updateOne({ id: 'DUFTROLLER' }, { $set: { 'variants.6.price': 13 } });
    const existingDryRun = spawnSync(process.execPath, [file], { env: { ...childEnv, MONGO_URI: env.MONGO_URI }, encoding: 'utf8', windowsHide: true });
    assert.equal(existingDryRun.status, 0, existingDryRun.stderr);
    assert.match(existingDryRun.stdout, /"exists": true/);
    assert.equal((await Product.findOne({ id: 'DUFTROLLER' })).variants[6].price, 13, 'Dry-run must not change an existing product');
    for (let run = 0; run < 2; run++) {
        const applied = spawnSync(process.execPath, [file, '--apply', '--host', target.host, '--database', target.pathname.slice(1)], { env: { ...childEnv, MONGO_URI: env.MONGO_URI }, encoding: 'utf8', windowsHide: true });
        assert.equal(applied.status, 0, applied.stderr);
    }
    assert.equal(await Product.countDocuments({}), count);
    assert.equal((await Product.findOne({ id: 'DUFTROLLER' })).variants[6].price, 12.5);
    assert.equal((await Product.findOne({ id: 'AUTODUFT' })).variants[30].price, 19.99);
});
