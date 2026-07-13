/**
 * Erzeugt zwei funktionsfähige 5%-Rabattcodes direkt in der Subscriber-Collection.
 *
 * Ein Code ist im Shop gültig, wenn (siehe findValidCoupon in server.js):
 *   - code: gesetzt, eindeutig, nach .trim().toUpperCase()
 *   - used: false
 *   - status: 'active' ODER status nicht vorhanden
 *   - discount: 5  (Prozent)
 *
 * Außerdem MUSS das Feld "email" unique & required sein (Subscriber-Schema).
 * Wir verwenden Platzhalter-E-Mails, die eindeutig sind, damit keine Kollision
 * mit echten Newsletter-Anmeldungen entsteht.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Subscriber = require('../models/Subscriber');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI fehlt in der .env');
    process.exit(1);
}

// Zwei feste, eindeutige Codes im Newsletter-Format (NOTE-XXXXX)
const COUPONS = [
    {
        code: 'NOTE-5PER1',
        email: 'coupon-5pct-1@local.internal',
        discount: 5,
    },
    {
        code: 'NOTE-5PER2',
        email: 'coupon-5pct-2@local.internal',
        discount: 5,
    },
];

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Verbunden mit MongoDB.');

        for (const c of COUPONS) {
            const normalizedCode = c.code.trim().toUpperCase();

            // Bereits vorhanden? Dann nur aktualisieren/auffrischen.
            const existing = await Subscriber.findOne({ code: normalizedCode });
            if (existing) {
                existing.status = 'active';
                existing.used = false;
                existing.discount = c.discount;
                existing.freeShipping = false;
                existing.confirmedAt = existing.confirmedAt || new Date();
                await existing.save();
                console.log(`Aktualisiert (war bereits vorhanden): ${normalizedCode} -> ${c.discount}%`);
                continue;
            }

            await Subscriber.create({
                email: c.email,
                status: 'active',
                code: normalizedCode,
                discount: c.discount,
                freeShipping: false,
                used: false,
                subscribedAt: new Date(),
                confirmedAt: new Date(),
            });
            console.log(`Erstellt: ${normalizedCode} -> ${c.discount}%`);
        }

        // Zur Kontrolle: nochmal aus der DB lesen
        console.log('\n--- aktuelle Coupon-Einträge ---');
        for (const c of COUPONS) {
            const doc = await Subscriber.findOne({ code: c.code.trim().toUpperCase() }).lean();
            if (doc) {
                console.log(
                    `${doc.code} | discount=${doc.discount}% | used=${doc.used} | status=${doc.status} | freeShipping=${doc.freeShipping}`
                );
            } else {
                console.log(`${c.code}: NICHT gefunden (unerwartet)`);
            }
        }

        await mongoose.disconnect();
        console.log('\nFertig. Verbindung geschlossen.');
    } catch (err) {
        console.error('Fehler:', err);
        try { await mongoose.disconnect(); } catch (_) {}
        process.exit(1);
    }
})();
