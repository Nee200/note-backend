require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function updateImages() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        // Update women's products
        const womenResult = await Product.updateMany(
            { category: 'women' },
            { $set: { images: ['images_parfume/parfume_frau_webp.webp'] } }
        );
        console.log(`Updated ${womenResult.modifiedCount} women's products.`);

        // Update men's products
        const menResult = await Product.updateMany(
            { category: 'men' },
            { $set: { images: ['images_parfume/parfume_mann_webp.webp'] } }
        );
        console.log(`Updated ${menResult.modifiedCount} men's products.`);

        console.log('Update complete.');
        process.exit(0);
    } catch (err) {
        console.error('Error updating images:', err);
        process.exit(1);
    }
}

updateImages();
