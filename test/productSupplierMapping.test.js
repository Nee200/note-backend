const test = require('node:test');
const assert = require('node:assert/strict');
const crosswalk = require('../catalog/product-supplier-2026-10.json');
const { parseId, lookupProductMapping, lookupIdMapping, buildSupplierCatalogue } = require('../services/productSupplierMapping');
const products = crosswalk.entries.map(row => ({ id: row.productId, inspiredBy: row.expectedInspiredBy, category: row.expectedCategory }));
const lookup = id => lookupIdMapping(id, products);

test('all 578 recorded products resolve in both directions without assuming equal numbers', () => {
    assert.equal(products.length, 578);
    assert.equal(new Set(products.map(p => p.id)).size, 578);
    for (const row of crosswalk.entries) {
        const forward = lookup(row.productId), reverse = lookup(row.supplierId);
        assert.equal(forward.supplierId, row.supplierId, row.productId);
        assert.equal(reverse.internalId, row.productId, row.supplierId);
        assert.equal(forward.confirmed, row.status === 'matched');
        assert.equal(reverse.confirmed, forward.confirmed);
    }
    assert.equal(lookup('G1').supplierId, 'M155');
    assert.equal(lookup('M155').internalId, 'G1');
    assert.equal(lookup('M1').internalId, 'G362');
    assert.equal(lookup('W4').internalId, 'L66');
    assert.equal(lookup('G351').supplierId, 'M359');
    assert.equal(lookup('M359').internalId, 'G351');
});
test('blank, historical, excluded, and uncertain rows cannot become confirmed matches', () => {
    for (const id of ['G345', 'G347', 'L178']) assert.equal(lookup(id).status, 'review');
    assert.equal(lookup('L79').status, 'historical');
    assert.equal(lookup('W103').supplierReference.inspiredBy, '');
    assert.equal(lookup('W103').internalId, 'L79');
    assert.equal(lookup('W9').status, 'empty');
    assert.equal(lookup('M351').status, 'excluded');
    assert.equal(lookup('M351').internalId, null);
    for (const id of ['G345', 'G347', 'L178', 'L79', 'W103', 'W9', 'M351', 'M279']) assert.equal(lookup(id).confirmed, false, id);
    const cross = lookup('M279');
    assert.equal(cross.status, 'cross_category'); assert.equal(cross.internalId, 'L23');
    assert.equal(cross.primarySupplierId, 'W177'); assert.equal(lookup('L23').supplierId, 'W177');
});
test('a deleted or changed product never produces a fabricated current counterpart', () => {
    const g1 = products.find(p => p.id === 'G1');
    assert.equal(lookupProductMapping({ ...g1, inspiredBy: 'A different fragrance' }).status, 'changed');
    assert.equal(lookupProductMapping({ ...g1, category: 'women' }).confirmed, false);
    const changed = lookupIdMapping('M155', [{ ...g1, inspiredBy: 'A different fragrance' }]);
    assert.equal(changed.internalId, null); assert.equal(changed.candidates[0].id, 'G1');
    assert.equal(lookupIdMapping('M155', []).status, 'not_in_shop');
    assert.equal(lookupIdMapping('G1', []).internalId, null);
    assert.equal(lookup('M9999').internalId, null);
    assert.equal(lookupProductMapping({id: 'G999', inspiredBy: g1.inspiredBy, category: 'men'}).supplierId, null);
});
test('catalogue includes every current supplier line with its live shop counterpart', () => {
    const catalog = buildSupplierCatalogue(products);
    assert.equal(catalog.version, '10.26');
    assert.equal(catalog.men.length, 362); assert.equal(catalog.women.length, 219);
    assert.equal(catalog.men.find(r => r.supplierId === 'M16').internalId, 'G364');
    assert.equal(catalog.women.find(r => r.supplierId === 'W103').inspiredBy, '');
    assert.equal([...catalog.men, ...catalog.women].filter(r => r.confirmed).length, 574);
});
test('ID parser accepts spacing and leading zeroes but rejects punctuation and invalid IDs', () => {
    assert.equal(parseId(' m 001 ').id, 'M1');
    for (const id of ['G0', 'M-1', 'W1!', 'G10000', 'foo', '<G1>', '']) assert.equal(parseId(id), null);
});
