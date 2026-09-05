const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    productId: String,
    sku: String,
    variant: String,
    internalId: String,
    supplierId: String,
    imageUrl: String,
    description: String,
    quantity: { type: Number, min: 1, validate: Number.isInteger },
    unitAmountCents: { type: Number, min: 0, validate: Number.isSafeInteger },
    lineTotalCents: { type: Number, min: 0, validate: Number.isSafeInteger },
    amount_total: Number, // legacy; public DTO normalizes by the explicit order source
    currency: String
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    schemaVersion: { type: Number },
    userId: { type: String, default: null },
    checkoutRequestId: { type: String },
    fulfillmentMethod: { type: String, enum: ['shipping', 'pickup'] },
    paymentMethod: { type: String, enum: ['stripe', 'cash'] },
    cashConfirmedBy: String,
    cashConfirmedAt: Date,
    cashReceiptReference: String,
    refundedAmountCents: { type: Number, default: 0 },
    disputeStatus: String,
    financialResolutionReference: String,
    financialReviewedAt: Date,
    financialReviewedBy: String,
    financialReviewedAmountCents: Number,
    financialReviewedDisputeStatus: String,
    cancelledAt: Date,
    trackingUrl: String,
    pendingNotifications: { type: [String], default: [] },
    confirmationPolicy: { type: String, enum: ['send', 'legacy-review'] },
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
    invoicePending: { type: Boolean, default: false },
    invoiceRetryAt: Date,
    pickupEmailSent: { type: Boolean, default: false }
}, { optimisticConcurrency: true });

OrderSchema.index(
    { stripeSessionId: 1 },
    { unique: true, sparse: true, name: 'stripe_session_unique_sparse' }
);

OrderSchema.index({ invoiceStatus: 1, date: -1 });
OrderSchema.index({ invoicePending: 1, invoiceRetryAt: 1 });
OrderSchema.index({ userId: 1, date: -1 });
OrderSchema.index({ email: 1, userId: 1 });
OrderSchema.index({ checkoutRequestId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Order', OrderSchema);
