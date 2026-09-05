const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ['pending', 'active', 'unsubscribed'], default: 'pending' },
    code: { type: String, unique: true, sparse: true, trim: true },
    discount: { type: Number, default: 5, min: 0, max: 100 }, // percent
    freeShipping: { type: Boolean, default: false },
    used: { type: Boolean, default: false },
    reservationKey: { type: String, default: null },
    reservedAt: Date,
    redeemedAt: Date,
    redeemedBy: String,
    confirmTokenHash: { type: String, index: true, select: false },
    unsubscribeTokenHash: { type: String, index: true, select: false },
    unsubscribedAt: Date,
    consentVersion: String,
    consentMethod: String,
    pendingDiscountMail: { type: Boolean, default: false },
    purgeAt: Date,
    confirmToken: { type: String, index: true },
    confirmTokenExpiresAt: { type: Date },
    subscribedAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date }
});

subscriberSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Subscriber', subscriberSchema);
