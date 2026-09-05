const names = require('../publicProductNames.json');
function imagePath(value) {
    let path = String(value || '').replace(/^\.\//, '').replace(/^\//, '').split('?')[0];
    if (!/^(?:images_[a-z]+\/[a-zA-Z0-9_./ äöüÄÖÜß-]+|logo)\.(?:png|jpe?g|webp|avif|svg)$/i.test(path) || path.includes('..')) return '';
    return path.replace(/parfume_men\.png$/i, 'parfume_mann.png').replace(/parfume_women\.png$/i, 'parfume_frau.png');
}
function publicProduct(product, summary = { average: 0, count: 0 }) {
    const variants = {};
    for (const size of ['30', '50', '100']) {
        const value = product.variants?.[size];
        if (!value || !Number.isFinite(value.price) || value.price <= 0) continue;
        variants[size] = { price: value.price, ...(Number.isFinite(value.originalPrice) && value.originalPrice > value.price ? { originalPrice: value.originalPrice } : {}) };
    }
    const images = (product.images || []).map(imagePath).filter(Boolean);
    return {
        id: product.id, name: product.name, category: product.category,
        publicName: names[String(product.id || '').toUpperCase()] || String(product.name || product.id || 'NØTE. Duft'),
        inspiredBy: product.inspiredBy || '', description: product.description || '',
        longDescription: product.longDescription || '',
        notes: { head: product.notes?.head || '', heart: product.notes?.heart || '', base: product.notes?.base || '' },
        images: images.length ? images : [product.category === 'women' ? 'images_parfume/parfume_frau.png' : 'images_parfume/parfume_mann.png'],
        bestseller: product.bestseller === true, newArrival: product.newArrival === true,
        variants, reviewSummary: summary
    };
}
module.exports = { publicProduct, imagePath };
