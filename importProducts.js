require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const Product = require('./models/Product');

mongoose.connect(process.env.MONGO_URI, {}).then(async () => {
    console.log('MongoDB connected for import...');

    try {
        const rawData = fs.readFileSync('products.json', 'utf8');
        const productsArray = JSON.parse(rawData);

        console.log(`Found ${productsArray.length} products to import.`);

        // Clear existing products to avoid duplicates during test
        await Product.deleteMany({});
        console.log('Cleared existing products.');

        await Product.insertMany(productsArray);
        console.log('Import successful!');
    } catch (error) {
        console.error('Import failed:', error);
    } finally {
        mongoose.connection.close();
    }
}).catch(err => console.error(err));
