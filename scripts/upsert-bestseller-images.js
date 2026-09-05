const maintenance = require('./maintenance').prepare({ task: 'upsert-bestseller-images.js', localOnly: false });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');

const BESTSELLER_IMAGES = {
    L12: 'images_website/bestsellers/l12-comparison-transparent-v2.webp',
    L56: 'images_website/bestsellers/l56-comparison-transparent-v2.webp',
    L62: 'images_website/bestsellers/l62-comparison-transparent-v2.webp',
    L73: 'images_website/bestsellers/l73-comparison-transparent-v2.webp',
    L123: 'images_website/bestsellers/l123-comparison-transparent-v2.webp',
    L145: 'images_website/bestsellers/l145-comparison-transparent-v2.webp',
    L146: 'images_website/bestsellers/l146-comparison-transparent-v2.webp',
    L147: 'images_website/bestsellers/l147-comparison-transparent-v2.webp',
    L155: 'images_website/bestsellers/l155-comparison-transparent-v2.webp',
    L190: 'images_website/bestsellers/l190-comparison-transparent-v2.webp',
    G111: 'images_website/bestsellers/g111-comparison-transparent-v1.webp',
    G160: 'images_website/bestsellers/g160-comparison-transparent-v2.webp',
    G169: 'images_website/bestsellers/g169-comparison-transparent-v2.webp',
    G223: 'images_website/bestsellers/g223-comparison-transparent-v1.webp',
    G232: 'images_website/bestsellers/g232-comparison-transparent-v1.webp',
    G245: 'images_website/bestsellers/g245-comparison-transparent-v1.webp',
    G263: 'images_website/bestsellers/g263-comparison-transparent-v1.webp',
    G282: 'images_website/bestsellers/g282-comparison-transparent-v1.webp',
    G298: 'images_website/bestsellers/g298-comparison-transparent-v1.webp',
    G307: 'images_website/bestsellers/g307-comparison-transparent-v2.webp',
    G322: 'images_website/bestsellers/g322-comparison-transparent-v2.webp'
};

async function run() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI fehlt.');

    const sourcePath = path.join(__dirname, '..', 'products.json');
    const products = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const productsById = new Map(products.map((product) => [product.id, product]));

    Object.entries(BESTSELLER_IMAGES).forEach(([id, image]) => {
        const product = productsById.get(id);
        if (!product) throw new Error(`Produkt ${id} fehlt in products.json.`);
        product.images = [image, ...(product.images || []).filter((entry) => entry !== image)];
    });

    if (!maintenance.apply) { console.log('Katalogänderungen vorbereitet; keine Dateien oder Datenbankeinträge geändert.'); return; }
    fs.writeFileSync(sourcePath, `${JSON.stringify(products, null, 2)}\n`, 'utf8');

    await mongoose.connect(process.env.MONGO_URI);
    const operations = Object.keys(BESTSELLER_IMAGES).map((id) => ({
        updateOne: {
            filter: { id },
            update: { $set: { images: productsById.get(id).images } }
        }
    }));
    const result = await Product.bulkWrite(operations, { ordered: true });
    console.log(`Bestseller-Bilder aktualisiert: ${operations.length}`);
    console.log(`Geändert: ${result.modifiedCount}`);
}

run()
    .catch((error) => {
        console.error('Bestseller-Bildimport fehlgeschlagen:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
