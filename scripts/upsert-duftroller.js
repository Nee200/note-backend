// Dry-run by default. No implicit .env load. A future approved write must name
// the exact --host and --database in addition to --apply; maintenance enforces it.
const maintenance = require('./maintenance').prepare({ task: 'upsert-duftroller.js', localOnly: false });
const mongoose = require('mongoose');
const Product = require('../models/Product');

async function run() {
    const product = require('../catalog/duftroller.json');
    if (product.id !== 'DUFTROLLER') throw new Error('Der Duftroller-Katalog enthält eine unerwartete Produkt-ID.');
    await new Product(product).validate();
    if (!maintenance.apply && !process.env.MONGO_URI) {
        console.log(JSON.stringify({ mode: 'dry-run', database: 'not-connected', product }, null, 2));
        return;
    }
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI ist nicht konfiguriert.');
    await mongoose.connect(process.env.MONGO_URI);
    const existing = await Product.findOne({ id: product.id }, 'id variants images').lean();
    if (!maintenance.apply) {
        console.log(JSON.stringify({ mode: 'dry-run', database: mongoose.connection.name, exists: !!existing, product }, null, 2));
        return;
    }
    await Product.updateOne({ id: product.id }, { $set: product }, { upsert: true, runValidators: true });
    const saved = await Product.findOne({ id: product.id }).lean();
    if (!saved || saved.category !== 'duftroller'
        || ['6', '10', '14'].some(size => saved.variants?.[size]?.price !== product.variants[size].price)
        || JSON.stringify(saved.images) !== JSON.stringify(product.images)) {
        throw new Error('DUFTROLLER konnte nicht vollständig verifiziert werden.');
    }
    console.log(JSON.stringify({ mode: existing ? 'updated' : 'created', database: mongoose.connection.name, id: saved.id, variants: saved.variants, imageCount: saved.images.length }, null, 2));
}

run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => {}));
