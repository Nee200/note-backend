const maintenance = require('./maintenance').prepare({ task: 'upsert-autoduft.js', localOnly: false });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');


const Product = require('../models/Product');

async function upsertAutoduft() {
    const shouldApply = process.argv.includes('--apply');
    const productsPath = path.join(__dirname, '..', 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const autoduft = products.find((product) => product && product.id === 'AUTODUFT');

    if (!autoduft) throw new Error('AUTODUFT fehlt in backend/products.json.');
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI ist nicht konfiguriert.');

    await mongoose.connect(process.env.MONGO_URI);
    const existing = await Product.findOne({ id: autoduft.id }, 'id name variants images').lean();

    if (!shouldApply) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            database: mongoose.connection.name,
            exists: !!existing,
            product: autoduft
        }, null, 2));
        return;
    }

    await Product.updateOne(
        { id: autoduft.id },
        { $set: autoduft },
        { upsert: true, runValidators: true }
    );

    const saved = await Product.findOne({ id: autoduft.id }, '-_id -__v').lean();
    const savedPrice = saved && saved.variants && saved.variants['30']
        ? Number(saved.variants['30'].price)
        : NaN;

    if (!saved || savedPrice !== 19.99) {
        throw new Error('AUTODUFT konnte nicht vollständig verifiziert werden.');
    }

    console.log(JSON.stringify({
        mode: existing ? 'updated' : 'created',
        database: mongoose.connection.name,
        id: saved.id,
        name: saved.name,
        price: savedPrice,
        imageCount: Array.isArray(saved.images) ? saved.images.length : 0
    }, null, 2));
}

upsertAutoduft()
    .catch((error) => {
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect().catch(() => {}));
