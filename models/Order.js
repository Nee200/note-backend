const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    description: String,
    quantity: Number,
    amount_total: Number,
    currency: String
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    orderNumber: { type: String, unique: true, sparse: true, index: true },
    email: String,
    name: String,
    amount: Number,
    currency: { type: String, default: 'eur' },
    discountAmount: { type: Number, default: 0 },
    shippingAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    couponCode: { type: String, default: '' },
    stripeSessionId: { type: String },
    stripeEventId: { type: String, default: '' },
    stripePaymentIntentId: { type: String, default: '' },
    paymentStatus: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    address: mongoose.Schema.Types.Mixed,
    items: [OrderItemSchema],
    status: { type: String, default: 'neu' }, // neu, in_bearbeitung, abgeschlossen, archiv
    statusUpdatedAt: { type: Date, default: Date.now },
    shippedAt: { type: Date, default: null },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    invoiceNumber: { type: String, default: '' },
    invoiceIssuedAt: { type: Date, default: null },
    invoiceStatus: {
        type: String,
        enum: ['', 'awaiting_payment', 'awaiting_service_date', 'manual_review', 'generated', 'error'],
        default: ''
    },
    invoiceError: { type: String, default: '' },
    pickupEmailSent: { type: Boolean, default: false }
});

OrderSchema.index(
    { stripeSessionId: 1 },
    { unique: true, sparse: true }
);

OrderSchema.index({ invoiceStatus: 1, date: -1 });

module.exports = mongoose.model('Order', OrderSchema);
