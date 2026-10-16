// Reviewed, versioned catalogue references. A changed name never silently remaps a code.
const supplierCatalogue = require('../catalog/supplier-2026-10.json');
const crosswalk = require('../catalog/product-supplier-2026-10.json');
const suppliers = new Map(supplierCatalogue.entries.map(entry => [entry.id, entry]));
const mappings = new Map(crosswalk.entries.map(entry => [entry.productId, entry]));
const labels = Object.freeze({ matched: 'Nach Duftname abgeglichen', review: 'Variante offen', historical: 'Händlerzeile leer', changed: 'Erneut abgleichen', not_in_shop: 'Nicht im Shop', empty: 'Leere Händlerzeile', not_found: 'ID nicht vorhanden', cross_category: 'Gleicher Name in anderer Liste', excluded: 'Bewusst ausgelassen', unmapped: 'Noch nicht abgeglichen', multiple: 'Mehrere Shop-Einträge' });
const sameText = (left, right) => String(left || '').normalize('NFC').trim() === String(right || '').normalize('NFC').trim();

function parseId(value) {
    const match = String(value || '').trim().toUpperCase().replace(/\s+/g, '').match(/^([GLMW])(\d{1,4})$/);
    if (!match || Number(match[2]) < 1) return null;
    const id = `${match[1]}${Number(match[2])}`;
    return { id, prefix: match[1], direction: /^[GL]/.test(id) ? 'internal-to-supplier' : 'supplier-to-internal' };
}
function productSummary(product) {
    return { id: product.id, name: product.publicName || require('../publicProductNames.json')[product.id] || product.name, inspiredBy: product.inspiredBy || '', category: product.category || '' };
}
function reference(id) {
    const row = suppliers.get(id);
    return row ? { supplierId: row.id, inspiredBy: row.name, page: row.page, version: supplierCatalogue.version } : null;
}
function lookupProductMapping(product) {
    const row = mappings.get(product?.id);
    if (!row) return { status: 'unmapped', confirmed: false, supplierId: null, warnings: ['Für diesen Shop-Eintrag liegt noch kein geprüfter Listenabgleich vor.'] };
    const source = suppliers.get(row.supplierId);
    if (!sameText(product.inspiredBy, row.expectedInspiredBy) || product.category !== row.expectedCategory || !source || !sameText(source.name, row.expectedSupplierName)) {
        return { status: 'changed', confirmed: false, supplierId: null, previousSupplierId: row.supplierId, warnings: [`Duftname oder Kategorie wurde seit dem Abgleich geändert. Bisherige Referenz ${row.supplierId} bitte erneut prüfen.`] };
    }
    return { status: row.status, confirmed: row.status === 'matched', supplierId: row.supplierId, warnings: row.note ? [row.note] : [], supplierReference: reference(row.supplierId) };
}
function lookupIdMapping(value, products = []) {
    const parsed = parseId(value);
    if (!parsed) return null;
    const byId = new Map(products.map(product => [product.id, product]));
    const result = { query: parsed.id, direction: parsed.direction, version: crosswalk.version, internalId: null, supplierId: null, confirmed: false, status: 'not_found', product: null, candidates: [], warnings: [] };
    if (parsed.direction === 'internal-to-supplier') {
        const product = byId.get(parsed.id);
        if (product) {
            Object.assign(result, lookupProductMapping(product), { internalId: product.id, product: productSummary(product) });
        } else result.warnings.push(`Shop-ID ${parsed.id} ist im aktuellen Katalog nicht vorhanden.`);
    } else {
        const source = suppliers.get(parsed.id);
        result.supplierId = parsed.id;
        result.supplierReference = reference(parsed.id);
        if (!source) result.warnings.push(`Händler-ID ${parsed.id} ist in der Liste ${crosswalk.version} nicht vorhanden.`);
        else {
            const rows = crosswalk.entries.filter(row => row.supplierId === parsed.id);
            result.candidates = rows.filter(row => byId.has(row.productId)).map(row => {
                const product = byId.get(row.productId);
                return { ...productSummary(product), ...lookupProductMapping(product) };
            });
            if (result.candidates.length === 1) {
                const candidate = result.candidates[0];
                result.status = candidate.status;
                result.confirmed = candidate.confirmed;
                result.warnings = candidate.warnings;
                // Stale references are shown as candidates, never as a current conversion.
                if (candidate.status !== 'changed') { result.internalId = candidate.id; result.product = productSummary(byId.get(candidate.id)); }
            } else if (result.candidates.length > 1) {
                result.status = 'multiple';
                result.warnings.push('Mehrere Shop-Einträge verweisen auf diese Händlerzeile. Bitte den passenden Eintrag auswählen.');
            } else {
                const excluded = crosswalk.excluded.find(row => row.supplierId === parsed.id);
                const cross = crosswalk.crossReferences.find(row => row.supplierId === parsed.id);
                const related = cross && byId.get(cross.productId);
                const primary = related && lookupProductMapping(related);
                if (excluded) { result.status = 'excluded'; result.warnings.push(excluded.note); }
                else if (!source.name) result.status = 'empty';
                else if (cross && related && sameText(source.name, cross.expectedSupplierName) && primary.confirmed && primary.supplierId === cross.primarySupplierId) {
                    result.status = 'cross_category'; result.internalId = related.id; result.product = productSummary(related);
                    result.primarySupplierId = cross.primarySupplierId; result.warnings.push(cross.note);
                } else result.status = 'not_in_shop';
            }
        }
    }
    result.statusLabel = labels[result.status];
    result.supplierLine = result.supplierId;
    result.matchedBy = result.confirmed ? 'reviewed-name-crosswalk' : null;
    return result;
}
function buildSupplierCatalogue(products = []) {
    const men = [], women = [];
    for (const source of supplierCatalogue.entries) {
        const match = lookupIdMapping(source.id, products);
        const row = { supplierId: source.id, inspiredBy: source.name, page: source.page, internalId: match.internalId, status: match.status, statusLabel: match.statusLabel, confirmed: match.confirmed, warnings: match.warnings, candidates: match.candidates };
        (source.id.startsWith('M') ? men : women).push(row);
    }
    const sort = (a, b) => Number(a.supplierId.slice(1)) - Number(b.supplierId.slice(1));
    return { version: crosswalk.version, checkedAt: crosswalk.checkedAt, men: men.sort(sort), women: women.sort(sort) };
}
module.exports = { parseId, lookupProductMapping, lookupIdMapping, buildSupplierCatalogue };
