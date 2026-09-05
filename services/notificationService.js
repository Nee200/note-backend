const { itemCents } = require('./orderData');
function createNotificationService({ Order, resend, builders, internalEmail }) {
    async function flushOrder(order) {
        for (const kind of order.pendingNotifications || []) {
            const cents = item => itemCents(order, item);
            const common = { orderNumber: order.orderNumber, customerName: order.name || 'Kunde', customerEmail: order.email, discountAmountCents: order.discountAmount, couponCode: order.couponCode, totalAmountCents: order.amount, address: order.address };
            let mail, to = order.email;
            if (kind === 'shipping') mail = builders.shipping({ ...common, trackingUrl: order.trackingUrl || '' });
            else if (kind === 'order-confirmation') mail = builders.order({ ...common, shippingCostCents: order.shippingAmount, items: order.items.map(item => ({ description: item.description, quantity: item.quantity, imageUrl: item.imageUrl, amountText: cents(item) == null ? 'wird geprüft' : (cents(item) / 100).toFixed(2).replace('.', ',') })) });
            else if (kind === 'pickup-confirmation') mail = builders.pickup({ ...common, items: order.items.map(item => ({ description: item.description, quantity: item.quantity, imageUrl: item.imageUrl, amountText: cents(item) == null ? 'wird geprüft' : (cents(item) / 100).toFixed(2).replace('.', ',') })) });
            else if (kind === 'pickup-internal') { to = internalEmail; mail = builders.pickupInternal({ ...common, items: order.items, receivedAtText: order.date.toLocaleString('de-DE') }); }
            else throw new Error('Unbekannte Bestellbenachrichtigung.');
            if (!to) throw new Error('Empfänger für Bestellbenachrichtigung fehlt.');
            await resend.enqueue(`${kind}:${order._id}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to, subject: mail.subject, html: mail.html });
            await Order.updateOne({ _id: order._id }, { $pull: { pendingNotifications: kind } });
        }
    }
    async function processPending() {
        const orders = await Order.find({ 'pendingNotifications.0': { $exists: true } }).limit(20);
        for (const order of orders) { try { await flushOrder(order); } catch (error) { console.error('Bestellbenachrichtigung bleibt vorgemerkt:', error.message); } }
    }
    return { flushOrder, processPending };
}
module.exports = { createNotificationService };
