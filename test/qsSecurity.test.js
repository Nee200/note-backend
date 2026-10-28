const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

// Exercise the actual query-parser dependency consumed by Express.
// GHSA-6pq8-jhm2-2vcw can throw during comma-array serialization.
const qs = createRequire(require.resolve('express'))('qs');

for (const encodeValuesOnly of [false, true]) {
    test(`qs comma arrays tolerate untrusted objects (encodeValuesOnly=${encodeValuesOnly})`, () => {
        const options = { arrayFormat: 'comma', encodeValuesOnly };
        const inputs = [
            JSON.parse('{"items":[{"toString":"untrusted"}]}'),
            qs.parse('items[0][toString]=untrusted', { allowPrototypes: true }),
            qs.parse('items[0][label]=sample', { plainObjects: true }),
            { items: [null, undefined, { toString: null }] },
            { items: [[{ toString: 'untrusted' }]] }
        ];
        for (const input of inputs) {
            assert.doesNotThrow(() => qs.stringify(input, options));
        }
        const ordinary = qs.stringify({ items: ['G1', 'G2'] }, options);
        assert.equal(new URLSearchParams(ordinary).get('items'), 'G1,G2');
    });
}
