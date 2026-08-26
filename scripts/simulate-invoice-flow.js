const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Deutlich als Testdokument kennzeichnen, bevor der Rechnungsservice seine Konfiguration lädt.
process.env.INVOICE_NUMBER_PREFIX = 'TEST';
process.env.INVOICE_SELLER_NAME = 'Note Fragrances - TESTDOKUMENT';

let storedInvoice = null;
let invoiceCreateCount = 0;
let invoiceSequence = 990000;

const fakeInvoiceModel = {
    async findOne(query) {
        return storedInvoice && String(storedInvoice.order) === String(query.order)
            ? storedInvoice
            : null;
    },
    async create(document) {
        invoiceCreateCount += 1;
        storedInvoice = {
            ...document,
            _id: 'simulated-invoice-id'
        };
        return storedInvoice;
    }
};

const fakeInvoiceCounter = {
    async findById(id) {
        return { _id: id, sequence: invoiceSequence };
    },
    async create(document) {
        invoiceSequence = Number(document.sequence || 0);
        return { ...document };
    },
    async findByIdAndUpdate(id, update) {
        invoiceSequence += Number(update && update.$inc && update.$inc.sequence || 0);
        return { _id: id, sequence: invoiceSequence };
    }
};

function installModuleDouble(modulePath, exports) {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
        children: [],
        paths: module.paths
    };
}

installModuleDouble(require.resolve('../models/Invoice'), fakeInvoiceModel);
installModuleDouble(require.resolve('../models/InvoiceCounter'), fakeInvoiceCounter);

const { ensureInvoiceForOrder } = require('../services/invoiceService');

function createSimulatedStripeClient() {
    let retrieveCount = 0;
    const paidAtSeconds = Math.floor(new Date('2026-08-26T08:30:00.000Z').getTime() / 1000);
    const address = {
        line1: 'Musterstr. 1',
        postal_code: '10115',
        city: 'Berlin',
        country: 'DE'
    };

    return {
        getRetrieveCount: () => retrieveCount,
        checkout: {
            sessions: {
                async retrieve(sessionId) {
                    retrieveCount += 1;
                    assert.equal(sessionId, 'cs_test_invoice_simulation');
                    return {
                        id: sessionId,
                        payment_status: 'paid',
                        currency: 'eur',
                        amount_subtotal: 4499,
                        amount_total: 5198,
                        total_details: { amount_discount: 0 },
                        shipping_cost: { amount_total: 699 },
                        customer_details: {
                            name: 'Testbestellung - nicht buchen',
                            email: 'rechnungstest@example.test',
                            address
                        },
                        collected_information: {
                            shipping_details: {
                                name: 'Testbestellung - nicht buchen',
                                address
                            }
                        },
                        payment_intent: {
                            id: 'pi_test_invoice_simulation',
                            created: paidAtSeconds,
                            payment_method_types: ['card'],
                            latest_charge: {
                                created: paidAtSeconds,
                                payment_method_details: { type: 'card' }
                            }
                        },
                        created: paidAtSeconds
                    };
                },
                async listLineItems(sessionId) {
                    assert.equal(sessionId, 'cs_test_invoice_simulation');
                    return {
                        data: [{
                            description: 'Testparfum (50 ml) - nicht buchen',
                            quantity: 1,
                            amount_subtotal: 4499,
                            price: { unit_amount: 4499 }
                        }]
                    };
                }
            }
        }
    };
}

async function main() {
    const stripeClient = createSimulatedStripeClient();
    let orderSaveCount = 0;
    const serviceDate = new Date('2026-08-26T10:00:00.000Z');
    const order = {
        _id: 'simulated-order-id',
        orderNumber: '#TEST-1',
        stripeSessionId: 'cs_test_invoice_simulation',
        status: 'in_bearbeitung',
        statusUpdatedAt: new Date('2026-08-26T09:00:00.000Z'),
        shippedAt: null,
        amount: 5198,
        currency: 'eur',
        discountAmount: 0,
        shippingAmount: 699,
        address: {
            line1: 'Musterstr. 1',
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE'
        },
        async save() {
            orderSaveCount += 1;
            return this;
        }
    };

    // Entspricht dem Admin-Klick auf „Abschließen & E-Mail senden“.
    order.status = 'abgeschlossen';
    order.statusUpdatedAt = serviceDate;
    order.shippedAt = serviceDate;

    const generated = await ensureInvoiceForOrder({
        order,
        stripeClient,
        generatedBy: 'isolated_simulation'
    });

    assert.equal(generated.status, 'generated');
    assert.ok(generated.invoice);
    assert.match(generated.invoice.number, /^TEST-\d{4}-990001$/);
    assert.equal(generated.invoice.orderReference, '#TEST-1');
    assert.equal(generated.invoice.totalGrossCents, 5198);
    assert.equal(generated.invoice.totalTaxCents, 830);
    assert.equal(generated.invoice.source.serviceDateSource, 'shipped_at');
    assert.ok(Buffer.isBuffer(generated.invoice.pdfData));
    assert.ok(generated.invoice.pdfData.length > 3000);
    assert.equal(generated.invoice.pdfData.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(order.invoiceStatus, 'generated');
    assert.equal(order.invoiceNumber, generated.invoice.number);
    assert.equal(order.taxAmount, 830);
    assert.equal(orderSaveCount, 1);
    assert.equal(invoiceCreateCount, 1);

    const repeated = await ensureInvoiceForOrder({ order, stripeClient });
    assert.equal(repeated.status, 'existing');
    assert.equal(invoiceCreateCount, 1);
    assert.equal(stripeClient.getRetrieveCount(), 1);

    const outputDirectory = path.join(__dirname, '..', '..', 'output', 'pdf');
    const outputPath = path.join(outputDirectory, 'Rechnung_Simulation.pdf');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(outputPath, generated.invoice.pdfData);

    console.log(JSON.stringify({
        status: generated.status,
        repeatedStatus: repeated.status,
        statusTransition: 'in_bearbeitung -> abgeschlossen',
        invoiceNumber: generated.invoice.number,
        orderNumber: generated.invoice.orderReference,
        grossCents: generated.invoice.totalGrossCents,
        taxCents: generated.invoice.totalTaxCents,
        pdfBytes: generated.invoice.pdfData.length,
        invoiceCreateCount,
        stripeRetrieveCount: stripeClient.getRetrieveCount(),
        databaseWrites: 0,
        outputPath
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
