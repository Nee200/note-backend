const mongoose = require('mongoose');
const schema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, hits: Number, resetTime: Date });
schema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('RateLimit', schema);
