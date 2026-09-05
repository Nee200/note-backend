const assert = require('assert');

const baseUrl = (process.env.BACKEND_BASE_URL || 'http://localhost:4242').replace(/\/+$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Schreibende Smoke-Tests sind ausschließlich lokal erlaubt.');
const cookieJar = new Map();
const trustedOrigin = process.env.SMOKE_TRUSTED_ORIGIN || 'http://localhost:5500';

async function request(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
            Cookie: [...cookieJar].map(([key, value]) => key + '=' + value).join('; '),
            ...(options.headers || {})
        }
    });

    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const at = pair.indexOf('='); cookieJar.set(pair.slice(0, at), pair.slice(at + 1)); }
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch (error) {
        body = text;
    }

    return { response, body, text };
}

function pickCheckoutItem(products) {
    for (const product of products) {
        const variants = product && product.variants ? product.variants : {};
        const size = ['30', '50', '100'].find((key) => variants[key] && Number(variants[key].price) > 0);
        if (product && product.id && product.id !== 'AUTODUFT' && size) {
            return {
                id: `${product.id}-${size}`,
                quantity: 1
            };
        }
    }
    return null;
}

async function main() {
    console.log(`[smoke] Safe checkout base URL: ${baseUrl}`);

    const health = await request('/health');
    assert.strictEqual(health.response.status, 200, `/health returned ${health.response.status}`);
    assert.notStrictEqual(health.body && health.body.env, 'production', 'Safe checkout smoke must not run against production');

    assert.equal(health.body?.safeMode, true, 'Safe mode must be confirmed before any POST');
    assert.equal(health.body?.externalAdaptersDisabled, true, 'External adapters must be disabled before any POST');
    const csrf = await request('/api/csrf-token');
    assert.strictEqual(csrf.response.status, 200, `/api/csrf-token returned ${csrf.response.status}`);
    assert.ok(csrf.body && csrf.body.csrfToken, 'CSRF token missing');

    const products = await request('/api/products');
    assert.strictEqual(products.response.status, 200, `/api/products returned ${products.response.status}`);
    assert.ok(Array.isArray(products.body) && products.body.length > 0, 'No products available for checkout smoke');

    const checkoutItem = pickCheckoutItem(products.body);
    assert.ok(checkoutItem, 'No product with a priced variant available');

    const checkout = await request('/create-checkout-session', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: trustedOrigin,
            'X-CSRF-Token': csrf.body.csrfToken
        },
        body: JSON.stringify({
            items: [checkoutItem],
            customerEmail: 'smoke-checkout@example.test'
        })
    });

    assert.strictEqual(checkout.response.status, 200, `/create-checkout-session returned ${checkout.response.status}: ${checkout.text}`);
    assert.strictEqual(checkout.body && checkout.body.safeMode, true, 'Checkout smoke expected LOCAL_DEV_SAFE_MODE safeMode=true');
    assert.strictEqual(checkout.body && checkout.body.subtotalCents > 0, true, 'Checkout subtotal must be positive');
    assert.strictEqual(checkout.body && checkout.body.totalCents > 0, true, 'Checkout total must be positive');

    console.log(`[smoke] Safe checkout ok (${checkoutItem.id}, total ${checkout.body.totalCents} cents)`);

    const autoduft = products.body.find((product) => product && product.id === 'AUTODUFT');
    const scent = products.body.find((product) => product && ['men', 'women'].includes(product.category));
    if (autoduft && scent) {
        const autoduftCheckout = await request('/create-checkout-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: trustedOrigin,
                'X-CSRF-Token': csrf.body.csrfToken
            },
            body: JSON.stringify({
                items: [{ id: `AUTODUFT-${scent.id}`, quantity: 1 }]
            })
        });

        assert.strictEqual(
            autoduftCheckout.response.status,
            200,
            `/create-checkout-session Autoduft returned ${autoduftCheckout.response.status}: ${autoduftCheckout.text}`
        );
        assert.strictEqual(autoduftCheckout.body && autoduftCheckout.body.safeMode, true);
        assert.strictEqual(autoduftCheckout.body && autoduftCheckout.body.subtotalCents, 1999);
        console.log(`[smoke] Autoduft checkout ok (AUTODUFT-${scent.id}, subtotal 1999 cents)`);
    }
}

main().catch((error) => {
    console.error('[smoke] Safe checkout failed');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
