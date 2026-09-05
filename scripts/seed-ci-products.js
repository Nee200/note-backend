const mongoose = require('mongoose');
const Product = require('../models/Product');

async function seedCiProducts() {
    try {
        require('../config/environment').assertLocalTestDatabase(process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI, {});
        for (const fixture of require('../fixtures/products.json')) await Product.updateOne({ id: fixture.id }, { $set: fixture }, { upsert: true, runValidators: true });
        console.log('[seed] CI product fixture ready.');
    } catch (error) {
        const annotationMessage = String(error && error.message ? error.message : error || 'Unknown CI seed failure')
            .replace(/%/g, '%25')
            .replace(/\r/g, '%0D')
            .replace(/\n/g, '%0A');
        console.error(`::error title=CI product seed failed::${annotationMessage}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect().catch(() => {});
    }
}

seedCiProducts();
