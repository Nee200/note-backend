const mongoose = require('mongoose');
const schema = new mongoose.Schema({ key: { type: String, unique: true, required: true }, lease: String, expiresAt: Date });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('WorkLock', schema);
