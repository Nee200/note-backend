const mongoose = require('mongoose');
const Product = require('../models/Product');

async function seedCiProducts() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {});
        await Product.deleteMany({});
        await Product.create({
            id: 'G1',
            name: 'NØTE. CI Testduft',
            category: 'men',
            inspiredBy: 'CI fixture',
            description: 'Lokales Testprodukt für den Backend-Smoke-Test.',
            notes: {
                head: 'Bergamotte',
                heart: 'Lavendel',
                base: 'Zedernholz'
            },
            images: ['logo.webp'],
            bestseller: true,
            variants: {
                30: { price: 34.99 },
                50: { price: 44.99 }
            }
        });

        const count = await Product.countDocuments({});
        if (count !== 1) throw new Error(`Expected one CI product, found ${count}.`);
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
