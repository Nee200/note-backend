const supplierCatalogue = require('./catalog/supplier-2026-10.json');


function normalizeComparableText(value) {
    const commonFixes = [
        [/[\u2018\u2019\u00b4`']/g, ''],
        [/&/g, ' and '],
        [/\bparfume\b/g, 'parfum'],
        [/\brabbane\b/g, 'rabanne'],
        [/\barmani\b/g, 'armani'],
        [/\baramni\b/g, 'armani'],
        [/\bgiorgo\b/g, 'giorgio'],
        [/\bgaulter\b/g, 'gaultier'],
        [/\bmadmoiselle\b/g, 'mademoiselle'],
        [/\bcost azzurra\b/g, 'costa azzurra'],
        [/\bvanill\b/g, 'vanilla'],
        [/\bcoeuer\b/g, 'coeur'],
        [/\bvouitton\b/g, 'vuitton'],
        [/\bsymohony\b/g, 'symphony'],
        [/\belexier\b/g, 'elixir'],
        [/\bfuluidity\b/g, 'fluidity'],
        [/\bchoclate\b/g, 'chocolate'],
        [/\bmyyrh\b/g, 'myrrh'],
        [/\bmyslf\b/g, 'myself'],
        [/\bgoddes\b/g, 'goddess'],
        [/\besseeence\b/g, 'essence'],
        [/\bintensly\b/g, 'intensely']
    ];

    let normalized = String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    commonFixes.forEach(([pattern, replacement]) => {
        normalized = normalized.replace(pattern, replacement);
    });

    normalized = normalized
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    normalized = normalized.replace(/^essentials bois imperial$/, 'essential parfums bois imperial');
    return normalized;
}

function toBigramSet(value) {
    const compact = String(value || '').replace(/\s+/g, '');
    if (!compact) return new Set();
    if (compact.length === 1) return new Set([compact]);
    const set = new Set();
    for (let i = 0; i < compact.length - 1; i += 1) {
        set.add(compact.slice(i, i + 2));
    }
    return set;
}

function diceCoefficient(a, b) {
    const setA = toBigramSet(a);
    const setB = toBigramSet(b);
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    setA.forEach((item) => {
        if (setB.has(item)) intersection += 1;
    });
    return (2 * intersection) / (setA.size + setB.size);
}

function tokenJaccard(a, b) {
    const setA = new Set(String(a || '').split(' ').filter(Boolean));
    const setB = new Set(String(b || '').split(' ').filter(Boolean));
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    setA.forEach((item) => {
        if (setB.has(item)) intersection += 1;
    });
    const union = setA.size + setB.size - intersection;
    return union > 0 ? (intersection / union) : 0;
}

function similarityScore(a, b) {
    const normA = normalizeComparableText(a);
    const normB = normalizeComparableText(b);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    const dice = diceCoefficient(normA, normB);
    const jaccard = tokenJaccard(normA, normB);
    let score = (dice * 0.65) + (jaccard * 0.35);

    if (normA.includes(normB) || normB.includes(normA)) {
        score += 0.08;
    }

    return Math.min(1, score);
}

const supplierEntries = supplierCatalogue.entries.map(row => ({
    supplierId: row.id, prefix: row.id[0], number: Number(row.id.slice(1)),
    inspiredBy: row.name, normalizedInspiredBy: normalizeComparableText(row.name)
}));
const supplierById = new Map(supplierEntries.map(item => [item.supplierId, item]));

function findSupplierEntryById(id) {
    const key = String(id || '').trim().toUpperCase();
    return supplierById.get(key) || null;
}

function findBestSupplierMatchByInspiredBy(inspiredBy, expectedPrefix) {
    const normalizedQuery = normalizeComparableText(inspiredBy);
    if (!normalizedQuery) return null;

    const candidates = supplierEntries.filter((entry) => {
        if (!entry.inspiredBy) return false;
        if (!expectedPrefix) return true;
        return entry.prefix === expectedPrefix;
    });

    if (!candidates.length) return null;

    const exact = candidates.find(entry => entry.normalizedInspiredBy === normalizedQuery);
    if (exact) {
        return {
            supplierId: exact.supplierId,
            inspiredBy: exact.inspiredBy,
            confidence: 1,
            matchedBy: 'exact'
        };
    }

    const ranked = candidates
        .map(entry => ({
            entry,
            score: similarityScore(normalizedQuery, entry.normalizedInspiredBy)
        }))
        .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.74) {
        return null;
    }

    const alternatives = ranked
        .slice(1, 4)
        .filter(item => item.score >= 0.64)
        .map(item => ({
            supplierId: item.entry.supplierId,
            inspiredBy: item.entry.inspiredBy,
            confidence: Number(item.score.toFixed(3))
        }));

    return {
        supplierId: best.entry.supplierId,
        inspiredBy: best.entry.inspiredBy,
        confidence: Number(best.score.toFixed(3)),
        matchedBy: 'fuzzy',
        alternatives
    };
}

module.exports = {
    supplierEntries,
    findSupplierEntryById,
    findBestSupplierMatchByInspiredBy,
    normalizeComparableText
};
