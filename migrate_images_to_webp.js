require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function updateToWebp() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Verbunden mit MongoDB...');

        const products = await Product.find({ images: { $regex: /\.png$/i } });
        console.log(`${products.length} Produkte mit .png Bildern gefunden.`);

        let updatedCount = 0;
        for (const product of products) {
            const newImages = product.images.map(img => img.replace(/\.png$/i, '.webp'));
            product.images = newImages;
            await product.save();
            updatedCount++;
        }

        console.log(`Erfolgreich ${updatedCount} Produkte auf .webp umgestellt.`);
    } catch (err) {
        console.error('Fehler beim Update:', err);
    } finally {
        await mongoose.disconnect();
    }
}

updateToWebp();
