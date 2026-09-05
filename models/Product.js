const mongoose = require('mongoose');

const VariantSchema = new mongoose.Schema({
    price: { type: Number, required: true, min: 0.01, max: 10000, validate: value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 },
    originalPrice: { type: Number, min: 0.01, max: 10000, validate: value => value == null || Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 }
}, { _id: false });

const ProductSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, match: /^[A-Z0-9_-]{1,40}$/ },
    name: { type: String, required: true, maxlength: 120 },
    category: { type: String, enum: ['men', 'women', 'unisex', 'autoduft', 'car-fragrance'] },
    inspiredBy: String,
    description: String,
    longDescription: String,
    notes: {
        head: String,
        heart: String,
        base: String
    },
    images: [String],
    bestseller: { type: Boolean, default: false },
    newArrival: { type: Boolean, default: false },
    variants: {
        30: VariantSchema,
        50: VariantSchema,
        100: VariantSchema
    }
});

ProductSchema.pre('validate', function () {
    if (!['30', '50', '100'].some(size => this.variants?.[size]?.price > 0)) this.invalidate('variants', 'Mindestens eine gültige Variante ist erforderlich.');
});

module.exports = mongoose.model('Product', ProductSchema);
