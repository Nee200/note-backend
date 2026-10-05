const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    requestId: { type: String, required: true, unique: true, select: false },
    payloadHash: { type: String, required: true, select: false },
    reference: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    contract: { type: String, required: true },
    scope: { type: String, enum: ['full', 'partial'], required: true },
    items: { type: String, default: '' },
    declaration: { type: String, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    mailQueued: { type: Boolean, default: false },
    status: { type: String, enum: ['received', 'processing', 'completed'], default: 'received' },
    statusChangedAt: Date,
    purgeAt: Date
}, { timestamps: true });
schema.index({ receivedAt: -1, _id: -1 });
schema.index({ mailQueued: 1, receivedAt: 1 });
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('Withdrawal', schema);
