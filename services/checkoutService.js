const crypto = require('node:crypto');
const CheckoutRequest = require('../models/CheckoutRequest');
const { reserveCoupon, releaseCoupon } = require('./couponService');
const conflict = message => Object.assign(new Error(message), { statusCode: 409 });

function createCheckoutService({ stripe, onCompleted }) {
    async function begin({ key, fingerprint, actor, userId, mode }) {
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(key || ''))) throw Object.assign(new Error('Checkout-Kennung fehlt oder ist ungültig. Bitte starte den Checkout erneut.'), { statusCode: 400 });
        const digest = crypto.createHash('sha256').update(JSON.stringify({ fingerprint, actor, mode })).digest('hex');
        let record;
        try { record = await CheckoutRequest.findOneAndUpdate({ key }, { $setOnInsert: { fingerprint: digest, actor, userId, mode } }, { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; record = await CheckoutRequest.findOne({ key }); }
        if (record.fingerprint !== digest) throw conflict('Die Checkout-Kennung gehört zu einem anderen Warenkorb.');
        if (['expired', 'manual_review', 'failed'].includes(record.status)) throw Object.assign(conflict('Dieser Checkout ist nicht mehr verfügbar. Bitte starte einen neuen.'), { code: 'CHECKOUT_RESTART' });
        if (record.status === 'open' || record.status === 'complete') return { record, complete: true };
        const lease = crypto.randomUUID();
        record = await CheckoutRequest.findOneAndUpdate({ key, status: 'pending', $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] }, { $set: { lease, lockedUntil: new Date(Date.now() + 120000) } }, { returnDocument: 'after' }).select('+stripeConfig');
        if (!record) throw conflict('Der Checkout wird bereits erstellt. Bitte versuche es gleich erneut.');
        if (Date.now() - record.createdAt.getTime() > 23 * 3600000) {
            await CheckoutRequest.updateOne({ key, lease }, { $set: { status: 'manual_review', lockedUntil: null } });
            throw conflict('Dieser Checkout benötigt eine Prüfung. Bitte kontaktiere den Shop.');
        }
        return { record, complete: false };
    }

    async function createStripeSession(record, config, coupon) {
        let savedConfig = record.stripeConfig;
        if (!savedConfig) {
            savedConfig = { ...config, expires_at: Math.floor(Date.now() / 1000) + 1900, metadata: { ...config.metadata, checkoutRequestId: record.key, userId: record.userId || '' } };
            await CheckoutRequest.updateOne({ key: record.key, lease: record.lease }, { $set: { stripeConfig: savedConfig, couponCode: coupon?.code || '' } });
        }
        if (coupon) {
            await reserveCoupon(coupon.code, record.key);
            if (!savedConfig.discounts && Number(savedConfig.metadata.discountAmountCents) > 0) {
                const result = await stripe.coupons.create({ amount_off: Number(savedConfig.metadata.discountAmountCents), currency: 'eur', duration: 'once', name: coupon.code }, { idempotencyKey: `${record.key}:coupon` });
                savedConfig.discounts = [{ coupon: result.id }];
                await CheckoutRequest.updateOne({ key: record.key, lease: record.lease }, { $set: { stripeConfig: savedConfig } });
            }
        }
        const session = await stripe.checkout.sessions.create(savedConfig, { idempotencyKey: `${record.key}:session` });
        await CheckoutRequest.updateOne({ key: record.key, lease: record.lease }, { $set: { stripeSessionId: session.id, url: session.url, status: 'open', lockedUntil: null } });
        return session;
    }
    async function releaseLease(record, error) {
        if (!record) return;
        await CheckoutRequest.updateOne({ key: record.key, lease: record.lease }, { $set: { lockedUntil: null, lastError: String(error?.message || '').slice(0, 200) } });
        // Keep a coupon reserved on ambiguous provider failures. Only a confirmed
        // expired Stripe session or an explicit pickup cancellation releases it.
    }
    async function reconcileExpired() {
        await CheckoutRequest.updateMany({ status: 'pending', mode: 'stripe', createdAt: { $lt: new Date(Date.now() - 23 * 3600000) }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] }, { $set: { status: 'manual_review', lastError: 'Providerergebnis nicht bestätigt; Reservierung bleibt bis zum Abgleich gesperrt.' } });
        const records = await CheckoutRequest.find({ status: { $in: ['open', 'complete'] }, paymentSettled: { $ne: true }, mode: 'stripe', createdAt: { $lt: new Date(Date.now() - 1800000) }, $or: [{ checkedAt: null }, { checkedAt: { $lt: new Date(Date.now() - 60000) } }] }).sort({ checkedAt: 1 }).limit(20);
        for (const record of records) {
            try {
                const session = await stripe.checkout.sessions.retrieve(record.stripeSessionId);
                if (session.status === 'expired') {
                    await releaseCoupon(record.couponCode, record.key);
                    await CheckoutRequest.updateOne({ _id: record._id }, { $set: { status: 'expired' } });
                } else if (session.status === 'complete' && onCompleted) await onCompleted(session);
                await CheckoutRequest.updateOne({ _id: record._id }, { $set: { checkedAt: new Date() } });
            } catch (error) { await CheckoutRequest.updateOne({ _id: record._id }, { $set: { checkedAt: new Date(), lastError: String(error.message).slice(0, 200) } }); }
        }
    }
    return { begin, createStripeSession, releaseLease, reconcileExpired };
}
module.exports = { createCheckoutService };
