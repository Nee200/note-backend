require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');

const PRICE_30 = 34.99;
const PRICE_50 = 44.99;
const applyChanges = process.argv.includes('--apply');

function updateCatalog(products) {
    let changed = 0;

    products.forEach((product) => {
        let productChanged = false;

        if (product.variants?.['30']) {
            if (Number(product.variants['30'].price) !== PRICE_30 || product.variants['30'].originalPrice != null) {
                product.variants['30'].price = PRICE_30;
                delete product.variants['30'].originalPrice;
                productChanged = true;
            }
        }

        if (product.variants?.['50']) {
            if (Number(product.variants['50'].price) !== PRICE_50 || product.variants['50'].originalPrice != null) {
                product.variants['50'].price = PRICE_50;
                delete product.variants['50'].originalPrice;
                productChanged = true;
            }
        }

        if (productChanged) changed += 1;
    });

    return changed;
}

async function run() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI fehlt.');

    const catalogPath = path.join(__dirname, '..', 'products.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const catalogChanged = updateCatalog(catalog);

    await mongoose.connect(process.env.MONGO_URI);

    const databaseTotal = await Product.countDocuments({});
    const databaseNeedsUpdate = await Product.countDocuments({
        $or: [
            { 'variants.30.price': { $ne: PRICE_30 } },
            { 'variants.50.price': { $ne: PRICE_50 } },
            { 'variants.30.originalPrice': { $exists: true } },
            { 'variants.50.originalPrice': { $exists: true } }
        ]
    });

    console.log(`Katalog: ${catalog.length} Produkte, ${catalogChanged} Preisänderungen.`);
    console.log(`Datenbank: ${databaseTotal} Produkte, ${databaseNeedsUpdate} Preisänderungen.`);

    if (!applyChanges) {
        console.log('Trockenlauf beendet. Mit --apply werden Katalog und Datenbank aktualisiert.');
        return;
    }

    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

    const result = await Product.updateMany(
        {},
        {
            $set: {
                'variants.30.price': PRICE_30,
                'variants.50.price': PRICE_50
            },
            $unset: {
                'variants.30.originalPrice': '',
                'variants.50.originalPrice': ''
            }
        }
    );

    const remaining = await Product.countDocuments({
        $or: [
            { 'variants.30.price': { $ne: PRICE_30 } },
            { 'variants.50.price': { $ne: PRICE_50 } },
            { 'variants.30.originalPrice': { $exists: true } },
            { 'variants.50.originalPrice': { $exists: true } }
        ]
    });

    console.log(`Aktualisiert: ${result.modifiedCount} Datenbankprodukte.`);
    console.log(`Verbleibende Abweichungen: ${remaining}.`);
    if (remaining !== 0) throw new Error('Die Preisumstellung ist nicht vollständig.');
}

run()
    .catch((error) => {
        console.error('Preisumstellung fehlgeschlagen:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
