const mongoose = require('mongoose');

const VariantSchema = new mongoose.Schema({
    price: Number,
    originalPrice: Number
}, { _id: false });

const ProductSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: String,
    category: String,
    inspiredBy: String,
    description: String,
    longDescription: String,
    notes: {
        head: String,
        heart: String,
        base: String
    },
    images: [String],
    variants: {
        30: VariantSchema,
        50: VariantSchema,
        100: VariantSchema
    }
});

module.exports = mongoose.model('Product', ProductSchema);
