const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../models/Product');
const entries = require('../catalog/product-supplier-2026-10.json').entries;
let database, server, base, app;
before(async () => {
    database = await MongoMemoryServer.create({ binary: { version: '8.0.34' }, instance: { ip: '127.0.0.1', dbName: 'note-test-mapping' }, spawn: { windowsHide: true } });
    const env = { NODE_ENV: 'test', MONGO_URI: database.getUri('note-test-mapping'), JWT_SECRET: 'synthetic-mapping-secret-at-least-32-bytes', ADMIN_PASSWORD: 'synthetic-mapping-password', FRONTEND_PUBLIC_URL: 'http://localhost:5500', BACKEND_PUBLIC_URL: 'http://localhost:4242', INVOICES_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic' };
    await mongoose.connect(env.MONGO_URI);
    app = require('../app').createApp({ env, stripe: { checkout: { sessions: {} }, webhooks: {}, coupons: {}, charges: {}, disputes: {} }, mailProvider: { emails: { send: async () => ({ data: { id: 'synthetic' } }) } } });
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    await Product.insertMany(entries.map(row => ({ id: row.productId, name: 'No. '+row.productId, inspiredBy: row.expectedInspiredBy, category: row.expectedCategory, variants: { 30: { price: 34.99 } } })));
    await app.locals.refreshProductCache();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (database) await database.stop(); });
test('admin HTTP mapping authenticates and returns the reviewed full catalogue in both directions', async () => {
    for (const path of ['/api/admin/id-mapping?id=M1', '/api/admin/id-mapping/catalog']) assert.equal((await fetch(base+path)).status,401);
    const cookies = new Map();
    const call = async (path, options={}) => {
        const res = await fetch(base+path,{...options,headers:{Origin:'http://localhost:5500',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...options.headers}});
        for (const cookie of res.headers.getSetCookie()) { const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1)); }
        return res;
    };
    const csrf = await (await call('/api/csrf-token')).json();
    const login = await call('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.csrfToken},body:JSON.stringify({password:'synthetic-mapping-password'})});
    assert.equal(login.status,200);
    for (const [query,internal,supplier] of [['M155','G1','M155'],['G1','G1','M155'],['M1','G362','M1'],['W4','L66','W4'],['G370','G370','M168']]) {
        const res=await call('/api/admin/id-mapping?id='+query),body=await res.json();
        assert.equal(res.status,200);assert.equal(body.internalId,internal);assert.equal(body.supplierId,supplier);assert.equal(body.confirmed,true);
        assert.equal(res.headers.get('cache-control'),'no-store');
    }
    assert.equal((await call('/api/admin/id-mapping?id=M-1')).status,400);
    const catalog=await (await call('/api/admin/id-mapping/catalog')).json();
    assert.equal(catalog.men.length+catalog.women.length,581);
    assert.equal(catalog.women.find(r=>r.supplierId==='W103').status,'historical');
    assert.equal(catalog.men.find(r=>r.supplierId==='M351').internalId,null);
    await Product.updateOne({id:'G1'},{$set:{inspiredBy:'Changed scent'}});
    await app.locals.refreshProductCache();
    const changed=await (await call('/api/admin/id-mapping?id=M155')).json();
    assert.equal(changed.status,'changed');assert.equal(changed.internalId,null);
});
