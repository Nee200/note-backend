async function listAllLineItems(stripe, sessionId) {
    const items = []; let cursor;
    for (let page = 0; page < 100; page++) {
        const response = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ['data.price.product'], ...(cursor ? { starting_after: cursor } : {}) });
        if (!Array.isArray(response?.data)) throw new Error('Stripe lieferte keine gültigen Positionen.');
        items.push(...response.data);
        if (!response.has_more) {
            if (!items.length) throw new Error('Stripe-Session enthält keine Positionen.');
            return items;
        }
        const next = response.data.at(-1)?.id;
        if (!next || next === cursor) throw new Error('Stripe-Pagination ist unvollständig.');
        cursor = next;
    }
    throw new Error('Stripe-Pagination überschreitet das Sicherheitslimit.');
}
function assertCheckoutTotals(session, items) {
    const subtotal = items.reduce((sum, item) => {
        const amount = item.amount_subtotal;
        if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Ungültige Stripe-Position.');
        return sum + amount;
    }, 0);
    const discount = session.total_details?.amount_discount || 0;
    const shipping = session.shipping_cost?.amount_total || 0;
    if (!Number.isSafeInteger(session.amount_total) || !Number.isSafeInteger(session.amount_subtotal) || subtotal !== session.amount_subtotal || subtotal - discount + shipping !== session.amount_total) throw new Error('Stripe-Positionssumme stimmt nicht mit der Bestellung überein.');
    return { subtotal, discount, shipping, total: session.amount_total };
}
module.exports = { listAllLineItems, assertCheckoutTotals };
