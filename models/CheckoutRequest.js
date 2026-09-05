const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    actor: String,
    userId: String,
    mode: { type: String, enum: ['stripe', 'pickup'], required: true },
    status: { type: String, enum: ['pending', 'open', 'complete', 'expired', 'failed', 'manual_review'], default: 'pending' },
    couponCode: String,
    stripeConfig: { type: mongoose.Schema.Types.Mixed, select: false },
    stripeSessionId: String,
    paymentSettled: { type: Boolean, default: false },
    checkedAt: Date,
    url: String,
    orderId: mongoose.Schema.Types.ObjectId,
    orderNumber: String,
    lockedUntil: { type: Date, default: null },
    lease: String,
    lastError: String
}, { timestamps: true });
schema.index({ status: 1, updatedAt: 1 });
module.exports = mongoose.model('CheckoutRequest', schema);
