const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { gzipSync } = require('node:zlib');
const express = require('express');

// GHSA-27r3-jxmh-p828: delayed decoder errors must not terminate the server.
// This server is loopback-only and never loads the shop or any production data.
for (const [kind, type, input, expected] of [
    ['json', 'application/json', '{"sample":"ok"}', { sample: 'ok' }],
    ['urlencoded', 'application/x-www-form-urlencoded', 'sample=ok', { sample: 'ok' }],
    ['raw', 'application/octet-stream', 'sample=ok', 'sample=ok']
]) {
    test(`Express ${kind} survives trailing bytes after a gzip frame`, { timeout: 5000 }, async t => {
        const app = express();
        app.use(express[kind]({ limit: '1mb', ...(kind === 'urlencoded' ? { extended: true } : {}) }));
        app.post('/probe', (req, res) => res.json(Buffer.isBuffer(req.body) ? req.body.toString() : req.body));
        app.get('/alive', (req, res) => res.sendStatus(204));
        const server = app.listen(0, '127.0.0.1');
        t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
        await once(server, 'listening');
        const payload = Buffer.concat([gzipSync(input), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
        const response = await new Promise((resolve, reject) => {
            const request = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', path: '/probe', agent: false,
                headers: { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Content-Length': payload.length }
            }, res => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { body += chunk; });
                res.on('error', reject);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            });
            request.on('error', reject);
            request.setTimeout(2000, () => request.destroy(Error('Local parser test timed out')));
            request.end(payload);
        });
        assert.equal(response.status, 200);
        assert.deepEqual(JSON.parse(response.body), expected);
        // The vulnerable decoder throws only after the successful HTTP response.
        await delay(200);
        assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/alive`)).status, 204);
    });
}
