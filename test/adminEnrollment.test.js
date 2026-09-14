const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { generate } = require('otplib');
const { createAdminEnrollment } = require('../services/adminEnrollment');
const Account = require('../models/AdminAccount');
let database, server, base, service;
const env = { NODE_ENV: 'test', JWT_SECRET: 'synthetic-enrollment-key-with-at-least-32-bytes', ADMIN_PASSWORD: 'synthetic-administrator-password', FRONTEND_PUBLIC_URL: 'http://localhost:5500', INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic' };
before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.2.6' }, instance: { ip: '127.0.0.1', dbName: 'note-test-enrollment' }, spawn: { windowsHide: true } });
    env.MONGO_URI = database.getUri('note-test-enrollment'); await mongoose.connect(env.MONGO_URI);
    const app = require('../app').createApp({ env, stripe: { webhooks: {}, checkout: { sessions: {} } }, mailProvider: { emails: { send: async () => ({ data: { id: 'test' } }) } } });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
    service = createAdminEnrollment({ secret: env.JWT_SECRET, reserved: name => name === 'owner' });
});
beforeEach(async () => { await Account.deleteMany({}); await require('../models/RateLimit').deleteMany({}); await require('../models/Session').deleteMany({}); });
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
    return { cookies, raw, call };
}
const resetLimits = () => require('../models/RateLimit').deleteMany({});

test('HTTP enrollment grants no admin access until a new password and valid authenticator are confirmed', async () => {
    const admin = client(), operator = client(), stranger = client();
    assert.equal((await stranger.call('/api/admin/access/invite', { username: 'betreiber' })).status, 401);
    assert.equal((await admin.call('/api/admin/login', { password: env.ADMIN_PASSWORD })).status, 200);
    const invite = await admin.call('/api/admin/access/invite', { username: 'betreiber' });
    assert.equal(invite.status, 201); assert.equal(invite.body.oneTimePassword.length, 24);
    const begun = await operator.call('/api/admin/login', { username: 'betreiber', password: invite.body.oneTimePassword });
    assert.equal(begun.status, 200); assert.equal(begun.body.setupRequired, true); assert.ok(begun.response.headers.getSetCookie().some(cookie => cookie.startsWith('admin_setup=') && cookie.includes('HttpOnly')));
    assert.equal((await operator.call('/api/admin/check')).status, 401);
    assert.equal((await operator.call('/api/admin/orders')).status, 401);
    assert.equal((await stranger.call('/api/admin/setup')).status, 401);
    assert.equal((await stranger.call('/api/admin/login', { username: 'betreiber', password: invite.body.oneTimePassword })).status, 401);
    await resetLimits();
    assert.equal((await operator.raw('/api/admin/setup/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new-synthetic-password-123' }) })).status, 403);
    assert.equal((await operator.call('/api/admin/setup/password', { password: invite.body.oneTimePassword })).status, 400);
    assert.equal((await operator.call('/api/admin/setup/password', { password: 'short' })).status, 400);
    const mfa = await operator.call('/api/admin/setup/password', { password: 'new-synthetic-password-123' });
    assert.equal(mfa.status, 200); assert.equal(mfa.body.step, 'mfa'); assert.match(mfa.body.qr, /^data:image\/png;base64,/); assert.match(mfa.body.uri, /^otpauth:\/\/totp\//);
    const stored = await Account.findOne({ username: 'betreiber' }).select('+totpEncrypted +passwordHash +invitationHash').lean();
    assert.notEqual(stored.totpEncrypted, mfa.body.secret); assert.notEqual(stored.passwordHash, 'new-synthetic-password-123'); assert.equal(stored.invitationHash, undefined);
    assert.equal((await operator.call('/api/admin/check')).status, 401);
    assert.equal((await operator.call('/api/admin/setup/confirm', { otp: 'invalid' })).status, 400);
    await resetLimits();
    const previousOtp = await generate({ secret: mfa.body.secret, epoch: Math.floor(Date.now()/1000) - 30 });
    assert.equal((await operator.call('/api/admin/setup/confirm', { otp: previousOtp })).status, 200);
    assert.equal((await operator.call('/api/admin/check')).status, 200);
    assert.equal((await operator.call('/api/admin/setup')).status, 401);
    assert.equal((await operator.call('/api/admin/setup/confirm', { otp: previousOtp })).status, 401);
    const listed = await admin.call('/api/admin/access'); assert.equal(listed.body.accounts[0].status, 'active');
    for (const field of ['secret','passwordHash','totpEncrypted','setupHash','invitationHash','credentialVersion']) assert.equal(listed.body.accounts[0][field], undefined);
    assert.equal((await operator.call('/api/admin/logout', {})).status, 200);
    assert.equal((await operator.call('/api/admin/check')).status, 401);
    await resetLimits();
    assert.equal((await operator.call('/api/admin/login', { username: 'betreiber', password: invite.body.oneTimePassword, otp: await generate({ secret: mfa.body.secret }) })).status, 401);
    assert.equal((await operator.call('/api/admin/login', { username: 'betreiber', password: 'new-synthetic-password-123' })).status, 401);
    const currentOtp = await generate({ secret: mfa.body.secret });
    assert.equal((await operator.call('/api/admin/login', { username: 'betreiber', password: 'new-synthetic-password-123', otp: currentOtp })).status, 200);
    assert.equal((await stranger.call('/api/admin/login', { username: 'betreiber', password: 'new-synthetic-password-123', otp: currentOtp })).status, 401);
    assert.equal((await admin.call('/api/admin/check')).status, 200);
});

test('one-time password is claimed atomically; renewal invalidates old passwords and setup sessions', async () => {
    const invite = await service.invite('betreiber', 'owner');
    const attempts = await Promise.all([service.begin('betreiber', invite.oneTimePassword), service.begin('betreiber', invite.oneTimePassword)]);
    assert.equal(attempts.filter(Boolean).length, 1);
    const token = attempts.find(Boolean);
    const renewed = await service.invite('betreiber', 'owner', true);
    await assert.rejects(service.status(token), error => error.status === 401);
    assert.equal(await service.begin('betreiber', invite.oneTimePassword), null);
    const next = await service.begin('betreiber', renewed.oneTimePassword);
    assert.ok(next);
    await Account.updateOne({ username: 'betreiber' }, { $set: { setupExpiresAt: new Date(0) } });
    await assert.rejects(service.setPassword(next, 'new-synthetic-password-123'), error => error.status === 401);
    await assert.rejects(service.invite('owner', 'owner'), error => error.status === 400);
});

test('expired invitations and brute-forced setup cannot activate; cancellation revokes setup', async () => {
    const invite = await service.invite('expired', 'owner');
    await Account.updateOne({ username: 'expired' }, { $set: { invitationExpiresAt: new Date(0) } });
    assert.equal(await service.begin('expired', invite.oneTimePassword), null);
    const next = await service.invite('limited', 'owner');
    const token = await service.begin('limited', next.oneTimePassword);
    const mfa = await service.setPassword(token, 'new-synthetic-password-123');
    for (let i=0;i<10;i++) await assert.rejects(service.confirm(token, 'bad'), error => error.status === 400);
    await assert.rejects(service.confirm(token, await generate({ secret: mfa.secret })), error => error.status === 401);
    assert.equal(await service.fingerprint('limited'), '');
    await service.cancel(token); await assert.rejects(service.status(token), error => error.status === 401);
});

test('activation is atomic and survives a new service instance; active accounts cannot be overwritten by invitations', async () => {
    const invite = await service.invite('durable', 'owner'), token = await service.begin('durable', invite.oneTimePassword);
    const mfa = await service.setPassword(token, 'new-synthetic-password-123');
    const otp = await generate({ secret: mfa.secret, epoch: Math.floor(Date.now()/1000)-30 });
    const attempts = await Promise.allSettled([service.confirm(token, otp), service.confirm(token, otp)]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(service.invite('durable', 'owner', true), error => error.status === 409);
    const restarted = createAdminEnrollment({ secret: env.JWT_SECRET });
    assert.equal(await restarted.authenticate('durable', 'new-synthetic-password-123', await generate({ secret: mfa.secret })), 'durable');
    assert.ok(await restarted.fingerprint('durable'));
});
