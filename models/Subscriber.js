const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ['pending', 'active'], default: 'pending' },
    code: { type: String, unique: true, sparse: true, trim: true },
    discount: { type: Number, default: 5 }, // percent
    freeShipping: { type: Boolean, default: false },
    used: { type: Boolean, default: false },
    confirmToken: { type: String, index: true },
    confirmTokenExpiresAt: { type: Date },
    subscribedAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date }
});

module.exports = mongoose.model('Subscriber', subscriberSchema);
