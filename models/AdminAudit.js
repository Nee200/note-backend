const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    actor: { type: String, required: true },
    action: { type: String, required: true },
    target: String,
    details: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, index: true }
});
module.exports = mongoose.model('AdminAudit', schema);
