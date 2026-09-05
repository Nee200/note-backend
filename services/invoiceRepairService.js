const Order = require('../models/Order');
const Invoice = require('../models/Invoice');
const { ensureInvoiceForOrder } = require('./invoiceService');

function createInvoiceRepairService({ stripe, enabled }) {
    return { async processPending() {
        if (!enabled) return;
        // Repair existing documents even when the process died after Invoice.create
        // and before linking the order. No historical invoice is regenerated.
        const links = await Invoice.aggregate([
            { $project: { order: 1 } },
            { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', pipeline: [{ $project: { invoice: 1 } }], as: 'linkedOrder' } },
            { $match: { 'linkedOrder.0': { $exists: true }, $expr: { $ne: [{ $ifNull: [{ $arrayElemAt: ['$linkedOrder.invoice', 0] }, null] }, '$_id'] } } },
            { $limit: 20 }
        ]);
        for (const link of links) {
            const order = await Order.findById(link.order);
            if (order) { try { await ensureInvoiceForOrder({ order }); } catch { /* still discoverable on the next pass */ } }
        }
        // Only explicit invoice requests are retried. Old orders are never
        // silently backfilled or assigned an invented service date.
        const orders = await Order.find({ invoicePending: true, $or: [{ invoiceRetryAt: null }, { invoiceRetryAt: { $lte: new Date() } }] }).sort({ invoiceRetryAt: 1 }).limit(20);
        for (const order of orders) {
            const claimed = await Order.updateOne({ _id: order._id, invoicePending: true, invoiceRetryAt: order.invoiceRetryAt || null }, { $set: { invoiceRetryAt: new Date(Date.now() + 300000) } });
            if (!claimed.modifiedCount) continue;
            try { await ensureInvoiceForOrder({ order, stripeClient: stripe, generatedBy: 'recovery' }); }
            catch { /* persistent flag and the error status remain for retry */ }
        }
    } };
}
module.exports = { createInvoiceRepairService };
