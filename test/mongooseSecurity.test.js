const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

test('Mongoose query helpers and schema virtuals reject prototype paths without polluting objects', () => {
    const instance = new mongoose.Mongoose();
    const schema = new instance.Schema({ amount: Number });
    const Model = instance.model('SyntheticQueryGuard', schema);
    for (const path of ['__proto__', 'constructor', 'prototype']) {
        assert.throws(() => Model.find().where(path).gt(1));
        assert.throws(() => Model.find().gt(path, 1));
        assert.throws(() => schema.virtual(`${path}.securityProbe`));
    }
    assert.equal(Object.hasOwn(Object.prototype, '$gt'), false);
    assert.equal(Object.hasOwn(Object.prototype, 'securityProbe'), false);
    assert.deepEqual(Model.find().where('amount').gt(1).getFilter(), { amount: { $gt: 1 } });
});
