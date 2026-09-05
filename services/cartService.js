function createCartService({ Product, resolveAutoduftItem, resolveSummerBundleItem, sanitizeQuantity, mapSupplier }) {
    const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
    async function calculate(items) {
        if (!Array.isArray(items) || !items.length || items.length > 50) fail('Warenkorb ist leer oder ungültig.');
        const lines = []; const quantities = new Map();
        function add({ product, variant, quantity, unitAmountCents, description, productId, sku, supplierId }) {
            if (!Number.isSafeInteger(unitAmountCents) || unitAmountCents <= 0) fail('Für dieses Produkt ist kein gültiger Preis hinterlegt.', 409);
            const id = productId || product.id;
            const stockKey = `${id}:${variant}`;
            const totalQuantity = (quantities.get(stockKey) || 0) + quantity;
            if (totalQuantity > 20) fail('Pro Produktvariante sind höchstens 20 Stück möglich.');
            quantities.set(stockKey, totalQuantity);
            const line = { productId: id, sku: sku || `${id}-${variant}`, variant: String(variant), internalId: id, supplierId: supplierId || mapSupplier(product) || '', description, quantity, unitAmountCents, lineTotalCents: unitAmountCents * quantity, amount_total: unitAmountCents * quantity, currency: 'eur', imageUrl: product.images?.[0] || '' };
            lines.push(line);
        }
        for (const item of items) {
            if (!item || typeof item.id !== 'string' || item.id.length > 80) fail('Ungültige Produkt-ID.');
            const quantity = sanitizeQuantity(item.quantity);
            if (!quantity) fail('Ungültige Menge.');
            const autoduft = await resolveAutoduftItem(item);
            if (autoduft) {
                add({ product: autoduft.product, productId: 'AUTODUFT', variant: autoduft.scentId, quantity, unitAmountCents: autoduft.priceCents, description: `${autoduft.checkoutName} · ${autoduft.checkoutDescription}` });
                continue;
            }
            const bundleMatch = item.id.match(/^SUMMERBUNDLE-(30|50)$/i);
            if (bundleMatch) {
                const bundle = await resolveSummerBundleItem(item, Number(bundleMatch[1]));
                for (const product of bundle.selectedProducts) add({ product, variant: bundle.size, quantity, unitAmountCents: bundle.pricePerBottleCents, description: `${product.name} (${bundle.size}ml) · Sommerbundle` });
                continue;
            }
            const match = item.id.match(/^([A-Z0-9_-]{1,40})-(30|50|100)$/i);
            if (!match) fail('Ungültige Produktvariante.');
            const product = await Product.findOne({ id: match[1].toUpperCase() });
            const variant = product?.variants?.[match[2]];
            if (!variant) fail('Produktvariante nicht gefunden.', 404);
            add({ product, variant: match[2], quantity, unitAmountCents: Math.round(variant.price * 100), description: `${product.name} (${match[2]}ml)` });
        }
        if (lines.length > 100) fail('Der Warenkorb enthält nach Auflösung der Bundles mehr als 100 Positionen.');
        return {
            items: lines,
            subtotalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
            stripeItems: lines.map(line => ({ quantity: line.quantity, price_data: { currency: 'eur', unit_amount: line.unitAmountCents, product_data: { name: line.description.slice(0, 250), metadata: { productId: line.productId, sku: line.sku, variant: line.variant, supplierId: line.supplierId, imageUrl: line.imageUrl.slice(0, 450) } } } }))
        };
    }
    return { calculate };
}
module.exports = { createCartService };
