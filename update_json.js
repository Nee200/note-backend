const fs = require('fs');

// We need to extract the `products` array from tmp_products.js 
// So we can write it to backend/products.json
const code = fs.readFileSync('../frontend/tmp_products.js', 'utf8');

// A simple trick to evaluate the file content and get the products array
// We strip the "const products = " part and evaluate it
const evalCode = code + '\nmodule.exports = products;';
fs.writeFileSync('temp_eval.js', evalCode);

const updatedProducts = require('./temp_eval.js');

fs.writeFileSync('products.json', JSON.stringify(updatedProducts, null, 2));
console.log('Saved to products.json!');
fs.unlinkSync('temp_eval.js');
