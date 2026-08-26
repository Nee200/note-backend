const assert = require('node:assert/strict');
const test = require('node:test');
const {
    SELLER,
    splitIncludedVat,
    getInvoiceYear,
    resolveServiceDate,
    getDeliveryCountry,
    validateInvoiceData,
    generateInvoicePdf
} = require('../services/invoiceService');
const {
    formatOrderNumber
} = require('../services/orderNumberService');

function sampleInvoice(overrides = {}) {
    return {
        number: 'RE-2026-000001',
        issuedAt: new Date('2026-08-26T10:00:00.000Z'),
        serviceDate: new Date('2026-08-25T10:00:00.000Z'),
        paymentDate: new Date('2026-08-24T10:00:00.000Z'),
        currency: 'eur',
        orderReference: '#123',
        seller: SELLER,
        customer: {
            name: 'Max Mustermann',
            email: 'max@example.test',
            address: {
                line1: 'Musterstr. 12',
                line2: '',
                postalCode: '10115',
                city: 'Berlin',
                state: '',
                country: 'DE'
            },
            taxIds: []
        },
        items: [
            {
                position: 1,
                description: 'Extrait de Parfum Beispielduft (50 ml)',
                quantity: 1,
                unitGrossCents: 11900,
                totalGrossCents: 11900,
                vatRateBps: 1900
            }
        ],
        subtotalGrossCents: 11900,
        discountGrossCents: 0,
        shippingGrossCents: 0,
        totalNetCents: 10000,
        totalTaxCents: 1900,
        totalGrossCents: 11900,
        vatRateBps: 1900,
        taxExemptionNote: '',
        payment: { method: 'Karte' },
        ...overrides
    };
}

test('zerlegt einen Bruttopreis mit 19 Prozent korrekt', () => {
    assert.deepEqual(splitIncludedVat(11900, 1900), {
        netCents: 10000,
        taxCents: 1900,
        grossCents: 11900
    });
});

test('ermittelt das Rechnungsjahr in der deutschen Zeitzone', () => {
    assert.equal(getInvoiceYear(new Date('2025-12-31T23:30:00.000Z')), 2026);
});

test('formatiert eine kurze öffentliche Bestellnummer', () => {
    assert.equal(formatOrderNumber(1), '#1');
    assert.equal(formatOrderNumber(2), '#2');
    assert.equal(formatOrderNumber(123), '#123');
    assert.throws(() => formatOrderNumber(0), /Ungültige Bestellnummer-Sequenz/);
});

test('verwendet nur ein belastbares Versanddatum als Leistungsdatum', () => {
    const shippedAt = new Date('2026-08-25T12:00:00.000Z');
    assert.equal(resolveServiceDate({ shippedAt, status: 'archiv' }).date.getTime(), shippedAt.getTime());
    assert.equal(resolveServiceDate({ status: 'archiv', statusUpdatedAt: new Date() }).date, null);
    assert.equal(
        resolveServiceDate({ status: 'abgeschlossen', statusUpdatedAt: shippedAt }).date.getTime(),
        shippedAt.getTime()
    );
});

test('verwendet das Lieferland statt der abweichenden Rechnungsadresse', () => {
    const country = getDeliveryCountry({
        customer_details: { address: { country: 'DE' } },
        collected_information: {
            shipping_details: { address: { country: 'CH' } }
        }
    }, {
        address: { country: 'AT' }
    });

    assert.equal(country, 'CH');
});

test('verlangt bei null Prozent einen Steuerbefreiungshinweis', () => {
    assert.throws(
        () => validateInvoiceData(sampleInvoice({ vatRateBps: 0, totalTaxCents: 0, totalNetCents: 11900 })),
        /Steuerbefreiungshinweis/
    );
});

test('erzeugt eine lesbare PDF-Datei', async () => {
    const pdf = await generateInvoicePdf(sampleInvoice());
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 3000);
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
});
