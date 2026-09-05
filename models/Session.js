const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    jti: { type: String, required: true, unique: true },
    userId: { type: String, index: true },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    adminId: String,
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('Session', schema);
