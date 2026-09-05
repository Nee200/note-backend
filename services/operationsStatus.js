const mongoose = require('mongoose');
const Order = require('../models/Order');
const WebhookEvent = require('../models/WebhookEvent');
const MailJob = require('../models/MailJob');
const CheckoutRequest = require('../models/CheckoutRequest');
const Invoice = require('../models/Invoice');
let lastStatus, lastPromise;
async function operationsStatus(env) {
    if (lastStatus && Date.now() - Date.parse(lastStatus.updatedAt) < 30000) return lastStatus;
    if (lastPromise) return lastPromise;
    lastPromise = readStatus(env).then(result => { lastStatus = result; return result; }).finally(() => { lastPromise = null; });
    return lastPromise;
}
async function readStatus(env) {
    const [webhooks, mails, notifications, emptyOrders, checkoutReview, financialReview, invoiceLinks] = await Promise.all([
        WebhookEvent.countDocuments({ status: { $in: ['pending', 'processing'] }, createdAt: { $lt: new Date(Date.now() - 300000) } }),
        MailJob.countDocuments({ $or: [{ status: 'manual_review' }, { status: 'pending', attempts: { $gte: 3 } }] }),
        Order.countDocuments({ 'pendingNotifications.0': { $exists: true }, date: { $lt: new Date(Date.now() - 300000) } }),
        Order.countDocuments({ paymentStatus: 'paid', 'items.0': { $exists: false } }),
        CheckoutRequest.countDocuments({ $or: [{ status: 'manual_review' }, { status: 'pending', createdAt: { $lt: new Date(Date.now() - 600000) } }] }),
        Order.countDocuments({ $and: [{ $or: [{ refundedAmountCents: { $gt: 0 } }, { disputeStatus: { $exists: true, $nin: ['', 'won'] } }] }, { $or: [{ financialResolutionReference: null }, { $expr: { $ne: ['$refundedAmountCents', '$financialReviewedAmountCents'] } }, { $expr: { $ne: [{ $ifNull: ['$disputeStatus', ''] }, '$financialReviewedDisputeStatus'] } }] }] }),
        Invoice.aggregate([{ $project: { order: 1 } }, { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', pipeline: [{ $project: { invoice: 1 } }], as: 'linkedOrder' } }, { $match: { $expr: { $ne: [{ $ifNull: [{ $arrayElemAt: ['$linkedOrder.invoice', 0] }, null] }, '$_id'] } } }, { $count: 'count' }])
    ]);
    const checks = [
        { id: 'db', label: 'Datenbankverbindung', ok: mongoose.connection.readyState === 1, detail: 'Aktueller Verbindungszustand des Prozesses.' },
        ...[['webhooks', 'Zahlungsereignisse mit Bearbeitungsrückstand', webhooks], ['mails', 'Mailaufträge mit wiederholtem Fehler', mails], ['notifications', 'Ausstehende Bestellbenachrichtigungen', notifications], ['empty-orders', 'Bezahlte Bestellungen ohne Positionen', emptyOrders], ['checkout-review', 'Checkout-Vorgänge mit Prüfbedarf', checkoutReview], ['financial-review', 'Erstattungen/Streitfälle ohne aktuellen Belegverweis', financialReview], ['invoice-links', 'Rechnungen ohne passenden Bestellverweis', invoiceLinks[0]?.count || 0]].map(([id, label, count]) => ({ id, label, ok: count === 0, count, detail: `${count} Vorgänge; aus der Datenbank ermittelt.` }))
    ];
    return { score: null, passed: checks.filter(check => check.ok).length, total: checks.length, environment: env.NODE_ENV, updatedAt: new Date().toISOString(), scope: 'Betriebszustand; keine Sicherheitszertifizierung. Dependency- und Browserprüfungen erfolgen in CI.', checks, monitor: { intervalMs: 30000, alerts: checks.filter(check => !check.ok).map(check => ({ severity: 'warning', message: check.label + ': ' + check.count })), history: [] }, dependencyMonitor: { running: false, isStale: true, latest: null, history: [], source: 'CI' } };
}
module.exports = { operationsStatus };
