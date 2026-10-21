const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    email: { type: String, required: true, maxlength: 254 },
    name: { type: String, default: '', maxlength: 120 },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RegistrationRequest', schema);
