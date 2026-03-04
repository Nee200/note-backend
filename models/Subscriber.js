const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    code: { type: String, required: true, unique: true },
    discount: { type: Number, default: 5 }, // percent
    used: { type: Boolean, default: false },
    subscribedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Subscriber', subscriberSchema);
