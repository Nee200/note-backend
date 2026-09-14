const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    status: { type: String, enum: ['invited', 'password', 'mfa', 'active'], required: true },
    invitationHash: { type: String, select: false },
    invitationExpiresAt: Date,
    setupHash: { type: String, select: false, index: true },
    setupExpiresAt: Date,
    setupAttempts: { type: Number, default: 0 },
    passwordHash: { type: String, select: false },
    totpEncrypted: { type: String, select: false },
    credentialVersion: String,
    lastTimeStep: { type: Number, default: -1 },
    createdBy: String,
    activatedAt: Date
}, { timestamps: true });
module.exports = mongoose.model('AdminAccount', schema);
