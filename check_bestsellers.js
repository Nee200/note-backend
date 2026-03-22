require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');
const fs = require('fs');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const f = await Product.find({ bestseller: true }).select('id inspiredBy category');
    let out = 'COUNT: ' + f.length + '\n';
    f.forEach(p => { out += p.id + ' | ' + p.category + ' | ' + p.inspiredBy + '\n'; });
    fs.writeFileSync('bestseller_check.txt', out);
    console.log('Written to bestseller_check.txt');
    await mongoose.disconnect();
});
