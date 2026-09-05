const fs = require('node:fs');
const mongoose = require('mongoose');
const maintenance = require('./maintenance').prepare({ task: 'read-only-data-audit' });
async function main() {
    if (maintenance.apply) throw new Error('Dieses Diagnosewerkzeug schreibt keine Geschäftsdaten.');
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI oder eine ausdrückliche --env-Datei ist erforderlich.');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, autoCreate: false, autoIndex: false });
    const Order = require('../models/Order'), Invoice = require('../models/Invoice');
    const report = {
        generatedAt: new Date().toISOString(), database: mongoose.connection.name,
        counts: {
            orders: await Order.countDocuments(), invoices: await Invoice.countDocuments(),
            unownedOrders: await Order.countDocuments({ userId: null }),
            legacyOrders: await Order.countDocuments({ schemaVersion: { $ne: 2 } }),
            paidWithoutItems: await Order.countDocuments({ paymentStatus: 'paid', 'items.0': { $exists: false } }),
            invoicesWithoutOrderLink: await Invoice.aggregate([{ $project: { order: 1 } }, { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', pipeline: [{ $project: { invoice: 1 } }], as: 'target' } }, { $match: { $expr: { $ne: [{ $ifNull: [{ $arrayElemAt: ['$target.invoice', 0] }, null] }, '$_id'] } } }, { $count: 'count' }]).then(rows => rows[0]?.count || 0)
        },
        note: 'Nur Bestandszahlen, keine Kundendaten. Kein Abgleich mit Stripe. Historische Zahlungen und Belege vor einem Reparaturlauf gesondert prüfen.'
    };
    const output = maintenance.argument('out');
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    else console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
