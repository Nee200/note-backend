const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
let database, server, base, app;
const stripe = {
    webhooks: new (require('stripe'))('sk_test_synthetic').webhooks,
    checkout: { sessions: {} }, coupons: {}, charges: {}, disputes: {}
};
const env = { NODE_ENV: 'test', JWT_SECRET: 'synthetic-test-secret-at-least-32-bytes', ADMIN_PASSWORD: 'synthetic-admin-password', FRONTEND_PUBLIC_URL: 'http://localhost:5500', BACKEND_PUBLIC_URL: 'http://localhost:4242', INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic' };
const User = require('../models/User'), Order = require('../models/Order'), Product = require('../models/Product');
const MailJob = require('../models/MailJob');
const Subscriber = require('../models/Subscriber');
const CheckoutRequest = require('../models/CheckoutRequest');
const WebhookEvent = require('../models/WebhookEvent');

before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.2.6' }, instance: { ip: '127.0.0.1', dbName: 'note-test-remediation' }, spawn: { windowsHide: true } });
    env.MONGO_URI = database.getUri('note-test-remediation');
    await mongoose.connect(env.MONGO_URI);
    app = require('../app').createApp({ env, stripe, mailProvider: { emails: { send: async () => ({ data: { id: 'synthetic-mail' } }) } } });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    await Product.create({ id: 'G1', name: 'NØTE. G1', category: 'men', variants: { 30: { price: 9.5 }, 50: { price: 20 } }, images: ['images_parfume/parfume_mann.png'] });
    await app.locals.refreshProductCache();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (database) await database.stop();
});
beforeEach(async () => { await require('../models/RateLimit').deleteMany({}); });

function client() {
    const cookies = new Map();
    async function raw(path, options = {}) {
        const response = await fetch(base + path, { ...options, headers: { Origin: 'http://localhost:5500', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers } });
        for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
        return response;
    }
    async function call(path, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
        let token;
        if (!['GET', 'HEAD'].includes(method)) token = (await (await raw('/api/csrf-token')).json()).csrfToken;
        const response = await raw(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}), ...extra } });
        return { status: response.status, body: await response.json().catch(() => null), response };
    }
    return { cookies, raw, call };
}

test('legacy admin route returns 410 and leaves the actual HTTP process alive', async () => {
    assert.equal((await fetch(base + '/admin')).status, 410);
    assert.equal((await fetch(base + '/health')).status, 200);
});

test('unverified registration cannot claim guest orders; verified owner can, another account cannot', async () => {
    await Order.create({ email: 'guest@example.test', name: 'Synthetic Guest', amount: 950, address: { line1: 'Selbstabholung' }, items: [{ description: 'Example', quantity: 1, amount_total: 950 }] });
    const account = client();
    const registration = await account.call('/api/register', { email: 'guest@example.test', password: 'synthetic-password-123', name: 'Synthetic' });
    assert.equal(registration.status, 201); assert.equal(registration.body.authToken, undefined);
    assert.equal((await account.call('/api/user/orders')).status, 403);
    assert.equal((await account.call('/api/user/orders/claim', {})).status, 403);
    const mail = await MailJob.findOne({ key: /^verify:/ }).select('+payload');
    const token = mail.payload.html.match(/#verify=([a-f0-9]{64})/)[1];
    assert.equal((await client().call('/api/user/verify-email', { token })).status, 401);
    assert.equal((await account.call('/api/user/verify-email', { token })).status, 200);
    assert.equal((await account.call('/api/user/verify-email', { token })).status, 400);
    assert.equal((await account.call('/api/user/orders/claim', {})).body.claimed, 1);
    const orders = await account.call('/api/user/orders');
    assert.equal(orders.status, 200); assert.equal(orders.body.orders.length, 1);
    assert.equal(orders.body.orders[0].items[0].amount_total, 950);
    assert.equal(orders.body.orders[0].stripeSessionId, undefined);
    const second = client();
    await second.call('/api/register', { email: 'other@example.test', password: 'synthetic-password-456' });
    assert.equal((await second.call('/api/user/verify-email', { token })).status, 400);
    assert.equal((await second.call('/api/user/orders')).status, 403);
    const stolen = account.cookies.get('auth_token');
    assert.equal((await account.call('/api/logout', {})).status, 200);
    const replay = client(); replay.cookies.set('auth_token', stolen);
    assert.equal((await replay.call('/api/user')).status, 401);
});

test('an invalid explicit bulk selection never changes every product', async () => {
    const admin = client();
    assert.equal((await admin.call('/api/admin/login', { password: env.ADMIN_PASSWORD })).status, 200);
    const result = await admin.call('/api/admin/products-bulk', { ids: ['INVALID!'], price30: 1 }, 'PUT');
    assert.equal(result.status, 400);
    assert.equal((await Product.findOne({ id: 'G1' })).variants[30].price, 9.5);
});

test('all line-item pages must load and their subtotal must match Stripe', async () => {
    const { itemCents } = require('../services/orderData');
    assert.equal(itemCents({ stripeSessionId: 'cs_legacy' }, { amount_total: 9.5 }), 950);
    assert.equal(itemCents({ fulfillmentMethod: 'pickup' }, { amount_total: 950 }), 950);
    assert.equal(itemCents({ stripeSessionId: 'cs_legacy' }, { amount_total: null }), null);
    assert.equal(itemCents({ stripeSessionId: 'cs_legacy' }, { amount_total: 'invalid' }), null);
    assert.equal(itemCents({}, { amount_total: 950 }), null);
    const { listAllLineItems, assertCheckoutTotals } = require('../services/stripeData');
    const calls = [];
    const provider = { checkout: { sessions: { listLineItems: async (id, args) => { calls.push(args); return args.starting_after ? { data: [{ id: 'li_11', quantity: 1, amount_subtotal: 100 }], has_more: false } : { data: Array.from({ length: 10 }, (_, i) => ({ id: `li_${i + 1}`, quantity: 1, amount_subtotal: 100 })), has_more: true }; } } } };
    const items = await listAllLineItems(provider, 'cs_synthetic');
    assert.equal(items.length, 11); assert.equal(calls[1].starting_after, 'li_10');
    assert.throws(() => assertCheckoutTotals({ amount_subtotal: 1000, amount_total: 1000 }, items));
    assert.equal(assertCheckoutTotals({ amount_subtotal: 1100, amount_total: 1100 }, items).total, 1100);
});

async function webhook(event, signed = true) {
    const payload = JSON.stringify({ livemode: false, created: Math.floor(Date.now() / 1000), ...event });
    const signature = signed ? stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET }) : 'invalid';
    return fetch(base + '/webhook', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature } });
}
function syntheticSession(id, amount = 950) {
    return { id, created: Math.floor(Date.now() / 1000), status: 'complete', payment_status: 'paid', currency: 'eur', amount_subtotal: amount, amount_total: amount, total_details: { amount_discount: 0, amount_shipping: 0 }, metadata: {}, customer_details: { email: 'paid@example.test', name: 'Synthetic Buyer', address: { line1: 'Testweg 1', postal_code: '12345', city: 'Teststadt', country: 'DE' } }, payment_intent: { id: 'pi_' + id } };
}
test('signed webhook retries a failed order save, persists all 11 items once, and rejects forgery', async t => {
    const id = 'cs_test_eleven', session = syntheticSession(id, 10450);
    const items = Array.from({ length: 11 }, (_, i) => ({ id: 'li_' + i, description: 'NØTE. G1 (30ml)', quantity: 1, amount_subtotal: 950, currency: 'eur', price: { unit_amount: 950, product: { metadata: { productId: 'G1', variant: '30' } } } }));
    stripe.checkout.sessions.retrieve = async () => session;
    stripe.checkout.sessions.listLineItems = async (_id, args) => ({ data: args.starting_after ? items.slice(10) : items.slice(0, 10), has_more: !args.starting_after });
    const event = { id: 'evt_retry_order', type: 'checkout.session.async_payment_succeeded', data: { object: { id } } };
    assert.equal((await webhook(event, false)).status, 400);
    const save = Order.prototype.save;
    const injected = t.mock.method(Order.prototype, 'save', async function (...args) { if (this.stripeSessionId === id) throw new Error('synthetic database write failure'); return save.apply(this, args); });
    assert.equal((await webhook(event)).status, 503);
    assert.equal(await Order.countDocuments({ stripeSessionId: id }), 0);
    assert.equal((await WebhookEvent.findOne({ eventId: event.id })).status, 'pending');
    injected.mock.restore();
    assert.equal((await webhook(event)).status, 200);
    assert.equal((await webhook(event)).status, 200);
    const order = await Order.findOne({ stripeSessionId: id });
    assert.equal(order.items.length, 11); assert.equal(order.items[0].lineTotalCents, 950); assert.equal(order.items[0].productId, 'G1');
    assert.equal(await Order.countDocuments({ stripeSessionId: id }), 1);
    assert.equal(await MailJob.countDocuments({ key: `order-confirmation:${order._id}` }), 1);
    session.payment_status = 'unpaid';
    assert.equal((await webhook({ ...event, id: 'evt_old_completed', type: 'checkout.session.completed' })).status, 200);
    assert.equal((await Order.findById(order._id)).paymentStatus, 'paid');
});

test('missing line items never create an empty paid order', async () => {
    stripe.checkout.sessions.retrieve = async () => syntheticSession('cs_test_empty');
    stripe.checkout.sessions.listLineItems = async () => ({ data: [], has_more: false });
    assert.equal((await webhook({ id: 'evt_empty', type: 'checkout.session.completed', data: { object: { id: 'cs_test_empty' } } })).status, 503);
    assert.equal(await Order.countDocuments({ stripeSessionId: 'cs_test_empty' }), 0);
});

test('one coupon can be reserved by only one checkout; cash needs receipt and cannot ship unpaid', async () => {
    await Subscriber.create({ email: 'coupon@example.test', status: 'active', code: 'NOTE-SYNTHETIC', discount: 10 });
    const { reserveCoupon, releaseCoupon } = require('../services/couponService');
    const attempts = await Promise.allSettled([reserveCoupon('NOTE-SYNTHETIC', 'parallel-one'), reserveCoupon('NOTE-SYNTHETIC', 'parallel-two')]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const winner = await Subscriber.findOne({ code: 'NOTE-SYNTHETIC' });
    await releaseCoupon(winner.code, winner.reservationKey);
    const buyer = client(), key = 'synthetic-pickup-checkout-001';
    const body = { items: [{ id: 'G1-30', quantity: 1 }], customerEmail: 'pickup@example.test', customerName: 'Synthetic Pickup', couponCode: winner.code };
    const first = await buyer.call('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((await buyer.call('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key })).body.orderId, first.body.orderId);
    assert.equal(await Order.countDocuments({ checkoutRequestId: key }), 1);
    const admin = client(); await admin.call('/api/admin/login', { password: env.ADMIN_PASSWORD });
    const route = '/api/admin/orders/' + first.body.orderId;
    assert.equal((await admin.call(route + '/status', { status: 'abgeschlossen' }, 'PUT')).status, 409);
    assert.equal((await admin.call(route + '/confirm-cash', { receivedAmountCents: 855 })).status, 400);
    assert.equal((await admin.call(route + '/confirm-cash', { receivedAmountCents: 855, receiptReference: 'SYNTHETIC-RECEIPT-1' })).status, 200);
    assert.equal((await Subscriber.findOne({ code: winner.code })).used, true);
    assert.equal((await buyer.call('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key })).body.orderId, first.body.orderId);
    assert.equal((await admin.call(route + '/status', { status: 'abgeschlossen' }, 'PUT')).status, 200);
    assert.equal((await admin.call(route, {}, 'DELETE')).status, 409);
    assert.equal((await admin.call(route + '/cancel', {})).status, 409);
    assert.ok(await Order.findById(first.body.orderId));
});

test('mail provider errors remain retryable; a successful retry does not send again', async () => {
    let calls = 0;
    const service = require('../services/mailService').createMailService({ env, provider: { emails: { send: async () => (++calls === 1 ? { error: { name: 'synthetic-provider-error' } } : { data: { id: 'synthetic-accepted' } }) } } });
    const key = 'test:provider-retry';
    await assert.rejects(service.emails.send({ to: 'test@example.test', subject: 'Synthetic', html: 'Test' }, { idempotencyKey: key }));
    assert.equal((await MailJob.findOne({ key })).status, 'pending');
    await MailJob.updateOne({ key }, { $set: { nextAttemptAt: new Date(0) } });
    await service.deliver(key); await service.deliver(key);
    assert.equal(calls, 2); assert.equal((await MailJob.findOne({ key })).status, 'accepted');
});

test('newsletter DOI hashes tokens and one-click unsubscribe suppresses queued marketing', async () => {
    const visitor = client();
    assert.equal((await visitor.call('/api/newsletter', { email: 'newsletter@example.test' })).status, 200);
    const subscriber = await Subscriber.findOne({ email: 'newsletter@example.test' }).select('+confirmTokenHash');
    assert.equal(subscriber.status, 'pending'); assert.equal(subscriber.confirmToken, undefined);
    const confirmation = await MailJob.findOne({ key: new RegExp('^newsletter-confirm:' + subscriber._id) }).select('+payload');
    const token = confirmation.payload.html.match(/confirm\?token=([a-f0-9]{64})/)[1];
    assert.notEqual(token, subscriber.confirmTokenHash);
    const confirm = await visitor.raw('/api/newsletter/confirm?token=' + token, { redirect: 'manual' });
    assert.equal(confirm.status, 302); assert.match(confirm.headers.get('location'), /status=success/);
    const discount = await MailJob.findOne({ key: new RegExp('^newsletter-discount:' + subscriber._id) }).select('+payload');
    const unsubscribe = new URL(discount.payload.headers['List-Unsubscribe'].slice(1, -1));
    const response = await fetch(base + unsubscribe.pathname + unsubscribe.search, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(response.status, 200);
    await app.locals.mailService.deliver(discount.key);
    assert.equal((await MailJob.findOne({ key: discount.key })).status, 'suppressed');
    assert.equal((await Subscriber.findById(subscriber._id)).status, 'unsubscribed');
});

test('admin MFA rejects a reused time step and shared limiters count across instances', async () => {
    const { generateSecret, generate } = require('otplib');
    const secret = generateSecret(), otp = await generate({ secret });
    const authenticator = require('../services/adminAuth').createAdminAuthenticator({ NODE_ENV: 'production', ADMIN_ACCOUNTS_JSON: JSON.stringify([{ username: 'test-owner', password: env.ADMIN_PASSWORD, totpSecret: secret }]) });
    assert.equal(await authenticator.authenticate({ username: 'test-owner', password: env.ADMIN_PASSWORD, otp: 'invalid' }), null);
    assert.equal(await authenticator.authenticate({ username: 'test-owner', password: env.ADMIN_PASSWORD, otp }), 'test-owner');
    assert.equal(await authenticator.authenticate({ username: 'test-owner', password: env.ADMIN_PASSWORD, otp }), null);
    const { MongoRateStore } = require('../middleware/mongoRateStore');
    const a = new MongoRateStore('shared-test'), b = new MongoRateStore('shared-test');
    a.init({ windowMs: 1000 }); b.init({ windowMs: 1000 });
    const hits = await Promise.all([a.increment('synthetic-key'), b.increment('synthetic-key')]);
    assert.deepEqual(hits.map(hit => hit.totalHits).sort(), [1, 2]);
});

test('test configuration rejects production databases and dry runs without safe isolation', () => {
    const { validateEnvironment } = require('../config/environment');
    assert.throws(() => validateEnvironment({ ...env, MONGO_URI: 'mongodb://127.0.0.1:27017/production' }));
    assert.throws(() => validateEnvironment({ ...env, NODE_ENV: 'production', LOCAL_DEV_SAFE_MODE: 'true' }));
    assert.throws(() => validateEnvironment({ ...env, NODE_ENV: 'development', CHECKOUT_DRY_RUN: 'true' }));
    const production = { ...env, NODE_ENV: 'production', ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', PROXY_SHARED_SECRET: 'synthetic-proxy-secret-at-least-32-bytes', NEWSLETTER_UNSUBSCRIBE_SECRET: 'synthetic-newsletter-secret-at-least-32-bytes', FRONTEND_PUBLIC_URL: 'https://shop.invalid', BACKEND_PUBLIC_URL: 'https://backend.invalid', STRIPE_SECRET_KEY: 'sk_live_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic', RESEND_API_KEY: 're_synthetic' };
    const createApp = require('../app').createApp;
    assert.throws(() => createApp({ env: { ...production, STRIPE_SECRET_KEY: '<sk_live_secret>' }, stripe }), /Placeholder/);
    assert.throws(() => createApp({ env: { ...production, FRONTEND_PUBLIC_URL: 'http://shop.invalid' }, stripe }), /HTTPS-Origin/);
    assert.throws(() => createApp({ env: { ...production, STRIPE_SECRET_KEY: 'sk_test_synthetic' }, stripe }), /Provider-Schlüssel/);
});

test('an invoice already saved before an order-link failure is reused and relinked', async () => {
    const invoiceModel = require('../models/Invoice');
    const order = await Order.create({ schemaVersion: 2, email: 'invoice@example.test', amount: 1190, paymentStatus: 'paid', stripeSessionId: 'cs_test_link_repair' });
    const now = new Date();
    const invoice = await invoiceModel.create({ order: order._id, number: 'TEST-RE-LINK', issuedAt: now, serviceDate: now, paymentDate: now, orderReference: '#synthetic', subtotalGrossCents: 1190, totalNetCents: 1000, totalTaxCents: 190, totalGrossCents: 1190, vatRateBps: 1900, pdfFileName: 'synthetic.pdf', pdfData: Buffer.from('synthetic-test-only'), pdfByteLength: 19, pdfSha256: 'synthetic', pdfGeneratedAt: now });
    const { ensureInvoiceForOrder } = require('../services/invoiceService');
    assert.equal((await ensureInvoiceForOrder({ order, stripeClient: {} })).status, 'existing');
    const repaired = await Order.findById(order._id);
    assert.equal(String(repaired.invoice), String(invoice._id)); assert.equal(repaired.invoiceNumber, invoice.number);
    assert.equal(await invoiceModel.countDocuments({ order: order._id }), 1);
    await Order.updateOne({ _id: order._id }, { $set: { invoice: null, invoiceStatus: 'error' } });
    await require('../services/invoiceRepairService').createInvoiceRepairService({ enabled: true, stripe: {} }).processPending();
    assert.equal(String((await Order.findById(order._id)).invoice), String(invoice._id));
    assert.equal(await invoiceModel.countDocuments({ order: order._id }), 1);
    await Order.deleteOne({ _id: order._id }); // synthetic orphan for the diagnostic path
    const status = await require('../services/operationsStatus').operationsStatus(env);
    assert.equal(status.checks.find(check => check.id === 'invoice-links').count, 1);
});

test('CSRF cookies cannot be omitted and a logged-in token cannot be reused by another session', async () => {
    const account = client(); await account.call('/api/login', { email: 'guest@example.test', password: 'synthetic-password-123' });
    const token = (await account.call('/api/csrf-token')).body.csrfToken;
    const stranger = client();
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' };
    assert.equal((await stranger.raw('/api/logout', options)).status, 403);
    stranger.cookies.set('csrf_token', token);
    assert.equal((await stranger.raw('/api/logout', options)).status, 403);
    assert.equal((await account.call('/api/user')).status, 200);
    assert.match((await account.call('/api/csrf-token')).response.headers.get('cache-control'), /no-store/);
});

test('confirmed Stripe expiration releases the coupon and paid reconciliation recovers a missing webhook', async () => {
    const key = 'synthetic-expiration-request';
    await Subscriber.create({ email: 'expires@example.test', status: 'active', code: 'NOTE-EXPIRES', reservationKey: key });
    await CheckoutRequest.create({ key, mode: 'stripe', fingerprint: 'synthetic', status: 'open', stripeSessionId: 'cs_test_expired', couponCode: 'NOTE-EXPIRES', createdAt: new Date(Date.now() - 3600000) });
    stripe.checkout.sessions.retrieve = async () => ({ status: 'expired' });
    await app.locals.checkoutService.reconcileExpired();
    assert.equal((await Subscriber.findOne({ code: 'NOTE-EXPIRES' })).reservationKey, null);
    assert.equal((await CheckoutRequest.findOne({ key })).status, 'expired');
    const paidKey = 'synthetic-recovery-request', session = syntheticSession('cs_test_recovered'); session.metadata.checkoutRequestId = paidKey;
    await CheckoutRequest.create({ key: paidKey, mode: 'stripe', fingerprint: 'synthetic', status: 'open', stripeSessionId: session.id, createdAt: new Date(Date.now() - 3600000) });
    stripe.checkout.sessions.retrieve = async () => session;
    stripe.checkout.sessions.listLineItems = async () => ({ data: [{ id: 'li_recover', description: 'Test G1', quantity: 1, amount_subtotal: 950, currency: 'eur', price: { unit_amount: 950, product: { metadata: { productId: 'G1', variant: '30' } } } }], has_more: false });
    await app.locals.checkoutService.reconcileExpired();
    assert.equal((await Order.findOne({ stripeSessionId: session.id })).paymentStatus, 'paid');
    assert.equal((await CheckoutRequest.findOne({ key: paidKey })).paymentSettled, true);
});

test('refund and dispute events retain the highest refund and the canonical dispute status', async () => {
    const order = await Order.findOne({ stripeSessionId: 'cs_test_recovered' });
    const session = syntheticSession(order.stripeSessionId); session.payment_intent.id = order.stripePaymentIntentId;
    stripe.checkout.sessions.retrieve = async () => session;
    const refund = { id: 'evt_refund_1', type: 'charge.refunded', data: { object: { id: 'ch_synthetic', payment_intent: order.stripePaymentIntentId, amount_refunded: 500 } } };
    assert.equal((await webhook(refund)).status, 200);
    assert.equal((await Order.findById(order._id)).paymentStatus, 'partially_refunded');
    refund.id = 'evt_refund_old'; refund.data.object.amount_refunded = 100;
    assert.equal((await webhook(refund)).status, 200);
    assert.equal((await Order.findById(order._id)).refundedAmountCents, 500);
    stripe.charges.retrieve = async () => ({ payment_intent: order.stripePaymentIntentId }); stripe.disputes.retrieve = async () => ({ status: 'won' });
    assert.equal((await webhook({ id: 'evt_dispute_old', type: 'charge.dispute.created', data: { object: { id: 'dp_synthetic', charge: 'ch_synthetic', status: 'needs_response' } } })).status, 200);
    assert.equal((await Order.findById(order._id)).disputeStatus, 'won');
});

test('a cancelled pickup cannot be replayed as a successful checkout and its coupon can be reserved again', async () => {
    const buyer = client(), key = 'synthetic-pickup-cancelled';
    await Subscriber.create({ email: 'cancel@example.test', status: 'active', code: 'NOTE-CANCEL' });
    const body = { items: [{ id: 'G1-30', quantity: 1 }], customerEmail: 'cancel@example.test', customerName: 'Synthetic Cancel', couponCode: 'NOTE-CANCEL' };
    const first = await buyer.call('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key });
    assert.equal(first.status, 200);
    const admin = client(); await admin.call('/api/admin/login', { password: env.ADMIN_PASSWORD });
    assert.equal((await admin.call('/api/admin/orders/' + first.body.orderId + '/cancel', {})).status, 200);
    const replay = await buyer.call('/create-pickup-order', body, 'POST', { 'Idempotency-Key': key });
    assert.equal(replay.status, 409); assert.equal(replay.body.code, 'CHECKOUT_RESTART');
    assert.equal((await Subscriber.findOne({ code: 'NOTE-CANCEL' })).reservationKey, null);
    assert.equal((await require('../services/couponService').reserveCoupon('NOTE-CANCEL', 'synthetic-next-checkout')).reservationKey, 'synthetic-next-checkout');
    await assert.rejects(require('../services/couponService').redeemCoupon('NOTE-CANCEL', undefined));
    assert.equal((await Subscriber.findOne({ code: 'NOTE-CANCEL' })).used, false);
});

test('newsletter discount mail is recovered if enqueue fails after the consent was persisted', async () => {
    const visitor = client(); await visitor.call('/api/newsletter', { email: 'recover-newsletter@example.test' });
    const subscriber = await Subscriber.findOne({ email: 'recover-newsletter@example.test' });
    const mail = await MailJob.findOne({ key: new RegExp('^newsletter-confirm:' + subscriber._id) }).select('+payload');
    const token = mail.payload.html.match(/confirm\?token=([a-f0-9]{64})/)[1];
    const original = app.locals.mailService.enqueue;
    try {
        app.locals.mailService.enqueue = async () => { throw Error('synthetic enqueue outage'); };
        assert.equal((await visitor.raw('/api/newsletter/confirm?token=' + token, { redirect: 'manual' })).status, 500);
    } finally { app.locals.mailService.enqueue = original; }
    assert.equal((await Subscriber.findById(subscriber._id)).pendingDiscountMail, true);
    await app.locals.newsletterService.processPending(); await app.locals.newsletterService.processPending();
    assert.equal(await MailJob.countDocuments({ key: new RegExp('^newsletter-discount:' + subscriber._id) }), 1);
    assert.equal((await Subscriber.findById(subscriber._id)).pendingDiscountMail, false);
});

test('a stale invoice-side order save cannot overwrite a newer refund', async () => {
    const order = await Order.create({ amount: 950, schemaVersion: 2, paymentStatus: 'paid' });
    const stale = await Order.findById(order._id);
    order.refundedAmountCents = 950; order.paymentStatus = 'refunded'; await order.save();
    stale.invoiceStatus = 'generated'; stale.paymentStatus = 'paid'; stale.markModified('paymentStatus');
    await assert.rejects(stale.save(), error => error.name === 'VersionError');
    assert.equal((await Order.findById(order._id)).paymentStatus, 'refunded');
});
