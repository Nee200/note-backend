const maintenance = require('./scripts/maintenance').prepare({ task: 'catalog-import' });
const mongoose = require('mongoose');
const fs = require('fs');
const Product = require('./models/Product');

async function importProducts() {
    try {

        console.log('MongoDB connected for import...');

        const rawData = fs.readFileSync('products.json', 'utf8');
        const productsArray = JSON.parse(rawData);
        if (!Array.isArray(productsArray) || productsArray.length === 0) {
            throw new Error('products.json contains no products.');
        }

        console.log(`Found ${productsArray.length} products to import.`);
        for (const product of productsArray) await new Product(product).validate();
        if (!maintenance.apply) { console.log('Validierter Trockenlauf; kein Schreibzugriff.'); return; }
        await mongoose.connect(process.env.MONGO_URI);
        await Product.bulkWrite(productsArray.map(product => ({ updateOne: { filter: { id: product.id }, update: { $set: product }, upsert: true } })));
        const importedCount = await Product.countDocuments({ id: { $in: productsArray.map(product => product.id) } });
        if (importedCount !== productsArray.length) {
            throw new Error(`Product import incomplete: expected ${productsArray.length}, found ${importedCount}.`);
        }
        console.log(`Import successful (${importedCount} products).`);
    } catch (error) {
        const annotationMessage = String(error && error.message ? error.message : error || 'Unknown import failure')
            .replace(/%/g, '%25')
            .replace(/\r/g, '%0D')
            .replace(/\n/g, '%0A');
        console.error(`::error title=Product import failed::${annotationMessage}`);
        console.error('Import failed:', error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect().catch(() => {});
    }
}

importProducts();
