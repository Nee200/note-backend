const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { runInNewContext } = require('node:vm');
const { createRequire } = require('node:module');
const redirects = require('follow-redirects');
const otpUri = createRequire(require.resolve('otplib'))('@otplib/uri');

for (const headerFormat of ['object', 'array']) {
    test(`redirects preserve cross-realm sensitive header rules with ${headerFormat} headers`, async t => {
        const destination = http.createServer((request, response) => {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(request.headers));
        });
        const origin = http.createServer((request, response) => {
            if (request.url === '/same-final') {
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify(request.headers));
            } else {
                response.writeHead(302, { Location: request.url === '/same'
                    ? '/same-final' : `http://127.0.0.1:${destination.address().port}/final` });
                response.end();
            }
        });
        for (const server of [destination, origin]) {
            t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
        }
        const headers = { 'X-API-Key': 'synthetic-redirect-key', Authorization: 'Bearer synthetic-only',
            Cookie: 'synthetic=value', 'X-Harmless': 'retained' };
        for (const foreignRealm of [false, true]) {
            const sensitiveHeaders = foreignRealm ? runInNewContext("['X-API-Key']") : ['X-API-Key'];
            assert.equal(Array.isArray(sensitiveHeaders), true);
            assert.equal(sensitiveHeaders instanceof Array, !foreignRealm);
            for (const crossOrigin of [false, true]) {
                const received = await new Promise((resolve, reject) => {
                    const request = redirects.http.get(`http://127.0.0.1:${origin.address().port}/${crossOrigin ? 'cross' : 'same'}`, {
                        headers: headerFormat === 'object' ? { ...headers } : Object.entries(headers).flat(),
                        sensitiveHeaders, maxRedirects: 2
                    }, response => {
                        let body = '';
                        response.setEncoding('utf8');
                        response.on('data', chunk => { body += chunk; });
                        response.on('error', reject);
                        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
                    });
                    request.setTimeout(5000, () => request.destroy(new Error('Loopback request timed out')));
                    request.on('error', reject);
                });
                assert.equal(received['x-harmless'], 'retained');
                for (const name of ['X-API-Key', 'Authorization', 'Cookie']) {
                    assert.equal(received[name.toLowerCase()], crossOrigin ? undefined : headers[name],
                        `${name}: realm=${foreignRealm ? 'foreign' : 'local'}, crossOrigin=${crossOrigin}`);
                }
            }
        }
    });
}

const syntheticSecret = 'JBSWY3DPEHPK3PXP';

test('malformed OTP URI errors omit the secret and full input', () => {
    for (const input of [
        `invalid://totp/fixture?secret=${syntheticSecret}`,
        `otpauth://totp?secret=${syntheticSecret}`,
        `otpauth://totp?secret=${syntheticSecret}&image=https://example.test/icon.png`
    ]) {
        assert.throws(() => otpUri.parse(input), error => {
            assert.match(error.message, /Invalid otpauth URI/);
            assert.equal(error.message.includes(syntheticSecret), false);
            assert.equal(error.message.includes(input), false);
            return true;
        });
    }
});

test('OTP URI generation rejects injected parameters and preserves normal enrollment URIs', () => {
    const base = { type: 'totp', label: 'NOTE Fragrances:fixture', params: { secret: syntheticSecret } };
    assert.throws(() => otpUri.generate({ ...base, type: 'totp/fixture?secret=FORGED#' }), otpUri.InvalidParameterError);
    for (const field of ['digits', 'period', 'counter']) {
        assert.throws(() => otpUri.generate({ ...base, type: field === 'counter' ? 'hotp' : 'totp',
            params: { ...base.params, [field]: '6&secret=FORGED' } }), otpUri.InvalidParameterError);
    }
    const { generateURI } = require('otplib');
    const uri = generateURI({ issuer: 'NOTE Fragrances', label: 'fixture', secret: syntheticSecret });
    const parsed = otpUri.parse(uri);
    assert.equal(parsed.type, 'totp');
    assert.equal(parsed.params.secret, syntheticSecret);
    assert.equal(parsed.params.issuer, 'NOTE Fragrances');
    assert.equal(parsed.label, 'NOTE Fragrances:fixture');
    const numericStrings = otpUri.generate({ ...base, params: { ...base.params, digits: '8', period: '60' } });
    assert.equal(otpUri.parse(numericStrings).params.digits, 8);
    assert.equal(otpUri.parse(numericStrings).params.period, 60);
});
