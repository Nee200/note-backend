const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
    status: { type: String, enum: ['pending', 'sending', 'accepted', 'simulated', 'manual_review', 'suppressed'], default: 'pending' },
    newsletterSubscriberId: mongoose.Schema.Types.ObjectId,
    consentAt: Date,
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    providerId: String,
    lastError: String,
    acceptedAt: Date,
    expiresAt: Date
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });
schema.index({ expiresAt: 1 }); // retain the idempotency tombstone; purge payload separately
module.exports = mongoose.model('MailJob', schema);
