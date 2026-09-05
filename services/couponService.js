const Subscriber = require('../models/Subscriber');
const fail = () => Object.assign(new Error('Der Gutschein ist ungültig, bereits eingelöst oder für einen anderen Checkout reserviert.'), { statusCode: 409 });
function normalizeCode(code) { return typeof code === 'string' && /^[A-Z0-9-]{4,40}$/i.test(code.trim()) ? code.trim().toUpperCase() : ''; }
async function findCoupon(code, key) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    return Subscriber.findOne({ code: normalized, $or: [
        { used: false, status: 'active', reservationKey: null },
        ...(key ? [{ used: false, reservationKey: key }, { used: true, redeemedBy: key }] : [])
    ] });
}
async function reserveCoupon(code, key) {
    if (typeof key !== 'string' || !key) throw fail();
    const normalized = normalizeCode(code);
    if (!normalized) throw fail();
    const coupon = await Subscriber.findOneAndUpdate({ code: normalized, $or: [{ used: false, status: 'active', reservationKey: null }, { used: false, reservationKey: key }, { used: true, redeemedBy: key }] }, { $set: { reservationKey: key, reservedAt: new Date() } }, { returnDocument: 'after' });
    if (!coupon) throw fail();
    return coupon;
}
async function redeemCoupon(code, key) {
    if (!code) return;
    if (typeof key !== 'string' || !key) throw fail();
    const result = await Subscriber.updateOne({ code: normalizeCode(code), $or: [{ reservationKey: key }, { used: true, redeemedBy: key }] }, { $set: { used: true, redeemedBy: key, redeemedAt: new Date() } });
    if (!result.matchedCount) throw new Error('Gutscheinreservierung passt nicht zur bezahlten Bestellung.');
}
async function releaseCoupon(code, key) {
    if (!code || typeof key !== 'string' || !key) return;
    await Subscriber.updateOne({ code: normalizeCode(code), used: false, reservationKey: key }, { $set: { reservationKey: null }, $unset: { reservedAt: 1 } });
}
module.exports = { findCoupon, reserveCoupon, redeemCoupon, releaseCoupon, normalizeCode };
