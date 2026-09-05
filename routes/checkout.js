const crypto = require('node:crypto');
const CheckoutRequest = require('../models/CheckoutRequest');
const { findCoupon, reserveCoupon } = require('../services/couponService');
const policy = require('../config/commerce');

function registerCheckoutRoutes(app, deps) {
    const { Order, User, cartService, checkoutService, checkoutLimiter, requireTrustedOrigin, requireCsrfToken, sanitizeEmail, sanitizeText, allocateOrderNumber, resend, buildFrontendPageUrl, buildPickupOrderConfirmationEmailPayload, buildPickupOrderInternalEmailPayload, INTERNAL_ORDER_NOTIFICATION_EMAIL, CHECKOUT_DRY_RUN } = deps;
    const guards = [checkoutLimiter, requireTrustedOrigin, requireCsrfToken];
    const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
    async function prepare(req, pickup) {
        const email = sanitizeEmail(req.body.customerEmail || '');
        if ((pickup || req.body.customerEmail) && !email) fail('Bitte gib eine gültige E-Mail-Adresse ein.');
        const name = sanitizeText(req.body.customerName || '', 120);
        if (pickup && !name) fail('Bitte gib deinen Namen ein.');
        const quote = await cartService.calculate(req.body.items);
        const key = req.get('Idempotency-Key') || req.body.checkoutRequestId;
        const coupon = req.body.couponCode ? await findCoupon(req.body.couponCode, key) : null;
        if (req.body.couponCode && !coupon) fail('Gutschein ungültig, verbraucht oder für einen anderen Checkout reserviert.', 409);
        if (coupon && (!Number.isFinite(coupon.discount) || coupon.discount < 0 || coupon.discount > 100)) fail('Gutscheinkonfiguration ungültig.', 409);
        const discount = coupon ? Math.round(quote.subtotalCents * coupon.discount / 100) : 0;
        const shipping = pickup || quote.subtotalCents >= policy.freeShippingThresholdCents || coupon?.freeShipping ? 0 : policy.shippingCents;
        const owner = req.userSession?.userId ? await User.findOne({ id: req.userSession.userId, emailVerifiedAt: { $ne: null } }) : null;
        const actor = req.userSession?.userId || crypto.createHash('sha256').update(String(req.csrfToken).split('.')[0]).digest('hex');
        return { quote, key, coupon, discount, shipping, email, name, actor, userId: owner?.id, total: quote.subtotalCents - discount + shipping };
    }
    app.get('/api/commerce-config', (req, res) => res.json(policy));
    app.post('/create-checkout-session', ...guards, async (req, res) => {
        let record;
        try {
            const data = await prepare(req, false);
            if (CHECKOUT_DRY_RUN) return res.json({ safeMode: true, couponApplied: !!data.coupon, couponCode: data.coupon?.code || '', subtotalCents: data.quote.subtotalCents, discountAmountCents: data.discount, couponFreeShipping: !!data.coupon?.freeShipping, shippingRateCents: data.shipping, totalCents: data.total });
            const state = await checkoutService.begin({ key: data.key, fingerprint: { items: req.body.items, email: data.email, coupon: req.body.couponCode || '' }, actor: data.actor, userId: data.userId, mode: 'stripe' });
            record = state.record;
            if (state.complete) return res.json({ url: record.url });
            const config = { mode: 'payment', line_items: data.quote.stripeItems, billing_address_collection: 'required', shipping_address_collection: { allowed_countries: policy.countries }, tax_id_collection: { enabled: true }, shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: data.shipping, currency: policy.currency }, display_name: data.shipping ? 'Standardversand' : 'Kostenloser Versand', delivery_estimate: { minimum: { unit: 'business_day', value: policy.deliveryBusinessDays.min }, maximum: { unit: 'business_day', value: policy.deliveryBusinessDays.max } } } }], cancel_url: buildFrontendPageUrl('cancel.html'), success_url: buildFrontendPageUrl('success.html'), metadata: { couponCode: data.coupon?.code || '', discountAmountCents: String(data.discount), discountPercent: String(data.coupon?.discount || 0), freeShippingCoupon: data.coupon?.freeShipping ? '1' : '0' } };
            if (data.email) config.customer_email = data.email;
            const session = await checkoutService.createStripeSession(record, config, data.coupon);
            res.json({ url: session.url });
        } catch (error) { await checkoutService.releaseLease(record, error); throw error; }
    });
    app.post('/create-pickup-order', ...guards, async (req, res) => {
        let record;
        try {
            const data = await prepare(req, true);
            const key = data.key || (CHECKOUT_DRY_RUN ? crypto.randomUUID() : '');
            const state = await checkoutService.begin({ key, fingerprint: { items: req.body.items, email: data.email, name: data.name, coupon: req.body.couponCode || '' }, actor: data.actor, userId: data.userId, mode: 'pickup' });
            record = state.record;
            if (state.complete) return res.json({ success: true, orderId: record.orderId, orderNumber: record.orderNumber, safeMode: CHECKOUT_DRY_RUN });
            if (data.coupon) {
                await reserveCoupon(data.coupon.code, key);
                await CheckoutRequest.updateOne({ key, lease: record.lease }, { $set: { couponCode: data.coupon.code } });
            }
            let order = await Order.findOne({ checkoutRequestId: key });
            if (!order) order = await Order.create({ schemaVersion: 2, checkoutRequestId: key, userId: data.userId || null, orderNumber: await allocateOrderNumber(), email: data.email, name: data.name, amount: data.total, currency: 'eur', discountAmount: data.discount, couponCode: data.coupon?.code || '', fulfillmentMethod: 'pickup', paymentMethod: 'cash', paymentStatus: 'unpaid', address: { line1: 'Selbstabholung (Zahlung vor Ort)', country: 'DE' }, items: data.quote.items, pendingNotifications: ['pickup-confirmation', 'pickup-internal'] });
            const common = { orderNumber: order.orderNumber, customerName: order.name, customerEmail: order.email, discountAmountCents: order.discountAmount, couponCode: order.couponCode, totalAmountCents: order.amount };
            const mail = buildPickupOrderConfirmationEmailPayload({ ...common, items: order.items.map(item => ({ ...item.toObject(), amountText: (item.lineTotalCents / 100).toFixed(2).replace('.', ',') })) });
            await resend.enqueue(`pickup-confirmation:${order._id}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to: order.email, subject: mail.subject, html: mail.html });
            const internal = buildPickupOrderInternalEmailPayload({ ...common, items: order.items, receivedAtText: order.date.toLocaleString('de-DE') });
            await resend.enqueue(`pickup-internal:${order._id}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to: INTERNAL_ORDER_NOTIFICATION_EMAIL, subject: internal.subject, html: internal.html });
            await Order.updateOne({ _id: order._id }, { $pull: { pendingNotifications: { $in: ['pickup-confirmation', 'pickup-internal'] } } });
            await CheckoutRequest.updateOne({ key, lease: record.lease }, { $set: { status: 'complete', orderId: order._id, orderNumber: order.orderNumber, lockedUntil: null } });
            res.json({ success: true, orderId: order._id, orderNumber: order.orderNumber, safeMode: CHECKOUT_DRY_RUN });
        } catch (error) { await checkoutService.releaseLease(record, error); throw error; }
    });
}
module.exports = { registerCheckoutRoutes };
