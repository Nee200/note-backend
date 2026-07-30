require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');

const NEW_IDS = new Set([
    'G333', 'G334', 'G335', 'G336', 'G337', 'G338', 'G339', 'G340',
    'G341', 'G342', 'G343', 'G344', 'G345', 'G346', 'G347', 'G348',
    'L203', 'L204', 'L205', 'L206', 'L207', 'L208', 'L209', 'L210', 'L211'
]);

async function run() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI fehlt.');

    const sourcePath = path.join(__dirname, '..', 'products.json');
    const catalog = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const products = catalog.filter((product) => NEW_IDS.has(product.id));

    if (products.length !== NEW_IDS.size) {
        throw new Error(`Erwartet: ${NEW_IDS.size} Neuheiten, gefunden: ${products.length}.`);
    }

    products.forEach((product) => {
        if (!product.variants?.['30']) throw new Error(`30-ml-Variante fehlt bei ${product.id}.`);
        product.variants['30'].price = 34.99;
        delete product.variants['30'].originalPrice;
        if (product.variants?.['50']) {
            product.variants['50'].price = 44.99;
            delete product.variants['50'].originalPrice;
        }
    });
    fs.writeFileSync(sourcePath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

    await mongoose.connect(process.env.MONGO_URI);
    const operations = products.map((product) => ({
        updateOne: {
            filter: { id: product.id },
            update: { $set: product },
            upsert: true
        }
    }));
    const result = await Product.bulkWrite(operations, { ordered: true });
    console.log(`Neuheiten aktualisiert: ${products.length}`);
    console.log(`Neu angelegt: ${result.upsertedCount}; geändert: ${result.modifiedCount}`);
}

run()
    .catch((error) => {
        console.error('Neuheiten-Import fehlgeschlagen:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
