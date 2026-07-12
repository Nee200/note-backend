const assert = require('assert');

const baseUrl = (process.env.BACKEND_BASE_URL || 'http://localhost:4242').replace(/\/+$/, '');
const trustedOrigin = process.env.SMOKE_TRUSTED_ORIGIN || 'http://localhost:5500';

async function request(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch (error) {
        body = text;
    }

    return { response, body, text };
}

function okStatus(status) {
    return status >= 200 && status < 400;
}

async function main() {
    console.log(`[smoke] Backend base URL: ${baseUrl}`);

    const health = await request('/health');
    assert.ok(okStatus(health.response.status), `/health returned ${health.response.status}`);
    assert.strictEqual(health.body && health.body.status, 'ok', '/health must return status=ok');
    console.log('[smoke] /health ok');

    const ready = await request('/ready');
    assert.ok(okStatus(ready.response.status), `/ready returned ${ready.response.status}: ${ready.text}`);
    assert.strictEqual(ready.body && ready.body.status, 'ready', '/ready must return status=ready');
    console.log('[smoke] /ready ok');

    const products = await request('/api/products');
    assert.ok(okStatus(products.response.status), `/api/products returned ${products.response.status}`);
    assert.ok(Array.isArray(products.body), '/api/products must return an array');
    assert.ok(products.body.length > 0, '/api/products must return at least one product');
    console.log(`[smoke] /api/products ok (${products.body.length} products)`);

    const csrf = await request('/api/csrf-token');
    assert.ok(okStatus(csrf.response.status), `/api/csrf-token returned ${csrf.response.status}`);
    assert.ok(csrf.body && typeof csrf.body.csrfToken === 'string' && csrf.body.csrfToken.length >= 24, '/api/csrf-token must return a token');
    const csrfCookie = String(csrf.response.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(csrfCookie.startsWith('csrf_token='), '/api/csrf-token must set the CSRF cookie');
    console.log('[smoke] /api/csrf-token ok');

    const missingCsrf = await request('/api/validate-coupon', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: trustedOrigin
        },
        body: JSON.stringify({ code: 'NOTE-SMOKE' })
    });
    assert.strictEqual(missingCsrf.response.status, 403, `missing CSRF should return 403, got ${missingCsrf.response.status}`);
    console.log('[smoke] CSRF enforcement ok');

    const badOrigin = await request('/api/validate-coupon', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil.example',
            'X-CSRF-Token': csrf.body.csrfToken
        },
        body: JSON.stringify({ code: 'NOTE-SMOKE' })
    });
    assert.strictEqual(badOrigin.response.status, 403, `bad Origin should return 403, got ${badOrigin.response.status}`);
    console.log('[smoke] Origin enforcement ok');

    if (String(process.env.LOCAL_DEV_SAFE_MODE || '').toLowerCase() === 'true') {
        const newsletter = await request('/api/newsletter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: trustedOrigin,
                Cookie: csrfCookie,
                'X-CSRF-Token': csrf.body.csrfToken
            },
            body: JSON.stringify({ email: `smoke-newsletter-${Date.now()}@example.test` })
        });
        assert.ok(okStatus(newsletter.response.status), `/api/newsletter returned ${newsletter.response.status}: ${newsletter.text}`);
        assert.strictEqual(newsletter.body && newsletter.body.success, true, 'newsletter signup must report success');
        assert.strictEqual(newsletter.body && newsletter.body.safeMode, true, 'newsletter smoke must stay in safe mode');
        console.log('[smoke] Newsletter signup ok (safe mode)');
    }

    console.log('[smoke] Backend smoke passed');
}

main().catch((error) => {
    console.error('[smoke] Backend smoke failed');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
