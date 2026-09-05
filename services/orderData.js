function itemCents(order, item) {
    if (Number.isSafeInteger(item.lineTotalCents)) return item.lineTotalCents;
    if (order.schemaVersion >= 2) return Number.isSafeInteger(item.amount_total) ? item.amount_total : null;
    // Legacy formats are identified by provenance, never by amount magnitude.
    if (item.amount_total == null || !Number.isFinite(Number(item.amount_total))) return null;
    let amount;
    if (String(order.stripeSessionId || '').startsWith('cs_')) amount = Math.round(Number(item.amount_total) * 100);
    else if (order.fulfillmentMethod === 'pickup' || /Selbstabholung/i.test(String(order.address?.line1 || ''))) amount = Math.round(Number(item.amount_total));
    if (Number.isSafeInteger(amount) && amount >= 0) return amount;
    return null;
}
function publicOrder(order) {
    return {
        id: String(order._id), orderNumber: order.orderNumber, date: order.date,
        status: order.status, paymentStatus: order.paymentStatus,
        amount: order.amount, currency: order.currency, schemaVersion: 2,
        discountAmount: order.discountAmount, shippingAmount: order.shippingAmount,
        address: order.address ? { line1: order.address.line1 || '', line2: order.address.line2 || '', postal_code: order.address.postal_code || '', city: order.address.city || '', country: order.address.country || '' } : null,
        fulfillmentMethod: order.fulfillmentMethod || (/Selbstabholung/i.test(String(order.address?.line1 || '')) ? 'pickup' : 'shipping'),
        items: (order.items || []).map(item => ({ productId: item.productId, variant: item.variant, description: item.description, quantity: item.quantity, amount_total: itemCents(order, item), lineTotalCents: itemCents(order, item), currency: item.currency || order.currency }))
    };
}
module.exports = { itemCents, publicOrder };
