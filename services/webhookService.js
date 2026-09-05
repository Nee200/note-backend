const crypto = require('node:crypto');
const WebhookEvent = require('../models/WebhookEvent');
const WorkLock = require('../models/WorkLock');
const CheckoutRequest = require('../models/CheckoutRequest');
const { listAllLineItems, assertCheckoutTotals } = require('./stripeData');
const { redeemCoupon, releaseCoupon } = require('./couponService');
const checkoutTypes = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']);
const paymentTypes = new Set(['charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);

function createWebhookService({ stripe, Order, Product, allocateOrderNumber, ensureInvoiceForOrder, invoicesEnabled, resolveCustomer, resend, buildOrderConfirmationEmailPayload }) {
    async function withSessionLock(id, work) {
        const key = `stripe:${id}`, lease = crypto.randomUUID();
        let lock;
        try { lock = await WorkLock.findOneAndUpdate({ key, $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: null }] }, { $set: { lease, expiresAt: new Date(Date.now() + 600000) } }, { upsert: true, returnDocument: 'after' }); }
        catch (error) { if (error.code !== 11000) throw error; }
        if (!lock) throw new Error('Diese Zahlung wird bereits verarbeitet.');
        try { return await work(); } finally { await WorkLock.deleteOne({ key, lease }); }
    }
    async function sessionForPayment(event) {
        const object = event.data.object;
        const charge = event.type === 'charge.refunded' ? object : typeof object.charge === 'string' ? await stripe.charges.retrieve(object.charge) : object.charge;
        const intent = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id;
        if (!intent) throw new Error('Zahlungsereignis ohne PaymentIntent.');
        const order = await Order.findOne({ stripePaymentIntentId: intent });
        if (order) return { sessionId: order.stripeSessionId, charge };
        const sessions = await stripe.checkout.sessions.list({ payment_intent: intent, limit: 2 });
        if (sessions.data?.length !== 1) throw new Error('Checkout zur Zahlung konnte nicht eindeutig zugeordnet werden.');
        return { sessionId: sessions.data[0].id, charge };
    }
    async function processSession(event, sessionId, charge) {
        return withSessionLock(sessionId, async () => {
            // Canonical provider state takes precedence over delivery order.
            const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent', 'payment_intent.latest_charge'] });
            const key = String(session.metadata?.checkoutRequestId || '');
            const request = key ? await CheckoutRequest.findOne({ key }) : null;
            if (session.status === 'expired') {
                if (request) {
                    await releaseCoupon(request.couponCode, key);
                    await CheckoutRequest.updateOne({ key }, { $set: { status: 'expired' } });
                }
                return;
            }
            const rawItems = await listAllLineItems(stripe, sessionId);
            const totals = assertCheckoutTotals(session, rawItems);
            const items = [];
            for (const item of rawItems) {
                const metadata = item.price?.product?.metadata || {};
                const nameMatch = String(item.description || '').match(/^(.+?)\s*\((30|50|100)ml\)/);
                const product = metadata.productId ? await Product.findOne({ id: metadata.productId }) : nameMatch ? await Product.findOne({ name: nameMatch[1].trim() }) : null;
                const productId = metadata.productId || product?.id || '';
                const variant = metadata.variant || metadata.scentId || nameMatch?.[2] || '';
                const unit = item.price?.unit_amount ?? Math.round(item.amount_subtotal / item.quantity);
                if (!Number.isSafeInteger(unit) || unit * item.quantity !== item.amount_subtotal) throw new Error('Stripe-Einzelpreis passt nicht zur Positionssumme.');
                items.push({ productId, sku: metadata.sku || `${productId}-${variant}`, variant, internalId: productId, supplierId: metadata.supplierId || '', imageUrl: metadata.imageUrl || product?.images?.[0] || '', description: String(item.description || '').slice(0, 500), quantity: item.quantity, unitAmountCents: unit, lineTotalCents: item.amount_subtotal, amount_total: item.amount_subtotal, currency: item.currency || session.currency });
            }
            const customer = await resolveCustomer(session);
            if (!customer.email) throw new Error('Stripe-Bestellung ohne gültige Kundenadresse.');
            let order = await Order.findOne({ stripeSessionId: sessionId });
            const fresh = !order;
            if (!order) order = new Order({ orderNumber: await allocateOrderNumber(), stripeSessionId: sessionId, date: new Date((session.created || event.created) * 1000), status: 'neu', pendingNotifications: ['order-confirmation'] });
            if (!order.confirmationPolicy) order.confirmationPolicy = fresh || order.schemaVersion === 2 ? 'send' : 'legacy-review';
            if (!order.orderNumber) order.orderNumber = await allocateOrderNumber();
            const alreadyPaid = ['paid', 'refunded', 'partially_refunded'].includes(order.paymentStatus);
            const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required' || alreadyPaid;
            Object.assign(order, { schemaVersion: 2, email: customer.email, name: customer.name, address: customer.address, items, amount: totals.total, discountAmount: totals.discount, shippingAmount: totals.shipping, currency: session.currency || 'eur', fulfillmentMethod: 'shipping', paymentMethod: 'stripe', stripeEventId: event.id, stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || order.stripePaymentIntentId, couponCode: session.metadata?.couponCode || '', ...(key ? { checkoutRequestId: key } : {}) });
            if (fresh) order.userId = request?.userId || null;
            if (!alreadyPaid) order.paymentStatus = paid ? 'paid' : event.type === 'checkout.session.async_payment_failed' || order.paymentStatus === 'failed' ? 'failed' : 'unpaid';
            if (paid && !order.paidAt) order.paidAt = new Date((session.payment_intent?.latest_charge?.created || event.created) * 1000);
            if (!order.invoice) {
                order.invoiceStatus = paid ? (totals.total === 0 ? 'manual_review' : 'awaiting_service_date') : 'awaiting_payment';
                if (paid && totals.total === 0) order.invoiceError = 'Nullbetrag: Dokumentation der kostenlosen Abgabe prüfen.';
            }
            if (charge && event.type === 'charge.refunded') {
                order.refundedAmountCents = Math.max(order.refundedAmountCents || 0, charge.amount_refunded || 0);
                order.paymentStatus = order.refundedAmountCents >= order.amount ? 'refunded' : 'partially_refunded';
            }
            if (paymentTypes.has(event.type) && event.type !== 'charge.refunded') order.disputeStatus = (await stripe.disputes.retrieve(event.data.object.id)).status;
            await order.save(); // failures must propagate; never substitute a local JSON file
            if (paid && order.couponCode) {
                if (key) await redeemCoupon(order.couponCode, key);
                else {
                    // Historic sessions predate reservations. Preserve the paid
                    // order and flag any collision for operator reconciliation.
                    const Subscriber = require('../models/Subscriber');
                    const result = await Subscriber.updateOne({ code: order.couponCode, reservationKey: null, $or: [{ redeemedBy: null }, { redeemedBy: sessionId }] }, { $set: { used: true, redeemedBy: sessionId, redeemedAt: new Date() } });
                    if (!result.matchedCount) throw new Error('Historischer Gutschein kollidiert mit einer Reservierung.');
                }
            }
            if (request) {
                if (order.paymentStatus === 'failed') await releaseCoupon(order.couponCode, key);
                await CheckoutRequest.updateOne({ key }, { $set: { status: order.paymentStatus === 'failed' ? 'failed' : 'complete', paymentSettled: paid || order.paymentStatus === 'failed', stripeSessionId: sessionId, orderId: order._id, orderNumber: order.orderNumber, lockedUntil: null } });
            }
            const mail = buildOrderConfirmationEmailPayload({ orderNumber: order.orderNumber, customerName: order.name || 'Kunde', items: items.map(item => ({ ...item, amountText: (item.lineTotalCents / 100).toFixed(2).replace('.', ',') })), shippingCostCents: totals.shipping, discountAmountCents: totals.discount, couponCode: order.couponCode, totalAmountCents: order.amount, address: order.address });
            if (order.confirmationPolicy === 'send') await resend.enqueue(`order-confirmation:${order._id}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to: order.email, subject: mail.subject, html: mail.html });
            await Order.updateOne({ _id: order._id }, { $pull: { pendingNotifications: 'order-confirmation' } });
            if (invoicesEnabled && paid && order.amount > 0 && !['refunded', 'partially_refunded'].includes(order.paymentStatus)) await ensureInvoiceForOrder({ order, stripeClient: stripe, generatedBy: 'stripe_webhook' });
        });
    }
    async function process(eventId) {
        const record = await WebhookEvent.findOneAndUpdate({ eventId, status: { $in: ['pending', 'processing'] }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] }, { $set: { status: 'processing', lockedUntil: new Date(Date.now() + 600000) }, $inc: { attempts: 1 } }, { returnDocument: 'after' }).select('+payload');
        if (!record) {
            const existing = await WebhookEvent.findOne({ eventId });
            if (existing && ['processed', 'ignored'].includes(existing.status)) return;
            throw new Error('Ereignis wird bereits verarbeitet.');
        }
        try {
            const event = record.payload;
            let handled = false;
            if (checkoutTypes.has(event.type)) { await processSession(event, event.data.object.id); handled = true; }
            else if (paymentTypes.has(event.type)) { const { sessionId, charge } = await sessionForPayment(event); await processSession(event, sessionId, charge); handled = true; }
            await WebhookEvent.updateOne({ _id: record._id }, { $set: { status: handled ? 'processed' : 'ignored', processedAt: new Date(), lockedUntil: null, lastError: '', expiresAt: new Date(Date.now() + 90 * 86400000) } });
        } catch (error) {
            await WebhookEvent.updateOne({ _id: record._id }, { $set: { status: 'pending', lockedUntil: null, lastError: String(error.message).slice(0, 250), nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(record.attempts, 7))) } });
            throw error;
        }
    }
    async function receive(event) {
        if (!event?.id || !event.type || !event.data?.object) throw new Error('Ungültiges Stripe-Ereignis.');
        try { await WebhookEvent.updateOne({ eventId: event.id }, { $setOnInsert: { type: event.type, payload: event, status: 'pending' } }, { upsert: true, setDefaultsOnInsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; }
        await process(event.id);
    }
    async function processPending() {
        await WebhookEvent.updateMany({ status: { $in: ['processed', 'ignored'] }, expiresAt: { $lte: new Date() }, payload: { $exists: true } }, { $unset: { payload: 1 } });
        const pending = await WebhookEvent.find({ status: { $in: ['pending', 'processing'] }, nextAttemptAt: { $lte: new Date() }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] }).sort({ createdAt: 1 }).limit(20);
        for (const record of pending) { try { await process(record.eventId); } catch { /* durable retry state */ } }
    }
    return { receive, processPending };
}
module.exports = { createWebhookService };
