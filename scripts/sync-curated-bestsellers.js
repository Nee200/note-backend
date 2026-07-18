require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const mongoose = require('mongoose');
const Product = require('../models/Product');

// Atlas SRV/TXT lookups are occasionally rejected by the Windows resolver in
// local tooling although the records are healthy. Public resolvers keep this
// one-off maintenance script deterministic without changing the app runtime.
if (String(process.env.MONGO_URI || '').startsWith('mongodb+srv://')) {
    dns.setServers(['1.1.1.1', '8.8.8.8']);
}

const CURATED_BESTSELLER_IDS = Object.freeze([
    'L12', 'L56', 'L62', 'L73', 'L123', 'L145', 'L146', 'L147', 'L155', 'L190',
    'G111', 'G160', 'G169', 'G223', 'G232', 'G245', 'G263', 'G282', 'G298', 'G307', 'G322'
]);

async function run() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI fehlt.');

    const catalogPath = path.join(__dirname, '..', 'products.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const curatedSet = new Set(CURATED_BESTSELLER_IDS);
    const catalogIds = new Set(catalog.map((product) => product.id));
    const missingFromCatalog = CURATED_BESTSELLER_IDS.filter((id) => !catalogIds.has(id));

    if (missingFromCatalog.length) {
        throw new Error(`Produkte fehlen in products.json: ${missingFromCatalog.join(', ')}`);
    }

    catalog.forEach((product) => {
        product.bestseller = curatedSet.has(product.id);
    });
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

    await mongoose.connect(process.env.MONGO_URI);

    const existingIds = await Product.distinct('id', { id: { $in: CURATED_BESTSELLER_IDS } });
    const missingFromDatabase = CURATED_BESTSELLER_IDS.filter((id) => !existingIds.includes(id));
    if (missingFromDatabase.length) {
        throw new Error(`Produkte fehlen in der Datenbank: ${missingFromDatabase.join(', ')}`);
    }

    const clearResult = await Product.updateMany(
        { bestseller: true, id: { $nin: CURATED_BESTSELLER_IDS } },
        { $set: { bestseller: false } }
    );
    const setResult = await Product.updateMany(
        { id: { $in: CURATED_BESTSELLER_IDS } },
        { $set: { bestseller: true } }
    );

    const databaseBestsellerIds = await Product.find({ bestseller: true }, { _id: 0, id: 1 })
        .sort({ id: 1 })
        .lean();
    const verifiedIds = databaseBestsellerIds.map((product) => product.id);
    const unexpected = verifiedIds.filter((id) => !curatedSet.has(id));
    const stillMissing = CURATED_BESTSELLER_IDS.filter((id) => !verifiedIds.includes(id));

    if (unexpected.length || stillMissing.length) {
        throw new Error(`Verifikation fehlgeschlagen. Unerwartet: ${unexpected.join(', ') || '-'}; fehlend: ${stillMissing.join(', ') || '-'}`);
    }

    console.log(`Alte Bestseller entfernt: ${clearResult.modifiedCount}`);
    console.log(`Kuratierte Bestseller gesetzt/geprueft: ${setResult.matchedCount}`);
    console.log(`Verifiziert: ${verifiedIds.length} Bestseller`);
    console.log(verifiedIds.join(','));
}

run()
    .catch((error) => {
        console.error('Bestseller-Synchronisierung fehlgeschlagen:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
