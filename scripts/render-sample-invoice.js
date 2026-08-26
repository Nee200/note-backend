const fs = require('fs');
const path = require('path');
const {
    SELLER,
    splitIncludedVat,
    generateInvoicePdf
} = require('../services/invoiceService');

async function main() {
    const subtotalGrossCents = 11497;
    const discountGrossCents = 575;
    const shippingGrossCents = 0;
    const totalGrossCents = subtotalGrossCents - discountGrossCents + shippingGrossCents;
    const vat = splitIncludedVat(totalGrossCents, 1900);
    const invoice = {
        number: 'RE-2026-000001',
        issuedAt: new Date('2026-08-26T10:00:00.000Z'),
        serviceDate: new Date('2026-08-25T10:00:00.000Z'),
        paymentDate: new Date('2026-08-24T10:00:00.000Z'),
        currency: 'eur',
        orderReference: '#123',
        seller: SELLER,
        customer: {
            name: 'Max Mustermann',
            email: 'max.mustermann@example.de',
            address: {
                line1: 'Musterstraße 12',
                line2: '2. Obergeschoss',
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
                description: 'NØTE. Extrait de Parfum - Beispielduft (30 ml)',
                quantity: 2,
                unitGrossCents: 3499,
                totalGrossCents: 6998,
                vatRateBps: 1900
            },
            {
                position: 2,
                description: 'NØTE. Extrait de Parfum - Zweiter Beispielduft (50 ml)',
                quantity: 1,
                unitGrossCents: 4499,
                totalGrossCents: 4499,
                vatRateBps: 1900
            }
        ],
        subtotalGrossCents,
        discountGrossCents,
        shippingGrossCents,
        totalNetCents: vat.netCents,
        totalTaxCents: vat.taxCents,
        totalGrossCents,
        vatRateBps: 1900,
        taxExemptionNote: '',
        payment: { method: 'Karte' }
    };
    const pdf = await generateInvoicePdf(invoice);
    const outputDirectory = path.resolve(__dirname, '..', '..', 'output', 'pdf');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, 'rechnung-muster.pdf');
    fs.writeFileSync(outputPath, pdf);
    console.log(outputPath);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
