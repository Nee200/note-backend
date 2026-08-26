const mongoose = require('mongoose');

const OrderCounterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    sequence: { type: Number, required: true, default: 0 }
}, {
    timestamps: true,
    versionKey: false
});

module.exports = mongoose.model('OrderCounter', OrderCounterSchema);
