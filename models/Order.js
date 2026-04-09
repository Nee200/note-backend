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
    discountAmount: { type: Number, default: 0 },
    couponCode: { type: String, default: '' },
    stripeSessionId: { type: String, index: true },
    stripeEventId: { type: String, default: '' },
    address: mongoose.Schema.Types.Mixed,
    items: [OrderItemSchema],
    status: { type: String, default: 'neu' }, // neu, in_bearbeitung, abgeschlossen, archiv
    statusUpdatedAt: { type: Date, default: Date.now },
    pickupEmailSent: { type: Boolean, default: false }
});

OrderSchema.index(
    { stripeSessionId: 1 },
    { unique: true, sparse: true }
);

module.exports = mongoose.model('Order', OrderSchema);
