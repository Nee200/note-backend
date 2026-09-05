function createStripeClient(env) {
    if (env.LOCAL_DEV_SAFE_MODE === 'true' || env.NODE_ENV === 'test') {
        const blocked = () => { throw new Error('Stripe ist im lokalen Testmodus deaktiviert.'); };
        return { checkout: { sessions: { create: blocked, retrieve: blocked, listLineItems: blocked, expire: blocked } }, coupons: { create: blocked }, webhooks: { constructEvent: blocked } };
    }
    return require('stripe')(env.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 2 });
}
module.exports = { createStripeClient };
