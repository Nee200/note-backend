const publicProductNames = require('../publicProductNames.json');
const { imagePath } = require('./publicProduct');

function createDuftrollerResolver({ Product }) {
    const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
    return async function resolveDuftrollerItem(item) {
        const id = String(item?.id || '').trim().toUpperCase();
        if (!id.startsWith('DUFTROLLER')) return null;
        const match = id.match(/^DUFTROLLER-(6|10|14)-([GL]\d{1,4})$/);
        if (!match) fail('Ungültige Duftroller-Variante. Bitte wähle Größe und Duft erneut.');
        const [, size, scentId] = match;
        // The encoded cart ID is the only authority for size and scent. Reject
        // conflicting optional display fields instead of silently misordering.
        if ((item.size !== undefined && String(item.size) !== size)
            || (item.scentId !== undefined && String(item.scentId).toUpperCase() !== scentId)
            || (item.productId !== undefined && item.productId !== 'DUFTROLLER')
            || (item.productType !== undefined && item.productType !== 'duftroller')) {
            fail('Größe und Duftfüllung stimmen nicht mit dem gewählten Duftroller überein.');
        }
        const [product, scentProduct] = await Promise.all([
            Product.findOne({ id: 'DUFTROLLER' }),
            Product.findOne({ id: scentId })
        ]);
        const price = product?.variants?.[size]?.price;
        const priceCents = Math.round(price * 100);
        if (!product || product.category !== 'duftroller' || !Number.isFinite(price)
            || !Number.isSafeInteger(priceCents) || priceCents <= 0 || priceCents > 1000000
            || Math.abs(price * 100 - priceCents) > 0.000001) {
            fail('Der Duftroller ist in dieser Größe derzeit nicht verfügbar.', 404);
        }
        if (!scentProduct || !['men', 'women'].includes(scentProduct.category)) {
            fail(`Die gewählte Duftfüllung ${scentId} ist nicht verfügbar.`, 404);
        }
        const scentName = publicProductNames[scentId] || scentProduct.name || scentId;
        const images = (product.images || []).map(imagePath).filter(Boolean);
        const imageUrl = images.find(path => new RegExp(`/note-duftroller-${size}-closed-v\\d+\\.webp$`).test(path)) || images[0] || '';
        return {
            product, scentProduct, size, scentId, scentName, priceCents, imageUrl,
            description: `${product.name || 'NØTE. Duftroller'} (${size} ml) · ${scentId} – ${scentName}`
        };
    };
}

module.exports = { createDuftrollerResolver };
