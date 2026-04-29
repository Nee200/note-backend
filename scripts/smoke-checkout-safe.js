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

function pickCheckoutItem(products) {
    for (const product of products) {
        const variants = product && product.variants ? product.variants : {};
        const size = ['30', '50', '100'].find((key) => variants[key] && Number(variants[key].price) > 0);
        if (product && product.id && size) {
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
}

main().catch((error) => {
    console.error('[smoke] Safe checkout failed');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
