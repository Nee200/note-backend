const mongoose = require('mongoose');

const VariantSchema = new mongoose.Schema({
    price: { type: Number, required: true, min: 0.01, max: 10000, validate: value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 },
    originalPrice: { type: Number, min: 0.01, max: 10000, validate: value => value == null || Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 }
}, { _id: false });

const ProductSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, match: /^[A-Z0-9_-]{1,40}$/ },
    name: { type: String, required: true, maxlength: 120 },
    category: { type: String, enum: ['men', 'women', 'unisex', 'autoduft', 'car-fragrance', 'duftroller'] },
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
        6: VariantSchema,
        10: VariantSchema,
        14: VariantSchema,
        30: VariantSchema,
        50: VariantSchema,
        100: VariantSchema
    }
});

ProductSchema.pre('validate', function () {
    const sizes = this.category === 'duftroller' ? ['6', '10', '14'] : ['30', '50', '100'];
    if (!sizes.some(size => this.variants?.[size]?.price > 0)) this.invalidate('variants', 'Mindestens eine gültige Variante ist erforderlich.');
    const otherSizes = this.category === 'duftroller' ? ['30', '50', '100'] : ['6', '10', '14'];
    if (otherSizes.some(size => this.variants?.[size])) this.invalidate('variants', 'Die Flaschengrößen passen nicht zu dieser Produktkategorie.');
});

module.exports = mongoose.model('Product', ProductSchema);
