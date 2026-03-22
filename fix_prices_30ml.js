require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function updatePrices() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Verbunden mit MongoDB...');

        const result = await Product.updateMany(
            { "variants.30.price": 17.99 },
            { $set: { "variants.30.price": 19.99 } }
        );

        console.log(`Erfolgreich ${result.modifiedCount} Produkte von 17.99 auf 19.99 aktualisiert.`);
    } catch (err) {
        console.error('Fehler beim Preis-Update:', err);
    } finally {
        await mongoose.disconnect();
    }
}

updatePrices();
