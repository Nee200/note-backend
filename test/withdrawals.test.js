const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Withdrawal = require('../models/Withdrawal');
const MailJob = require('../models/MailJob');
let database, server, app, base, failMail = false;
const sent = [];
const env = { NODE_ENV: 'test', JWT_SECRET: 'synthetic-withdrawal-secret-at-least-32-bytes', ADMIN_PASSWORD: 'synthetic-withdrawal-admin-password', FRONTEND_PUBLIC_URL: 'http://localhost:5500', INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic' };
before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.2.6' }, instance: { ip: '127.0.0.1', dbName: 'note-test-withdrawals' }, spawn: { windowsHide: true } });
    env.MONGO_URI = database.getUri('note-test-withdrawals'); await mongoose.connect(env.MONGO_URI);
    app = require('../app').createApp({ env, stripe: { webhooks: {}, checkout: { sessions: {} } }, mailProvider: { emails: { send: async (payload, options) => { if (failMail) throw new Error('synthetic-provider-outage'); sent.push({ payload, options }); return { data: { id: 'synthetic-' + sent.length } }; } } } });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { failMail = false; sent.length = 0; await Promise.all([Withdrawal.deleteMany({}), MailJob.deleteMany({}), require('../models/RateLimit').deleteMany({}), require('../models/Session').deleteMany({})]); });
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
function client() {
    const cookies = new Map();
    async function raw(path, options = {}) {
        const response = await fetch(base + path, { ...options, headers: { Origin: 'http://localhost:5500', Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...options.headers } });
        for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], i = pair.indexOf('='); cookies.set(pair.slice(0,i), pair.slice(i+1)); }
        return response;
    }
    async function call(path, body) {
        const csrf = body === undefined ? '' : (await (await raw('/api/csrf-token')).json()).csrfToken;
        const response = await raw(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json(), response };
    }
    return { raw, call };
}
const input = () => ({ requestId: crypto.randomUUID(), name: 'Synthetic Customer', email: 'synthetic@example.test', contract: 'Bestellung am 1. Oktober: NØTE. G1, 50 ml', scope: 'full' });

test('guest receives a durable receipt and immediate full-content e-mail without order lookup or account', async () => {
    const guest = client(), body = input(), before = Date.now();
    const result = await guest.call('/api/withdrawals', body);
    assert.equal(result.status, 201); assert.equal(result.body.success, true); assert.equal(result.body.emailStatus, 'accepted');
    const receipt = result.body.receipt; assert.match(receipt.reference, /^WR-[A-F0-9]{24}$/);
    assert.ok(Date.parse(receipt.receivedAt) >= before); assert.ok(Date.parse(receipt.receivedAt) <= Date.now());
    assert.equal(receipt.contract, body.contract); assert.equal(receipt.scope, 'full'); assert.equal(receipt.requestId, undefined); assert.equal(receipt.payloadHash, undefined);
    assert.equal(await Withdrawal.countDocuments(), 1); assert.equal(await require('../models/Order').countDocuments(), 0);
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    assert.equal(sent.length, 2);
    const customer = sent.find(entry => entry.payload.to === body.email);
    for (const value of [receipt.name, receipt.email, receipt.contract, receipt.receivedAt, receipt.reference, receipt.declaration]) assert.ok(customer.payload.text.includes(value), value);
    assert.ok(customer.payload.html.includes(receipt.reference)); assert.ok(customer.payload.html.includes(receipt.receivedAt));
    assert.equal(await MailJob.countDocuments({ status: 'accepted' }), 2);
    assert.equal((await guest.raw('/api/withdrawals')).status, 404);
});

test('parallel repeated submissions preserve the original timestamp and create exactly one receipt and two messages', async () => {
    const guest = client(), body = input();
    const [first, second] = await Promise.all([guest.call('/api/withdrawals', body), guest.call('/api/withdrawals', body)]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
    assert.deepEqual(first.body.receipt, second.body.receipt); assert.equal(await Withdrawal.countDocuments(), 1);
    assert.equal(sent.length, 2); assert.equal(await MailJob.countDocuments(), 2);
    assert.equal((await guest.call('/api/withdrawals', { ...body, name: 'Changed Customer' })).status, 409);
    const replay = await guest.call('/api/withdrawals', body); assert.deepEqual(replay.body.receipt, first.body.receipt); assert.equal(sent.length, 2);
});

test('partial withdrawal preserves literal content safely in e-mails and rejects missing or invalid fields', async () => {
    const guest = client(), body = { ...input(), name: '<img src=x onerror=alert(1)>', scope: 'partial', items: '1 × <script>alert(2)</script>\nG1, 50 ml' };
    const result = await guest.call('/api/withdrawals', body); assert.equal(result.status, 201); assert.equal(result.body.receipt.items, body.items);
    const mail = sent.find(entry => entry.payload.to === body.email).payload;
    assert.ok(mail.text.includes(body.items)); assert.ok(!mail.html.includes('<script>alert(2)</script>')); assert.ok(mail.html.includes('&lt;script&gt;'));
    assert.ok(!mail.html.includes('<img src=x'));
    for (const changes of [{ name: {} }, { contract: { $ne: '' } }, { email: 'bad\r\n@example.test' }, { scope: 'other' }, { items: '' }, { items: 'x'.repeat(2001) }, { requestId: 'not-a-uuid' }]) {
        assert.equal((await guest.call('/api/withdrawals', { ...body, requestId: crypto.randomUUID(), ...changes })).status, 400);
    }
    assert.equal(await Withdrawal.countDocuments(), 1);
});

test('trusted origin and CSRF are required; rate limiting is independent of other forms', async () => {
    const guest = client(), body = input();
    assert.equal((await guest.raw('/api/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
    const csrf = (await (await guest.raw('/api/csrf-token')).json()).csrfToken;
    assert.equal((await guest.raw('/api/withdrawals', { method: 'POST', headers: { Origin: 'https://untrusted.example.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })).status, 403);
    for (let i = 0; i < 18; i++) await guest.call('/api/withdrawals', { ...body, name: '' });
    assert.equal((await guest.call('/api/withdrawals', body)).status, 429); assert.equal(await Withdrawal.countDocuments(), 0);
});

test('mail outage retains receipt, schedules retry and never converts the declaration into a failed request', async () => {
    failMail = true; const guest = client(), body = input();
    const result = await guest.call('/api/withdrawals', body); assert.equal(result.status, 201); assert.equal(result.body.emailStatus, 'pending');
    assert.equal(await Withdrawal.countDocuments(), 1); assert.equal(await MailJob.countDocuments({ status: 'pending' }), 2);
    failMail = false; await MailJob.updateMany({}, { $set: { nextAttemptAt: new Date() } }); await app.locals.mailService.processPending();
    assert.equal(await MailJob.countDocuments({ status: 'accepted' }), 2); assert.equal(sent.length, 2);
    assert.deepEqual((await guest.call('/api/withdrawals', body)).body.receipt, result.body.receipt); assert.equal(sent.length, 2);
});

test('outbox creation failure is repaired from the persisted flag after restart', async () => {
    const original = app.locals.mailService.enqueue;
    app.locals.mailService.enqueue = async () => { throw new Error('synthetic-outbox-failure'); };
    let result;
    try { result = await client().call('/api/withdrawals', input()); } finally { app.locals.mailService.enqueue = original; }
    assert.equal(result.status, 201); assert.equal(result.body.emailStatus, 'pending'); assert.equal(await Withdrawal.countDocuments({ mailQueued: false }), 1);
    await app.locals.withdrawalService.processPending(); await app.locals.mailService.processPending();
    assert.equal(await Withdrawal.countDocuments({ mailQueued: true }), 1); assert.equal(await MailJob.countDocuments({ status: 'accepted' }), 2); assert.equal(sent.length, 2);
});

test('only authenticated admins can list and change case status; reopening cancels deletion and orders remain untouched', async () => {
    const guest = client(), admin = client(), result = await guest.call('/api/withdrawals', input());
    assert.equal((await guest.call('/api/admin/withdrawals')).status, 401);
    const record = await Withdrawal.findOne();
    assert.equal((await guest.call('/api/admin/withdrawals/' + record._id + '/status', { status: 'completed' })).status, 401);
    assert.equal((await admin.call('/api/admin/login', { password: env.ADMIN_PASSWORD })).status, 200);
    const list = await admin.call('/api/admin/withdrawals'); assert.equal(list.status, 200); assert.equal(list.body.withdrawals[0].reference, result.body.receipt.reference);
    assert.equal(list.body.withdrawals[0].mailStatus.customer, 'accepted'); assert.equal(list.body.withdrawals[0].requestId, undefined);
    const path = '/api/admin/withdrawals/' + record._id + '/status';
    assert.equal((await admin.raw(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) })).status, 403);
    assert.equal((await admin.call(path, { status: 'invalid' })).status, 400);
    assert.equal((await admin.call(path, { status: 'completed' })).status, 200);
    assert.ok((await Withdrawal.findById(record._id)).purgeAt instanceof Date);
    assert.equal((await admin.call(path, { status: 'processing' })).status, 200);
    assert.equal((await Withdrawal.findById(record._id)).purgeAt, undefined);
    const audit = await require('../models/AdminAudit').findOne({ target: '/withdrawals/' + record._id + '/status' }); assert.ok(audit);
    assert.equal(await require('../models/Order').countDocuments(), 0);
});
