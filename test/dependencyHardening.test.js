const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { Resend } = require('resend');

for (const [option, oldStatus] of [['skipFailedRequests', 500], ['skipSuccessfulRequests', 200]]) {
    test(`${option}: a late response cannot free a slot in the next MemoryStore window`, async t => {
        t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 });
        const store = new MemoryStore();
        t.after(() => store.shutdown());
        let blocked = 0;
        const limiter = rateLimit({ store, windowMs: 1000, limit: 1, [option]: true,
            keyGenerator: () => 'synthetic-client', validate: false, standardHeaders: false, legacyHeaders: false,
            handler: () => { blocked++; } });
        const request = async statusCode => {
            const response = Object.assign(new EventEmitter(), { statusCode });
            await limiter({}, response, error => { if (error) throw error; });
            return response;
        };
        const old = await request(oldStatus);
        t.mock.timers.tick(1001);
        await request(oldStatus === 500 ? 200 : 500);
        assert.equal((await store.get('synthetic-client')).totalHits, 1);
        old.emit('finish');
        await nextTurn();
        assert.equal((await store.get('synthetic-client')).totalHits, 1, 'late completion belongs to the expired window');
        await request(200);
        assert.equal(blocked, 1, 'the new window must still reject the extra request');
    });
}

test('Resend rejects URL-normalized traversal before fetch and preserves ordinary email payloads', async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, options });
        return Response.json({ id: 'synthetic-message' });
    });
    const client = new Resend('re_synthetic_security_test');
    for (const call of [
        () => client.domains.remove('..\\api-keys\\synthetic'),
        () => client.emails.cancel('.\t.'),
        () => client.emails.get('.. '),
        () => client.emails.get('%2e\n%2e')
    ]) {
        const result = await call();
        assert.equal(result.error?.name, 'invalid_parameter');
        assert.equal(requests.length, 0, 'invalid paths must not reach the provider');
    }
    const result = await client.emails.send({ from: 'sender@example.test', to: 'receiver@example.test', subject: 'Synthetic',
        text: 'No message is sent', attachments: [{ filename: 'fixture.txt', content: Buffer.from('fixture') }] }, { idempotencyKey: 'synthetic-only' });
    assert.equal(result.data.id, 'synthetic-message');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.resend.com/emails');
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.attachments[0].content, Buffer.from('fixture').toString('base64'));
    assert.equal(new Headers(requests[0].options.headers).get('Idempotency-Key'), 'synthetic-only');
});
