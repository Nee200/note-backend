const { test } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const path = require('node:path');
const { createRequire } = require('node:module');

// Exercise the actual driver selected by both application and isolated-test consumers.
for (const consumer of ['mongoose', 'mongodb-memory-server-core']) {
    const fromConsumer = createRequire(require.resolve(consumer));
    const root = path.dirname(fromConsumer.resolve('mongodb/package.json'));
    const { MongoClient } = require(root);
    const { parseOptions, resolveSRVRecord } = require(path.join(root, 'lib/connection_string'));
    const { resolveTimeoutOptions } = require(path.join(root, 'lib/utils'));
    const { TimeoutContext } = require(path.join(root, 'lib/timeout'));

    function mockDns(t, name) {
        t.mock.method(dns.promises, 'resolve', async (query, type) => {
            if (type === 'TXT') {
                assert.equal(query, 'cluster.trusted.example');
                return [['']];
            }
            assert.equal(type, 'SRV');
            assert.equal(query, '_mongodb._tcp.cluster.trusted.example');
            return [{ name, port: 27017, priority: 0, weight: 1 }];
        });
        const options = parseOptions('mongodb+srv://cluster.trusted.example/synthetic');
        assert.equal(options.tls, true, 'default TLS protection remains enabled');
        return options;
    }

    for (const returnedHost of [
        'outside.test/path.node.trusted.example',
        'outside.test?node.trusted.example',
        'outside.test#node.trusted.example',
        'node.trusted.example.outside.test'
    ]) {
        test(`${consumer}: SRV cannot reinterpret ${returnedHost} as a different connection host`, async t => {
            const options = mockDns(t, returnedHost);
            await assert.rejects(resolveSRVRecord(options), /Invalid DNS host name|does not share hostname/);
        });
    }

    for (const returnedHost of ['node.trusted.example', 'NODE.TRUSTED.EXAMPLE.']) {
        test(`${consumer}: SRV accepts and normalizes legitimate host ${returnedHost}`, async t => {
            const hosts = await resolveSRVRecord(mockDns(t, returnedHost));
            assert.deepEqual(hosts.map(host => host.toHostPort()), [{ host: 'node.trusted.example', port: 27017 }]);
        });
    }

    test(`${consumer}: retired timeoutMS cannot activate client-side operation timeouts`, async () => {
        // Constructor/options only: never connect, read records or send commands.
        const client = new MongoClient('mongodb://127.0.0.1:27017/synthetic', {
            timeoutMS: 1, serverSelectionTimeoutMS: 333, waitQueueTimeoutMS: 444, socketTimeoutMS: 555
        });
        try {
            assert.equal(client.options.timeoutMS, undefined);
            const options = resolveTimeoutOptions(client, { timeoutMS: 1 });
            assert.equal(options.timeoutMS, undefined);
            assert.equal(options.serverSelectionTimeoutMS, 333);
            assert.equal(options.waitQueueTimeoutMS, 444);
            assert.equal(options.socketTimeoutMS, 555);
            const context = TimeoutContext.create({ ...options, timeoutMS: 1 });
            assert.equal(context.csotEnabled(), false);
            context.clear();
        } finally { await client.close(); }
    });
}
