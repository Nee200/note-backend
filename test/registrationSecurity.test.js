const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Session = require('../models/Session');
const RegistrationRequest = require('../models/RegistrationRequest');
const MailJob = require('../models/MailJob');
const RateLimit = require('../models/RateLimit');

let database, server, base;
const password = 'synthetic-registration-password-123';
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const env = {
    NODE_ENV: 'test', JWT_SECRET: 'synthetic-registration-test-secret-over-32-bytes',
    ADMIN_PASSWORD: 'synthetic-registration-admin-password',
    FRONTEND_PUBLIC_URL: 'http://localhost:5500', BACKEND_PUBLIC_URL: 'http://localhost:4242',
    INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic'
};

before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.0.34' }, instance: { ip: '127.0.0.1', dbName: 'note-test-registration-security' }, spawn: { windowsHide: true } });
    env.MONGO_URI = database.getUri('note-test-registration-security');
    await mongoose.connect(env.MONGO_URI);
    const app = require('../app').createApp({
        env,
        stripe: { checkout: { sessions: {} }, webhooks: {}, coupons: {}, charges: {}, disputes: {} },
        mailProvider: { emails: { send: async () => ({ data: { id: 'synthetic-registration-mail' } }) } }
    });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
    await Promise.all([User, Session, RegistrationRequest, MailJob, RateLimit].map(model => model.deleteMany({})));
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (database) await database.stop();
});

function client() {
    const cookies = new Map();
    async function raw(path, options = {}) {
        const response = await fetch(base + path, { ...options, headers: {
            Origin: 'http://localhost:5500', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers
        } });
        for (const cookie of response.headers.getSetCookie()) {
            const pair = cookie.split(';')[0], index = pair.indexOf('=');
            cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
        return response;
    }
    async function call(path, body) {
        const token = body === undefined ? null : (await (await raw('/api/csrf-token')).json()).csrfToken;
        const response = await raw(path, { method: body === undefined ? 'GET' : 'POST',
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) }
        });
        return { status: response.status, body: await response.json(), response };
    }
    return { cookies, raw, call };
}

async function mailboxTokens(email) {
    const mails = await MailJob.find({ 'payload.to': email, key: /^register:/ }).select('+payload').sort({ createdAt: 1 });
    return mails.map(mail => {
        const match = mail.payload.html.match(/http:\/\/localhost:5500\/account\.html#register=([a-f0-9]{64})/);
        assert.ok(match, 'registration mail uses a fixed shop origin and a 256-bit token in the URL fragment');
        return match[1];
    });
}

test('new and existing addresses receive identical registration responses without authentication or password changes', async () => {
    const originalHash = await bcrypt.hash(password, 12);
    const existing = await User.create({ email: 'existing@example.test', password: originalHash, name: 'Existing', emailVerifiedAt: new Date() });
    const stranger = client(), newcomer = client();
    const known = await stranger.call('/api/register', { email: existing.email, name: 'Untrusted replacement', password: 'attacker-chosen-password' });
    const unknown = await newcomer.call('/api/register', { email: 'new@example.test', name: 'New person', password: 'attacker-chosen-password' });
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(known.body, unknown.body);
    assert.deepEqual(known.response.headers.getSetCookie(), unknown.response.headers.getSetCookie());
    assert.equal(stranger.cookies.has('auth_token'), false);
    assert.equal(newcomer.cookies.has('auth_token'), false);
    assert.equal(await User.countDocuments({}), 1);
    assert.equal(await Session.countDocuments({}), 0);
    assert.equal((await User.findById(existing._id)).password, originalHash);
    assert.equal((await User.findById(existing._id)).name, 'Existing');
    assert.equal((await newcomer.call('/api/login', { email: 'new@example.test', password: 'attacker-chosen-password' })).status, 401);
    assert.equal((await stranger.call('/api/login', { email: existing.email, password: 'attacker-chosen-password' })).status, 401);
    const mails = await MailJob.find({ key: /^register:/ }).select('+payload');
    assert.equal(mails.length, 2);
    assert.equal(mails[0].payload.subject, mails[1].payload.subject);
    assert.equal(mails[0].payload.html.replace(/register=[a-f0-9]{64}/g, 'register=TOKEN'), mails[1].payload.html.replace(/register=[a-f0-9]{64}/g, 'register=TOKEN'));
    for (const email of [existing.email, 'new@example.test']) {
        const [token] = await mailboxTokens(email);
        const pending = await RegistrationRequest.findOne({ email }).select('+tokenHash').lean();
        assert.equal(pending.tokenHash, digest(token));
        assert.equal(JSON.stringify(pending).includes(token), false, 'pending registrations do not store plaintext tokens');
        assert.equal(pending.password, undefined, 'a request cannot preselect the eventual account password');
        assert.ok(pending.expiresAt.getTime() > Date.now() && pending.expiresAt.getTime() <= Date.now() + 86400000);
        assert.equal(JSON.stringify(unknown.body).includes(token), false);
    }
});

test('mailbox confirmation creates one verified account with the owner-chosen password and a cookie session', async () => {
    const account = client(), email = 'owner@example.test';
    const registration = await account.call('/api/register', { email: ` ${email.toUpperCase()} `, name: 'Synthetic Owner', password: 'untrusted-request-password' });
    assert.equal(registration.status, 202);
    assert.equal((await account.call('/api/user')).status, 401);
    const [token] = await mailboxTokens(email);
    const confirmed = await account.call('/api/register/confirm', { token, password });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.user.email, email);
    assert.equal(confirmed.body.user.emailVerified, true);
    assert.equal(confirmed.body.user.name, 'Synthetic Owner');
    assert.equal(confirmed.body.user.password, undefined);
    assert.equal(confirmed.body.authToken, undefined);
    assert.ok(confirmed.response.headers.getSetCookie().some(cookie => /^auth_token=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
    assert.equal((await account.call('/api/user')).status, 200);
    assert.equal(await RegistrationRequest.countDocuments({ tokenHash: digest(token) }), 0);
    const user = await User.findOne({ email });
    assert.ok(await bcrypt.compare(password, user.password));
    assert.equal(await bcrypt.compare('untrusted-request-password', user.password), false);
    assert.equal((await client().call('/api/login', { email, password })).status, 200);
});

test('unknown and existing login addresses both perform a password check and return the same failure', async t => {
    const existingHash = await bcrypt.hash(password, 12);
    await User.create({ email: 'login-existing@example.test', password: existingHash });
    const compare = bcrypt.compare;
    const checks = [];
    t.mock.method(bcrypt, 'compare', async function (candidate, storedHash, ...rest) {
        checks.push({ candidate, storedHash });
        return compare.call(this, candidate, storedHash, ...rest);
    });
    const known = await client().call('/api/login', { email: 'login-existing@example.test', password: 'wrong-synthetic-password' });
    const unknown = await client().call('/api/login', { email: 'login-unknown@example.test', password: 'wrong-synthetic-password' });
    assert.equal(known.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(known.body, unknown.body);
    assert.deepEqual(known.response.headers.getSetCookie(), unknown.response.headers.getSetCookie());
    assert.equal(checks.length, 2, 'both paths must pay the same expensive password-check cost');
    assert.equal(checks[0].candidate, checks[1].candidate);
    assert.equal(checks[0].storedHash, existingHash);
    assert.notEqual(checks[1].storedHash, existingHash);
    assert.equal(bcrypt.getRounds(checks[0].storedHash), bcrypt.getRounds(checks[1].storedHash));
    assert.ok(bcrypt.getRounds(checks[1].storedHash) >= 12);
});

test('a token for an existing account cannot overwrite its password, profile or sessions', async () => {
    const email = 'protected@example.test', originalHash = await bcrypt.hash(password, 12);
    const existing = await User.create({ email, password: originalHash, name: 'Original owner', emailVerifiedAt: new Date(), sessionVersion: 7 });
    const originalSession = client();
    assert.equal((await originalSession.call('/api/login', { email, password })).status, 200);
    const outsider = client();
    assert.equal((await outsider.call('/api/register', { email, name: 'Replacement' })).status, 202);
    const [token] = await mailboxTokens(email);
    const confirmed = await outsider.call('/api/register/confirm', { token, password: 'replacement-synthetic-password' });
    assert.equal(confirmed.status, 409);
    assert.equal(outsider.cookies.has('auth_token'), false);
    const after = await User.findById(existing._id);
    assert.equal(after.password, originalHash);
    assert.equal(after.name, 'Original owner');
    assert.equal(after.sessionVersion, 7);
    assert.equal((await originalSession.call('/api/user')).status, 200);
    assert.equal((await outsider.call('/api/register/confirm', { token, password })).status, 400);
    assert.equal(await User.countDocuments({ email }), 1);
});

test('invalid passwords do not burn a valid mailbox token, while expired or forged tokens never create a user', async () => {
    const account = client(), email = 'validation@example.test';
    await account.call('/api/register', { email });
    const [token] = await mailboxTokens(email);
    for (const invalidPassword of ['short', 'ä'.repeat(37), { $ne: null }]) {
        assert.equal((await account.call('/api/register/confirm', { token, password: invalidPassword })).status, 400);
        assert.equal(await RegistrationRequest.countDocuments({ tokenHash: digest(token) }), 1);
    }
    for (const invalidToken of ['not-a-token', 'f'.repeat(64), { $ne: null }]) {
        assert.equal((await account.call('/api/register/confirm', { token: invalidToken, password })).status, 400);
    }
    await RegistrationRequest.updateOne({ tokenHash: digest(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await account.call('/api/register/confirm', { token, password })).status, 400);
    assert.equal(await User.countDocuments({ email }), 0);
    assert.equal(await Session.countDocuments({}), 0);
});

test('concurrent replay of one mailbox token creates exactly one authenticated account', async () => {
    const email = 'one-token-race@example.test';
    await client().call('/api/register', { email });
    const [token] = await mailboxTokens(email);
    const browsers = [client(), client(), client()];
    const attempts = await Promise.all(browsers.map(browser => browser.call('/api/register/confirm', { token, password })));
    assert.deepEqual(attempts.map(result => result.status).sort(), [201, 400, 400]);
    assert.equal(await User.countDocuments({ email }), 1);
    assert.equal(await Session.countDocuments({}), 1);
    assert.equal(browsers.filter(browser => browser.cookies.has('auth_token')).length, 1);
    assert.equal((await client().call('/api/register/confirm', { token, password })).status, 400);
});

test('concurrent different mailbox tokens for one address cannot create duplicate users or replace a winning password', async () => {
    const email = 'two-token-race@example.test';
    await client().call('/api/register', { email, name: 'First request' });
    await client().call('/api/register', { email, name: 'Second request' });
    const tokens = await mailboxTokens(email);
    assert.equal(tokens.length, 2);
    assert.notEqual(tokens[0], tokens[1]);
    const passwords = ['first-synthetic-owner-password', 'second-synthetic-owner-password'];
    const attempts = await Promise.all(tokens.map((token, index) => client().call('/api/register/confirm', { token, password: passwords[index] })));
    assert.deepEqual(attempts.map(result => result.status).sort(), [201, 409]);
    const winner = attempts.findIndex(result => result.status === 201);
    assert.equal(await User.countDocuments({ email }), 1);
    assert.equal(await Session.countDocuments({}), 1);
    const user = await User.findOne({ email });
    assert.equal(await bcrypt.compare(passwords[winner], user.password), true);
    assert.equal(await bcrypt.compare(passwords[1 - winner], user.password), false);
});

test('registration and confirmation enforce origin and CSRF before issuing mail or consuming a token', async () => {
    const account = client(), email = 'csrf@example.test';
    const rejected = await account.raw('/api/register', { method: 'POST', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(rejected.status, 403);
    assert.equal(await MailJob.countDocuments({}), 0);
    await account.call('/api/register', { email });
    const [token] = await mailboxTokens(email);
    const csrf = (await (await account.raw('/api/csrf-token')).json()).csrfToken;
    const crossOrigin = await account.raw('/api/register/confirm', { method: 'POST', body: JSON.stringify({ token, password }), headers: {
        Origin: 'https://foreign.example.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf
    } });
    assert.equal(crossOrigin.status, 403);
    assert.equal(await RegistrationRequest.countDocuments({ tokenHash: digest(token) }), 1);
    assert.equal(await User.countDocuments({}), 0);
});

test('the registration mail path remains bounded by the shared authentication rate limit', async () => {
    const account = client();
    const statuses = [];
    for (let index = 0; index < 11; index++) {
        statuses.push((await account.call('/api/register', { email: 'rate-limit@example.test' })).status);
    }
    assert.deepEqual(statuses, [...Array(10).fill(202), 429]);
    assert.equal(await RegistrationRequest.countDocuments({}), 10);
    assert.equal(await MailJob.countDocuments({}), 10);
    assert.equal(await User.countDocuments({}), 0);
});
