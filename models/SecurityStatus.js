const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    checkedAt: Date,
    attemptedAt: Date,
    error: String,
    data: mongoose.Schema.Types.Mixed,
    history: [{ _id: false, at: Date, ok: Boolean, findings: Number, updates: Number }],
    lockedUntil: Date,
    owner: String,
    nextRunAt: Date,
    requestedAt: Date,
    completedAt: Date,
    revision: String
}, { timestamps: true });
module.exports = mongoose.model('SecurityStatus', schema);
