require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

const bestsellerIds = [
    // Frauen
    'L37', 'L93', 'L95', 'L154', 'L170', 'L190',
    // Männer
    'G81', 'G105', 'G133', 'G145', 'G163', 'G183', 'G299'
];

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const result = await Product.updateMany(
        { id: { $in: bestsellerIds } },
        { $set: { bestseller: true } }
    );
    console.log('Bestseller gesetzt:', result.modifiedCount);

    // Zur Kontrolle: welche wurden gefunden?
    const found = await Product.find({ bestseller: true }, { id: 1, inspiredBy: 1, category: 1 });
    console.log('\nAktuelle Bestseller:');
    found.forEach(p => console.log(`  ${p.id} | ${p.category} | ${p.inspiredBy}`));

    await mongoose.disconnect();
}).catch(err => console.error(err));
