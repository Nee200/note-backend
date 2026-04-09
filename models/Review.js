const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    productId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    userEmail: { type: String, required: true },
    authorName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: '', maxlength: 120 },
    comment: { type: String, default: '', maxlength: 1200 },
    verifiedPurchase: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

ReviewSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Review', ReviewSchema);
