require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    // Hole die ersten 5 Produkte und prüfe ihre Bild-Pfade
    const samples = await Product.find({}).limit(5).select('id images name');

    console.log('Aktuelle Bildpfade in MongoDB:');
    samples.forEach(p => {
        console.log(`- ${p.name} (ID: ${p.id}): ${JSON.stringify(p.images)}`);
    });

    await mongoose.disconnect();
});
