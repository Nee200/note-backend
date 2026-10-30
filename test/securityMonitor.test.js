const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { inventory, npmAdvisories, osvAdvisories, nodeRelease, deployedFrontend, nvdMatches, databaseAccess, createReader } = require('../services/securitySources');
const { publicSource, saveSource, createSecurityMonitor } = require('../services/securityMonitor');
const SecurityStatus = require('../models/SecurityStatus');
const lock = { lockfileVersion: 3, packages: { '': { dependencies: { demo: '^1.0.0' }, devDependencies: { builder: '^2.0.0' } }, 'node_modules/demo': { version: '1.0.0' }, 'node_modules/builder': { version: '2.0.0', dev: true } } };

test('npm scan includes build dependencies and matches affected installed versions', async () => {
    const inv = inventory(lock, 'test revision');
    assert.equal(inv.packages.find(pkg => pkg.name === 'builder').scope, 'build/test');
    const result = await npmAdvisories(inv, async (_, { body }) => {
        assert.deepEqual(body.builder, ['2.0.0']);
        return JSON.stringify({ builder: [{ id: 1, title: 'Test finding', vulnerable_versions: '<2.1.0', severity: 'high' }], demo: [{ id: 2, vulnerable_versions: '<1.0.0' }] });
    });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].package, 'builder');
    await assert.rejects(npmAdvisories(inv, async () => JSON.stringify({ demo: [{ vulnerable_versions: 'unparseable' }] })));
});

test('OSV follows individual query pagination, verifies details and rejects incomplete answers', async () => {
    let batches = 0;
    const inv = inventory(lock, 'revision');
    const result = await osvAdvisories(inv, async (url, options) => {
        if (url.endsWith('querybatch')) {
            if (++batches === 1) return JSON.stringify({ results: [{ next_page_token: 'page2' }, {}] });
            assert.equal(options.body.queries[0].page_token, 'page2');
            return JSON.stringify({ results: [{ vulns: [{ id: 'GHSA-test' }] }] });
        }
        return JSON.stringify({ id: 'GHSA-test', summary: 'Test', database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'demo' }, ranges: [{ events: [{ fixed: '1.1.0' }] }] }] });
    });
    assert.equal(batches, 2); assert.equal(result.findings[0].severity, 'high'); assert.match(result.findings[0].detail, /1.1.0/);
    await assert.rejects(osvAdvisories(inv, async () => '{"results":[]}'), /unvollständig/);
    await assert.rejects(osvAdvisories(inv, async () => '{"results":[{"error":"unavailable"},{}]}'), /unvollständig/);
});

test('frontend inventory must match the public build commit and lock hash', async () => {
    const raw = JSON.stringify(lock);
    const meta = { schemaVersion: 1, commit: 'a'.repeat(40), lockSha256: require('node:crypto').createHash('sha256').update(raw).digest('hex'), nodeVersion: '24.22.1' };
    const inv = await deployedFrontend(async url => url.endsWith('.json') && url.includes('security-build-info') ? JSON.stringify(meta) : raw);
    assert.match(inv.target, /a{40}/);
    await assert.rejects(deployedFrontend(async url => url.includes('security-build-info') ? JSON.stringify(meta) : raw + ' '), /passt nicht/);
});

test('Node distinguishes new major versions, same-branch security patches and EOL', () => {
    const rows = [{ version: 'v26.0.0', security: true }, { version: 'v24.22.1', security: true }];
    const schedule = { v24: { end: '2028-04-30' } };
    assert.equal(nodeRelease('24.22.1', rows, schedule, Date.parse('2026-10-21')).findings.length, 0);
    assert.equal(nodeRelease('24.22.0', rows, schedule, Date.parse('2026-10-21')).findings.length, 1);
    assert.equal(nodeRelease('24.22.1', rows, schedule, Date.parse('2029-10-21')).findings.length, 1);
});

test('NVD platform prerequisites are not misreported as vulnerabilities in that platform', async () => {
    const result = await nvdMatches('node', '24.22.1', async () => JSON.stringify({ totalResults: 2, vulnerabilities: [
        { cve: { id: 'CVE-next-only', configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: false, criteria: 'cpe:2.3:a:nodejs:node.js:*:*:*:*:*:*:*:*' }, { vulnerable: true, criteria: 'cpe:2.3:a:vercel:next.js:12.0.0:*:*:*:*:*:*:*' }] }] }] } },
        { cve: { id: 'CVE-node', configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:nodejs:node.js:*:*:*:*:*:*:*:*' }] }] }] } }
    ] }));
    assert.deepEqual(result.findings.map(row => row.id), ['CVE-node']);
    assert.equal(result.findings[0].state, 'review');
});

test('scanner rejects arbitrary hosts, HTTP, redirects and oversized source bodies', async () => {
    let calls = 0;
    const read = createReader(async (_, options) => { calls++; assert.equal(options.redirect, 'error'); return new Response('123456789'); });
    for (const url of ['http://registry.npmjs.org/', 'https://127.0.0.1/', 'https://registry.npmjs.org.evil.test/', 'https://user:password@registry.npmjs.org/']) await assert.rejects(read(url), /nicht erlaubt/);
    assert.equal(calls, 0);
    await assert.rejects(read('https://registry.npmjs.org/example', { maxBytes: 3 }), /Größenlimit/);
});

test('MongoDB flags broad runtime roles and accepts readWrite only on the application database', async () => {
    const database = role => ({ databaseName: 'note-test', admin: () => ({ command: async () => ({ authInfo: { authenticatedUserRoles: [role] } }) }) });
    assert.equal((await databaseAccess(database({ role: 'atlasAdmin', db: 'admin' }))).findings[0].severity, 'high');
    assert.equal((await databaseAccess(database({ role: 'readWrite', db: 'other' }))).findings.length, 1);
    assert.equal((await databaseAccess(database({ role: 'readWrite', db: 'note-test' }))).findings.length, 0);
    assert.equal((await databaseAccess(database({ role: 'custom-role', db: 'note-test' }))).gaps.length, 1);
});

test('historical Satellite-only MongoDB CVE assessment is restricted to the verified Atlas deployment/version', async () => {
    const response = async () => JSON.stringify({ totalResults: 1, vulnerabilities: [{ cve: { id: 'CVE-2014-8180', configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:mongodb:mongodb:*:*:*:*:*:*:*:*' }, { vulnerable: false, criteria: 'cpe:2.3:a:redhat:satellite:6.0:*:*:*:*:*:*:*' }] }] }] } }] });
    for (const [version, date] of [['8.0.34', '21.10.2026'], ['8.0.36', '30.10.2026']]) {
        assert.equal((await nvdMatches('mongodb', version, response)).findings.length, 1);
        const atlas = await nvdMatches('mongodb', version, response, { atlas: true });
        assert.equal(atlas.findings.length, 0); assert.equal(atlas.checks.length, 1);
        assert.ok(atlas.checks[0].label.includes(version));
        assert.ok(atlas.checks[0].label.includes(date));
    }
    for (const version of ['8.0.35', '8.0.37']) assert.equal((await nvdMatches('mongodb', version, response, { atlas: true })).findings.length, 1);
    const changedPlatform = async () => (await response()).replace('redhat:satellite:6.0', 'other:platform:1.0');
    assert.equal((await nvdMatches('mongodb', '8.0.36', changedPlatform, { atlas: true })).findings.length, 1);
    const differentCve = async () => (await response()).replace('CVE-2014-8180', 'CVE-unreviewed');
    assert.equal((await nvdMatches('mongodb', '8.0.36', differentCve, { atlas: true })).findings.length, 1);
});

test('missing, failed and stale sources never render as a fresh clean scan', () => {
    const now = Date.now();
    assert.equal(publicSource('x', 'x', null, now).status, 'missing');
    assert.equal(publicSource('x', 'x', { checkedAt: new Date(now - 37 * 3600000), data: { findings: [] } }, now).status, 'stale');
    const failed = publicSource('x', 'x', { checkedAt: new Date(now), error: 'failed', data: { findings: [{ id: 'known' }] } }, now);
    assert.equal(failed.status, 'error'); assert.equal(failed.findings.length, 1);
});

let mongo, server, base, app, queued = 0;
const env = { NODE_ENV: 'test', JWT_SECRET: 'synthetic-monitor-test-secret-over-32-bytes', ADMIN_PASSWORD: 'synthetic-admin-monitor-password', FRONTEND_PUBLIC_URL: 'http://localhost:5500', INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic' };
before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.0.34' }, instance: { ip: '127.0.0.1', dbName: 'note-test-security-monitor' }, spawn: { windowsHide: true } });
    env.MONGO_URI = mongo.getUri('note-test-security-monitor');
    await mongoose.connect(env.MONGO_URI);
    app = require('../app').createApp({ env, stripe: { webhooks: {} }, mailProvider: { emails: { send: async () => { throw Error('No mail allowed'); } } }, securityMonitor: { status: async () => ({ sources: [], enabled: true }), request: async () => { queued++; return { accepted: true, reason: 'queued' }; } } });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('source outages retain previously known findings and their actual check date', async () => {
    const checkedAt = new Date('2026-10-20T08:00:00Z');
    await saveSource('retention', async () => ({ findings: [{ id: 'CVE-known' }] }), { now: () => checkedAt });
    await saveSource('retention', async () => { throw Error('network failed'); });
    const row = await SecurityStatus.findOne({ key: 'retention' }).lean();
    assert.equal(row.checkedAt.toISOString(), checkedAt.toISOString()); assert.equal(row.data.findings[0].id, 'CVE-known'); assert.ok(row.error); assert.equal(row.history.length, 2);
});

test('distributed scan lease runs one scan and manual requests enforce a cooldown', async () => {
    await SecurityStatus.deleteOne({ key: 'scheduler' });
    let calls = 0;
    const config = { env: { NODE_ENV: 'production', RENDER_GIT_COMMIT: 'test' }, database: {}, sources: () => [['lease-test', async () => { calls++; await new Promise(resolve => setTimeout(resolve, 40)); return { findings: [] }; }]] };
    const first = createSecurityMonitor(config), second = createSecurityMonitor(config);
    await Promise.all([first.tick(), second.tick()]); assert.equal(calls, 1);
    assert.equal((await first.request()).accepted, true); assert.equal((await second.request()).accepted, false);
    await first.tick(); assert.equal(calls, 2);
    const disabled = createSecurityMonitor({ ...config, env: { NODE_ENV: 'test' } });
    assert.equal((await disabled.request()).accepted, false); await disabled.tick(); assert.equal(calls, 2);
});

test('security APIs require admin authentication, trusted origin and CSRF; GET never queues a scan', async () => {
    assert.equal((await fetch(base + '/api/admin/security-status')).status, 401);
    const cookies = new Map();
    const call = async (path, options = {}) => {
        const response = await fetch(base + path, { ...options, headers: { Origin: 'http://localhost:5500', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers } });
        for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
        return response;
    };
    let csrf = (await (await call('/api/csrf-token')).json()).csrfToken;
    assert.equal((await call('/api/admin/security-scan', { method: 'POST', headers: { 'X-CSRF-Token': csrf } })).status, 401);
    assert.equal((await call('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) })).status, 200);
    csrf = (await (await call('/api/csrf-token')).json()).csrfToken;
    const status = await call('/api/admin/security-status?refresh=1'); assert.equal(status.status, 200); assert.equal(status.headers.get('cache-control'), 'no-store'); assert.equal(queued, 0);
    assert.equal((await call('/api/admin/security-scan', { method: 'POST' })).status, 403);
    assert.equal((await call('/api/admin/security-scan', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-CSRF-Token': csrf } })).status, 403);
    assert.equal((await call('/api/admin/security-scan', { method: 'POST', headers: { 'X-CSRF-Token': csrf } })).status, 202); assert.equal(queued, 1);
});

test('admin passwords are compared in full and query objects cannot become account names', async () => {
    const password = 'x'.repeat(90) + '-A';
    const auth = require('../services/adminAuth').createAdminAuthenticator({ NODE_ENV: 'test', ADMIN_PASSWORD: password });
    assert.equal(await auth.authenticate({ username: { $ne: null }, password }), null);
    assert.equal(await auth.authenticate({ password: 'x'.repeat(90) + '-B' }), null);
    assert.equal(await auth.authenticate({ password }), 'owner');
});
