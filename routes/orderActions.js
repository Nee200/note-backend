const AdminAudit = require('../models/AdminAudit');
const Invoice = require('../models/Invoice');
const CheckoutRequest = require('../models/CheckoutRequest');
const Subscriber = require('../models/Subscriber');
const { redeemCoupon, releaseCoupon } = require('../services/couponService');
const conflict = message => Object.assign(new Error(message), { status: 409 });

function registerOrderActions(app, deps) {
    const { Order, isAdmin, adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, ensureOrderNumber, sanitizeTrackingUrl, resend, buildShippingEmailPayload, buildPickupReadyEmailPayload, ensureInvoiceForOrder, INVOICES_ENABLED, stripe } = deps;
    const guards = [adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'Bitte als Administrator anmelden.' })];
    async function load(id) {
        if (!/^[a-f0-9]{24}$/i.test(id)) throw Object.assign(new Error('Ungültige Bestell-ID.'), { status: 400 });
        const order = await Order.findById(id);
        if (!order) throw Object.assign(new Error('Bestellung nicht gefunden.'), { status: 404 });
        await ensureOrderNumber(order); return order;
    }
    const pickup = order => order.fulfillmentMethod === 'pickup' || (!order.fulfillmentMethod && /Selbstabholung/i.test(order.address?.line1 || ''));
    const audit = (req, action, order, details) => AdminAudit.create({ actor: req.adminSession.adminId || 'owner', action, target: String(order._id), details });
    async function finishCancellation(order) {
        await releaseCoupon(order.couponCode, order.checkoutRequestId);
        if (order.checkoutRequestId) await CheckoutRequest.updateOne({ key: order.checkoutRequestId }, { $set: { status: 'expired' } });
    }
    async function checkLegacyCashCoupon(order) {
        if (!order.couponCode || order.checkoutRequestId) return;
        // The old pickup flow consumed the coupon when creating the order.
        // Never overwrite a reservation/redemption that belongs to another order.
        const coupon = await Subscriber.findOne({ code: order.couponCode });
        if (!coupon?.used || coupon.reservationKey || coupon.redeemedBy) throw conflict('Der Gutschein dieser Altbestellung muss vor der Barzahlung einzeln abgeglichen werden.');
    }
    app.post('/api/admin/orders/:id/financial-record', ...guards, async (req, res) => {
        const order = await load(req.params.id);
        const reference = String(req.body.reference || '').trim();
        if (!reference || reference.length > 120) throw Object.assign(new Error('Bitte die Referenz des Erstattungs-/Korrekturbelegs angeben.'), { status: 400 });
        if (!(order.refundedAmountCents > 0) && !order.disputeStatus) throw conflict('Für diese Bestellung ist kein Erstattungs- oder Streitfall erfasst.');
        await audit(req, 'order.financial-record.requested', order, { reference });
        const result = await Order.updateOne({ _id: order._id, refundedAmountCents: order.refundedAmountCents || 0, disputeStatus: order.disputeStatus || null }, { $set: { financialResolutionReference: reference, financialReviewedAt: new Date(), financialReviewedBy: req.adminSession.adminId, financialReviewedAmountCents: order.refundedAmountCents || 0, financialReviewedDisputeStatus: order.disputeStatus || '' } });
        if (!result.matchedCount) throw conflict('Der Zahlungsstand hat sich geändert. Bitte erneut prüfen.');
        await audit(req, 'order.financial-record.applied', order, { reference });
        res.json({ success: true });
    });
    app.put('/api/admin/orders/:id/status', ...guards, async (req, res) => {
        const order = await load(req.params.id); const status = req.body.status;
        const transitions = { neu: ['neu', 'in_bearbeitung', 'abgeschlossen', 'archiv'], in_bearbeitung: ['in_bearbeitung', 'abgeschlossen', 'archiv'], abgeschlossen: ['abgeschlossen', 'archiv'], archiv: ['archiv'] };
        if (!transitions[order.status]?.includes(status)) throw conflict('Dieser Statuswechsel ist nicht zulässig.');
        if (status === 'abgeschlossen' && (order.paymentStatus !== 'paid' || order.refundedAmountCents > 0 || (order.disputeStatus && order.disputeStatus !== 'won'))) throw conflict('Die Bestellung benötigt eine bestätigte, nicht erstattete Zahlung ohne offenen Streitfall.');
        if (status === 'archiv' && !['paid', 'refunded', 'partially_refunded', 'cancelled'].includes(order.paymentStatus)) throw conflict('Bitte eine offene Bestellung zuerst ausdrücklich stornieren.');
        const trackingUrl = sanitizeTrackingUrl(req.body.trackingUrl || order.trackingUrl || '');
        if (req.body.trackingUrl && !trackingUrl) throw Object.assign(new Error('Ungültiger Tracking-Link.'), { status: 400 });
        const patch = { status, statusUpdatedAt: new Date(), trackingUrl };
        if (status === 'abgeschlossen') patch.shippedAt = order.shippedAt || new Date();
        if (status === 'abgeschlossen' && INVOICES_ENABLED && order.stripeSessionId) patch.invoicePending = true;
        await audit(req, 'order.status.requested', order, { from: order.status, to: status });
        const updated = await Order.findOneAndUpdate({ _id: order._id, status: order.status, paymentStatus: order.paymentStatus, refundedAmountCents: { $in: [order.refundedAmountCents || 0, null] }, disputeStatus: order.disputeStatus || null }, { $set: patch, ...(status === 'abgeschlossen' && !pickup(order) ? { $addToSet: { pendingNotifications: 'shipping' } } : {}) }, { returnDocument: 'after', runValidators: true });
        if (!updated) throw conflict('Die Bestellung wurde inzwischen geändert. Bitte neu laden.');
        // Always ensure the persistent side effect, including retries after a
        // previous failure between the state change and enqueue.
        if (status === 'abgeschlossen' && !pickup(updated) && updated.email) {
            const mail = buildShippingEmailPayload({ orderNumber: updated.orderNumber, customerName: updated.name || 'du', trackingUrl });
            await resend.enqueue(`shipping:${updated._id}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to: updated.email, subject: mail.subject, html: mail.html });
            await Order.updateOne({ _id: updated._id }, { $pull: { pendingNotifications: 'shipping' } });
        }
        let invoice;
        if (status === 'abgeschlossen' && INVOICES_ENABLED && updated.stripeSessionId) invoice = await ensureInvoiceForOrder({ order: updated, stripeClient: stripe, serviceDate: updated.shippedAt, serviceDateSource: 'admin_shipping_status', generatedBy: 'admin_shipping_status' });
        await audit(req, 'order.status.applied', updated, { status });
        res.json({ success: true, order: updated, invoiceStatus: invoice?.status || updated.invoiceStatus });
    });
    app.delete('/api/admin/orders/:id', ...guards, async (req, res) => {
        const order = await load(req.params.id);
        const hasInvoice = order.invoice || await Invoice.exists({ order: order._id });
        res.status(409).json({ error: hasInvoice ? 'Eine Bestellung mit Rechnung wird nicht gelöscht. Bitte archivieren.' : 'Bestellungen werden aus Nachweisgründen erhalten. Bitte stornieren oder archivieren.' });
    });
    app.post('/api/admin/orders/:id/cancel', ...guards, async (req, res) => {
        const order = await load(req.params.id);
        if (order.paymentStatus === 'cancelled') { await finishCancellation(order); return res.json({ success: true, order }); }
        if (order.paidAt || !['', 'unpaid', 'failed'].includes(order.paymentStatus) || order.invoice || await Invoice.exists({ order: order._id })) throw conflict('Eine bezahlte oder fakturierte Bestellung benötigt einen dokumentierten Erstattungs-/Korrekturvorgang.');
        if (order.stripeSessionId) {
            let session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
            if (session.status === 'open') session = await stripe.checkout.sessions.expire(order.stripeSessionId);
            if (session.status !== 'expired') throw conflict('Stripe hat den Checkout bereits abgeschlossen. Bitte Zahlungsstand abgleichen.');
        }
        await audit(req, 'order.cancel.requested', order, {});
        const updated = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: order.paymentStatus, paidAt: null }, { $set: { status: 'archiv', paymentStatus: 'cancelled', cancelledAt: new Date() } }, { returnDocument: 'after' });
        if (!updated) throw conflict('Zahlungsstand wurde inzwischen geändert.');
        await finishCancellation(updated);
        await audit(req, 'order.cancel.applied', updated, {});
        res.json({ success: true, order: updated });
    });
    app.post('/api/admin/orders/:id/confirm-cash', ...guards, async (req, res) => {
        const order = await load(req.params.id);
        if (!pickup(order) || order.stripeSessionId || order.cancelledAt) throw conflict('Diese Bestellung ist keine offene Barzahlung bei Abholung.');
        const receipt = String(req.body.receiptReference || '').trim();
        if (!receipt || receipt.length > 120 || Number(req.body.receivedAmountCents) !== order.amount) throw Object.assign(new Error('Bitte den tatsächlich erhaltenen Betrag und eine Kassenbelegnummer angeben.'), { status: 400 });
        await checkLegacyCashCoupon(order);
        if (order.cashConfirmedAt) { if (order.checkoutRequestId) await redeemCoupon(order.couponCode, order.checkoutRequestId); return res.json({ success: true, order }); }
        await audit(req, 'order.cash.requested', order, { amountCents: order.amount, receiptReference: receipt });
        const updated = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: { $in: ['', 'unpaid'] }, cashConfirmedAt: null }, { $set: { paymentStatus: 'paid', paymentMethod: 'cash', fulfillmentMethod: 'pickup', paidAt: new Date(), cashConfirmedAt: new Date(), cashConfirmedBy: req.adminSession.adminId || 'owner', cashReceiptReference: receipt, invoiceStatus: 'manual_review', invoiceError: 'Kassenbeleg extern dokumentiert: ' + receipt } }, { returnDocument: 'after' });
        if (!updated) throw conflict('Die Zahlung wurde inzwischen geändert.');
        if (updated.checkoutRequestId) await redeemCoupon(updated.couponCode, updated.checkoutRequestId);
        await audit(req, 'order.cash.applied', updated, { receiptReference: receipt });
        res.json({ success: true, order: updated });
    });
    app.post('/api/admin/orders/:id/notify-pickup', ...guards, async (req, res) => {
        const order = await load(req.params.id);
        if (!pickup(order) || order.cancelledAt || order.status === 'archiv' || order.status === 'abgeschlossen') throw conflict('Für diese Bestellung ist keine Abholbenachrichtigung zulässig.');
        const mail = buildPickupReadyEmailPayload({ orderNumber: order.orderNumber, customerName: order.name || 'du', amountCents: order.amount });
        await resend.emails.send({ from: 'NOTE. fragrances <info@note-fragrances.de>', to: order.email, subject: mail.subject, html: mail.html }, { idempotencyKey: `pickup-ready:${order._id}` });
        order.pickupEmailSent = true; await order.save();
        await audit(req, 'order.pickup-mail.accepted', order, {});
        res.json({ success: true, order });
    });
}
module.exports = { registerOrderActions };
