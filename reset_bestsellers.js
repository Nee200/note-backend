require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const result = await Product.updateMany({}, { $set: { bestseller: false } });
    console.log('Reset modifiedCount:', result.modifiedCount);

    const check = await Product.countDocuments({ bestseller: true });
    console.log('Bestseller remaining:', check);

    await mongoose.disconnect();
});
