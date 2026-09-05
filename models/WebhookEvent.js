const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true },
    type: String,
    payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
    status: { type: String, enum: ['pending', 'processing', 'processed', 'ignored'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    lastError: String,
    processedAt: Date,
    expiresAt: Date
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1 });
schema.index({ expiresAt: 1 }); // keep processed event IDs after payload retention expires
module.exports = mongoose.model('WebhookEvent', schema);
