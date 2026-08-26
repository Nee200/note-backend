const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    postalCode: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' }
}, { _id: false });

const InvoiceItemSchema = new mongoose.Schema({
    position: Number,
    description: String,
    quantity: Number,
    unitGrossCents: Number,
    totalGrossCents: Number,
    vatRateBps: Number
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    number: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['issued', 'void'], default: 'issued', index: true },
    issuedAt: { type: Date, required: true, index: true },
    serviceDate: { type: Date, required: true },
    paymentDate: { type: Date, required: true },
    currency: { type: String, default: 'eur' },
    orderReference: { type: String, required: true },
    seller: {
        businessName: String,
        ownerName: String,
        address: AddressSchema,
        email: String,
        vatId: String
    },
    customer: {
        name: String,
        email: String,
        address: AddressSchema,
        taxIds: [{
            type: { type: String, default: '' },
            value: { type: String, default: '' },
            _id: false
        }]
    },
    items: [InvoiceItemSchema],
    subtotalGrossCents: { type: Number, required: true },
    discountGrossCents: { type: Number, default: 0 },
    shippingGrossCents: { type: Number, default: 0 },
    totalNetCents: { type: Number, required: true },
    totalTaxCents: { type: Number, required: true },
    totalGrossCents: { type: Number, required: true },
    vatRateBps: { type: Number, required: true },
    taxExemptionNote: { type: String, default: '' },
    payment: {
        provider: { type: String, default: 'Stripe' },
        method: { type: String, default: '' },
        stripeSessionId: { type: String, default: '' },
        stripePaymentIntentId: { type: String, default: '' }
    },
    source: {
        type: { type: String, default: 'stripe_checkout' },
        serviceDateSource: { type: String, default: '' },
        deliveryCountry: { type: String, default: '' },
        generatedBy: { type: String, default: 'automatic' }
    },
    pdfFileName: { type: String, required: true },
    pdfContentType: { type: String, default: 'application/pdf' },
    pdfData: { type: Buffer, required: true, select: false },
    pdfByteLength: { type: Number, required: true },
    pdfSha256: { type: String, required: true },
    pdfGeneratedAt: { type: Date, required: true }
}, {
    timestamps: true,
    minimize: false
});

InvoiceSchema.index({ 'customer.email': 1, issuedAt: -1 });
InvoiceSchema.index({ orderReference: 1 });

module.exports = mongoose.model('Invoice', InvoiceSchema);
