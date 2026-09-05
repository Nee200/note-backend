const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
let database, connection, Order, Subscriber;

before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.2.6' }, instance: { ip: '127.0.0.1', dbName: 'note-test-release-compatibility' }, spawn: { windowsHide: true } });
    connection = await mongoose.createConnection(database.getUri('note-test-release-compatibility'), { autoIndex: false, autoCreate: false }).asPromise();
    Order = connection.model('ReleaseOrder', require('../models/Order').schema.clone(), 'orders');
    Subscriber = connection.model('ReleaseSubscriber', require('../models/Subscriber').schema.clone(), 'subscribers');
    await connection.db.collection('orders').createIndex({ stripeSessionId: 1 }, { name: 'stripeSessionId_1' });
    await connection.db.collection('subscribers').createIndex({ code: 1 }, { name: 'code_1', unique: true });
});
after(async () => { if (connection) await connection.close(); if (database) await database.stop(); });

test('new indexes coexist with the observed legacy indexes and still reject duplicate payments', async () => {
    await Order.createIndexes();
    await Subscriber.createIndexes();
    const orderIndexes = await connection.db.collection('orders').listIndexes().toArray();
    const subscriberIndexes = await connection.db.collection('subscribers').listIndexes().toArray();
    assert.ok(orderIndexes.some(index => index.name === 'stripeSessionId_1' && !index.unique));
    assert.ok(orderIndexes.some(index => index.key.stripeSessionId === 1 && index.unique && index.sparse));
    assert.ok(subscriberIndexes.some(index => index.name === 'code_1' && index.unique && !index.sparse));
    assert.ok(subscriberIndexes.some(index => index.key.code === 1 && index.unique && index.sparse));
    await Order.create({ stripeSessionId: 'cs_test_legacy_index', amount: 1999 });
    await assert.rejects(Order.create({ stripeSessionId: 'cs_test_legacy_index', amount: 1999 }), error => error.code === 11000);
    await Order.create([{ amount: 1999 }, { amount: 1999 }]);
    await Subscriber.create({ email: 'one@example.test', code: 'SYNTHETIC-UNIQUE' });
    await assert.rejects(Subscriber.create({ email: 'two@example.test', code: 'SYNTHETIC-UNIQUE' }), error => error.code === 11000);
});

test('the catalog accepts the established Autoduft category while rejecting unknown categories and invalid prices', async () => {
    const Product = require('../models/Product');
    const product = { id: 'AUTODUFT', name: 'Synthetic Autoduft', category: 'car-fragrance', variants: { 30: { price: 19.99 } } };
    await new Product(product).validate();
    await new Product({ ...product, category: 'autoduft' }).validate();
    await assert.rejects(new Product({ ...product, category: 'unknown' }).validate());
    await assert.rejects(new Product({ ...product, variants: { 30: { price: -1 } } }).validate());
});
