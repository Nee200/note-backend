const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    description: String,
    quantity: Number,
    amount_total: Number,
    currency: String
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    email: String,
    name: String,
    amount: Number,
    address: mongoose.Schema.Types.Mixed,
    items: [OrderItemSchema]
});

module.exports = mongoose.model('Order', OrderSchema);
