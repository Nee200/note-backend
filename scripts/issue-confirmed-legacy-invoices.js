const maintenance = require('./maintenance').prepare({ task: 'issue-confirmed-legacy-invoices.js', localOnly: false });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Invoice = require('../models/Invoice');
const OrderCounter = require('../models/OrderCounter');
const { ensureInvoiceForOrder } = require('../services/invoiceService');

const EXECUTE = process.argv.includes('--execute');
const TARGETS = [
    { orderDate: '2026-06-14', paymentDate: '2026-06-14', serviceDate: '2026-06-15', amountCents: 2698 },
    { orderDate: '2026-07-11', paymentDate: '2026-07-11', serviceDate: '2026-07-12', amountCents: 2598 },
    { orderDate: '2026-08-14', paymentDate: '2026-08-14', serviceDate: '2026-08-15', amountCents: 5198 }
];

function formatBerlinDate(value) {
    return new Intl.DateTimeFormat('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Europe/Berlin'
    }).format(new Date(value));
}

function berlinNoon(dateText) {
    return new Date(`${dateText}T12:00:00+02:00`);
}

function storedLineAmountToCents(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ungültiger gespeicherter Artikelbetrag.');
    return Math.round(amount * 100);
}

function createVerifiedStripeSnapshotClient(order, target) {
    const items = Array.isArray(order.items) ? order.items : [];
    const subtotalCents = items.reduce((sum, item) => sum + storedLineAmountToCents(item.amount_total), 0);
    const discountCents = Math.round(Number(order.discountAmount || 0));
    const totalCents = Math.round(Number(order.amount || 0));
    const shippingCents = totalCents - subtotalCents + discountCents;
    if (shippingCents < 0 || subtotalCents - discountCents + shippingCents !== totalCents) {
        throw new Error('Gespeicherte Bestellsumme kann nicht eindeutig rekonstruiert werden.');
    }

    const paymentTimestamp = Math.floor(new Date(order.date).getTime() / 1000);
    const session = {
        id: order.stripeSessionId,
        payment_status: 'paid',
        amount_subtotal: subtotalCents,
        amount_total: totalCents,
        currency: order.currency || 'eur',
        created: paymentTimestamp,
        payment_method_types: ['card'],
        total_details: { amount_discount: discountCents },
        shipping_cost: { amount_total: shippingCents },
        customer_details: {
            name: order.name || (order.address && order.address.name) || '',
            email: order.email || '',
            address: order.address || {}
        },
        collected_information: {
            shipping_details: {
                name: order.name || (order.address && order.address.name) || '',
                address: order.address || {}
            }
        }
    };
    const lineItems = items.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        amount_subtotal: storedLineAmountToCents(item.amount_total)
    }));

    if (formatBerlinDate(order.date) !== target.paymentDate) {
        throw new Error('Gespeichertes Bestelldatum stimmt nicht mit dem bestätigten Zahlungsdatum überein.');
    }

    return {
        checkout: {
            sessions: {
                retrieve: async () => session,
                listLineItems: async () => ({ data: lineItems })
            }
        }
    };
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 12000 });
    const orders = await Order.find({
        stripeSessionId: { $exists: true, $nin: ['', null] }
    }).sort({ date: 1 });

    if (orders.length !== TARGETS.length) {
        throw new Error(`Sicherheitsabbruch: ${orders.length} statt ${TARGETS.length} historischer Bestellungen gefunden.`);
    }
    const existingInvoices = await Invoice.countDocuments({});
    if (existingInvoices !== 0) {
        throw new Error(`Sicherheitsabbruch: Es existieren bereits ${existingInvoices} Rechnungen.`);
    }
    const existingOrderNumbers = await Order.countDocuments({ orderNumber: { $exists: true, $nin: ['', null] } });
    const orderCounter = await OrderCounter.findById('order:global').lean();
    if (existingOrderNumbers !== 0 || (orderCounter && Number(orderCounter.sequence) > 0)) {
        throw new Error('Sicherheitsabbruch: Der Bestellnummernkreis wurde bereits begonnen.');
    }

    const plan = orders.map((order, index) => {
        const target = TARGETS[index];
        if (formatBerlinDate(order.date) !== target.orderDate || Number(order.amount) !== target.amountCents) {
            throw new Error(`Sicherheitsabbruch: Bestellung ${index + 1} passt nicht zu Datum und Betrag.`);
        }
        if (String(order.address && order.address.country || '').toUpperCase() !== 'DE') {
            throw new Error(`Sicherheitsabbruch: Bestellung ${index + 1} hat nicht das Lieferland DE.`);
        }
        if (order.invoice || order.invoiceNumber) {
            throw new Error(`Sicherheitsabbruch: Bestellung ${index + 1} besitzt bereits eine Rechnung.`);
        }
        const client = createVerifiedStripeSnapshotClient(order, target);
        return { order, target, client };
    });

    console.log(JSON.stringify({
        mode: EXECUTE ? 'execute' : 'dry-run',
        invoices: plan.map(({ target }) => ({
            paymentDate: target.paymentDate,
            serviceDate: target.serviceDate,
            amountCents: target.amountCents
        }))
    }, null, 2));

    if (!EXECUTE) {
        console.log('Keine Daten verändert. Mit --execute werden die drei bestätigten Rechnungen ausgestellt.');
        return;
    }

    const outputDirectory = path.resolve(__dirname, '..', '..', 'output', 'pdf');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const issued = [];
    for (const { order, target, client } of plan) {
        order.shippedAt = berlinNoon(target.serviceDate);
        const result = await ensureInvoiceForOrder({
            order,
            stripeClient: client,
            serviceDate: order.shippedAt,
            serviceDateSource: 'owner_confirmed_next_day',
            generatedBy: 'manual_confirmed_legacy_payment'
        });
        if (!result.invoice || result.status !== 'generated') {
            throw new Error(`Rechnung für ${target.orderDate} wurde nicht neu erzeugt (${result.status}).`);
        }
        const pdfPath = path.join(outputDirectory, `${result.invoice.pdfFileName}`);
        fs.writeFileSync(pdfPath, Buffer.from(result.invoice.pdfData));
        issued.push({
            orderNumber: order.orderNumber,
            invoiceNumber: result.invoice.number,
            paymentDate: target.paymentDate,
            serviceDate: target.serviceDate,
            amountCents: target.amountCents,
            pdfPath
        });
    }
    console.log(JSON.stringify({ issued }, null, 2));
}

main()
    .then(() => mongoose.disconnect())
    .catch(async error => {
        console.error(error.message);
        try { await mongoose.disconnect(); } catch (_) { }
        process.exit(1);
    });
