const crypto = require('crypto');
const path = require('path');
const PDFDocument = require('pdfkit');
const Invoice = require('../models/Invoice');
const InvoiceCounter = require('../models/InvoiceCounter');
const { ensureOrderNumber } = require('./orderNumberService');

const AUTOMATIC_COUNTRIES = new Set(
    String(process.env.INVOICE_AUTOMATIC_COUNTRIES || 'DE')
        .split(',')
        .map(value => value.trim().toUpperCase())
        .filter(Boolean)
);

const DEFAULT_VAT_RATE_BPS = Math.round(Number(process.env.INVOICE_VAT_RATE || 19) * 100);
const INVOICE_PREFIX = String(process.env.INVOICE_NUMBER_PREFIX || 'RE').trim().toUpperCase() || 'RE';
const INVOICE_SEQUENCE_START = Math.max(1, Number.parseInt(process.env.INVOICE_SEQUENCE_START || '1', 10) || 1);
const INTER_FONT_DIRECTORY = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');
const INTER_REGULAR_FONT = path.join(INTER_FONT_DIRECTORY, 'inter-latin-400-normal.woff');
const INTER_BOLD_FONT = path.join(INTER_FONT_DIRECTORY, 'inter-latin-700-normal.woff');
const CORMORANT_FONT_DIRECTORY = path.join(path.dirname(require.resolve('@fontsource/cormorant-garamond/package.json')), 'files');
const CORMORANT_MEDIUM_FONT = path.join(CORMORANT_FONT_DIRECTORY, 'cormorant-garamond-latin-500-normal.woff');

const SELLER = Object.freeze({
    businessName: String(process.env.INVOICE_SELLER_NAME || 'Note Fragrances').trim(),
    ownerName: String(process.env.INVOICE_SELLER_OWNER || 'Deniz Löbel').trim(),
    address: {
        line1: String(process.env.INVOICE_SELLER_STREET || 'Warnitzer Str. 20').trim(),
        line2: '',
        postalCode: String(process.env.INVOICE_SELLER_POSTAL_CODE || '13057').trim(),
        city: String(process.env.INVOICE_SELLER_CITY || 'Berlin').trim(),
        state: '',
        country: String(process.env.INVOICE_SELLER_COUNTRY || 'DE').trim().toUpperCase()
    },
    email: String(process.env.INVOICE_SELLER_EMAIL || 'info@note-fragrances.de').trim(),
    vatId: String(process.env.INVOICE_SELLER_VAT_ID || 'DE315774154').trim().toUpperCase()
});

function cleanText(value, maxLength = 500) {
    return String(value || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeAddress(address) {
    const source = address && typeof address === 'object' ? address : {};
    return {
        line1: cleanText(source.line1 || source.street, 200),
        line2: cleanText(source.line2, 200),
        postalCode: cleanText(source.postal_code || source.postalCode || source.zip, 30),
        city: cleanText(source.city, 120),
        state: cleanText(source.state, 120),
        country: cleanText(source.country, 10).toUpperCase()
    };
}

function isCompleteAddress(address) {
    const normalized = normalizeAddress(address);
    return Boolean(normalized.line1 && normalized.postalCode && normalized.city && normalized.country);
}

function asDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function fromUnixSeconds(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function formatDate(value) {
    const date = asDate(value);
    if (!date) return '-';
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Berlin'
    }).format(date);
}

function getInvoiceYear(value) {
    const date = asDate(value);
    if (!date) throw new Error('Ungültiges Rechnungsdatum.');
    const yearPart = new Intl.DateTimeFormat('de-DE', {
        year: 'numeric',
        timeZone: 'Europe/Berlin'
    }).format(date);
    const year = Number.parseInt(yearPart, 10);
    if (!Number.isInteger(year)) throw new Error('Rechnungsjahr konnte nicht bestimmt werden.');
    return year;
}

function formatMoney(cents, currency = 'eur') {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: String(currency || 'eur').toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(cents || 0) / 100);
}

function splitIncludedVat(grossCents, vatRateBps) {
    const gross = Math.round(Number(grossCents || 0));
    const rate = Math.round(Number(vatRateBps || 0));
    if (!rate) return { netCents: gross, taxCents: 0, grossCents: gross };
    const netCents = Math.round((gross * 10000) / (10000 + rate));
    return { netCents, taxCents: gross - netCents, grossCents: gross };
}

function getCheckoutShippingDetails(session) {
    return (session && session.collected_information && session.collected_information.shipping_details)
        || (session && session.shipping_details)
        || null;
}

function getDeliveryCountry(session, order) {
    const shippingDetails = getCheckoutShippingDetails(session);
    const shippingAddress = normalizeAddress(shippingDetails && shippingDetails.address);
    const orderAddress = normalizeAddress(order && order.address);
    const billingAddress = normalizeAddress(session && session.customer_details && session.customer_details.address);
    return cleanText(
        shippingAddress.country || orderAddress.country || billingAddress.country,
        10
    ).toUpperCase();
}

function getInvoiceCustomer(session, order) {
    const customerDetails = session && session.customer_details ? session.customer_details : {};
    const shippingDetails = getCheckoutShippingDetails(session);
    const billingAddress = normalizeAddress(customerDetails.address);
    const shippingAddress = normalizeAddress(shippingDetails && shippingDetails.address);
    const orderAddress = normalizeAddress(order && order.address);
    const address = isCompleteAddress(billingAddress)
        ? billingAddress
        : (isCompleteAddress(shippingAddress) ? shippingAddress : orderAddress);
    const name = cleanText(
        customerDetails.business_name
        || customerDetails.name
        || (shippingDetails && shippingDetails.name)
        || (order && order.name),
        160
    );
    const email = cleanText(customerDetails.email || (session && session.customer_email) || (order && order.email), 254);
    const taxIds = Array.isArray(customerDetails.tax_ids)
        ? customerDetails.tax_ids.map(taxId => ({
            type: cleanText(taxId && taxId.type, 40),
            value: cleanText(taxId && taxId.value, 80)
        })).filter(taxId => taxId.value)
        : [];
    return { name, email, address, taxIds };
}

function getPaymentDetails(session) {
    const paymentIntent = session && session.payment_intent && typeof session.payment_intent === 'object'
        ? session.payment_intent
        : null;
    const latestCharge = paymentIntent && paymentIntent.latest_charge && typeof paymentIntent.latest_charge === 'object'
        ? paymentIntent.latest_charge
        : null;
    const rawPaymentMethod = cleanText(
        (latestCharge && latestCharge.payment_method_details && latestCharge.payment_method_details.type)
        || (paymentIntent && Array.isArray(paymentIntent.payment_method_types) && paymentIntent.payment_method_types[0])
        || (session && Array.isArray(session.payment_method_types) && session.payment_method_types[0])
        || 'online',
        80
    );
    const paymentMethodLabels = {
        card: 'Karte',
        paypal: 'PayPal',
        klarna: 'Klarna',
        sepa_debit: 'SEPA-Lastschrift',
        link: 'Link',
        sofort: 'Sofort',
        online: 'Online-Zahlung'
    };
    return {
        paymentIntentId: cleanText(
            (paymentIntent && paymentIntent.id)
            || (session && typeof session.payment_intent === 'string' ? session.payment_intent : ''),
            120
        ),
        paidAt: fromUnixSeconds(latestCharge && latestCharge.created)
            || fromUnixSeconds(paymentIntent && paymentIntent.created)
            || fromUnixSeconds(session && session.created),
        method: paymentMethodLabels[rawPaymentMethod] || rawPaymentMethod || 'Online-Zahlung'
    };
}

function resolveServiceDate(order) {
    const shippedAt = asDate(order && order.shippedAt);
    if (shippedAt) return { date: shippedAt, source: 'shipped_at' };

    if (order && order.status === 'abgeschlossen') {
        const statusDate = asDate(order.statusUpdatedAt);
        if (statusDate) return { date: statusDate, source: 'completed_status' };
    }

    return { date: null, source: '' };
}

async function retrieveCheckoutSnapshot(stripeClient, order) {
    if (!stripeClient || !stripeClient.checkout || !stripeClient.checkout.sessions) {
        throw new Error('Stripe-Client ist nicht verfuegbar.');
    }
    if (!order || !order.stripeSessionId) {
        throw new Error('Bestellung hat keine Stripe-Session-ID.');
    }

    const session = await stripeClient.checkout.sessions.retrieve(order.stripeSessionId, {
        expand: ['payment_intent', 'payment_intent.latest_charge']
    });
    const lineItems = await require('./stripeData').listAllLineItems(stripeClient, order.stripeSessionId);
    require('./stripeData').assertCheckoutTotals(session, lineItems);
    const payment = getPaymentDetails(session);
    const customer = getInvoiceCustomer(session, order);
    const deliveryCountry = getDeliveryCountry(session, order);
    const currency = cleanText(session.currency || (order && order.currency) || 'eur', 10).toLowerCase();
    const items = lineItems.map((item, index) => {
        const quantity = Math.max(1, Math.round(Number(item.quantity || 1)));
        const totalGrossCents = Math.round(Number(
            item.amount_subtotal != null
                ? item.amount_subtotal
                : ((item.price && item.price.unit_amount) || 0) * quantity
        ));
        return {
            position: index + 1,
            description: cleanText(item.description || `Artikel ${index + 1}`, 300),
            quantity,
            unitGrossCents: Math.round(totalGrossCents / quantity),
            totalGrossCents,
            vatRateBps: DEFAULT_VAT_RATE_BPS
        };
    });

    const subtotalGrossCents = Math.round(Number(
        session.amount_subtotal != null
            ? session.amount_subtotal
            : items.reduce((sum, item) => sum + item.totalGrossCents, 0)
    ));
    const discountGrossCents = Math.round(Number(
        session.total_details && session.total_details.amount_discount != null
            ? session.total_details.amount_discount
            : (order && order.discountAmount) || 0
    ));
    const shippingGrossCents = Math.round(Number(
        session.shipping_cost && session.shipping_cost.amount_total != null
            ? session.shipping_cost.amount_total
            : (order && order.shippingAmount) || 0
    ));
    const totalGrossCents = Math.round(Number(session.amount_total != null ? session.amount_total : (order && order.amount)));
    const reconstructedTotal = subtotalGrossCents - discountGrossCents + shippingGrossCents;

    if (!items.length) throw new Error('Stripe-Session enthaelt keine Rechnungspositionen.');
    if (!Number.isInteger(totalGrossCents) || totalGrossCents <= 0) throw new Error('Ungueltiger Rechnungsbetrag.');
    if (Math.abs(reconstructedTotal - totalGrossCents) > 1) {
        throw new Error(`Stripe-Summen stimmen nicht ueberein (${reconstructedTotal} statt ${totalGrossCents} Cent).`);
    }

    return {
        session,
        payment,
        customer,
        deliveryCountry,
        currency,
        items,
        subtotalGrossCents,
        discountGrossCents,
        shippingGrossCents,
        totalGrossCents,
        paymentStatus: cleanText(session.payment_status, 40).toLowerCase()
    };
}

function validateInvoiceData(invoice) {
    const errors = [];
    if (!invoice.number) errors.push('Rechnungsnummer fehlt.');
    if (!asDate(invoice.issuedAt)) errors.push('Ausstellungsdatum fehlt.');
    if (!asDate(invoice.serviceDate)) errors.push('Leistungsdatum fehlt.');
    if (!asDate(invoice.paymentDate)) errors.push('Zahlungsdatum fehlt.');
    if (!SELLER.businessName || !SELLER.address.line1 || !SELLER.address.postalCode || !SELLER.address.city) {
        errors.push('Vollstaendige Absenderdaten fehlen.');
    }
    if (!SELLER.vatId) errors.push('USt-IdNr. fehlt.');
    if (!invoice.customer || !invoice.customer.name) errors.push('Kundenname fehlt.');
    if (!invoice.customer || !isCompleteAddress(invoice.customer.address)) errors.push('Vollstaendige Kundenanschrift fehlt.');
    if (!Array.isArray(invoice.items) || !invoice.items.length) errors.push('Rechnungspositionen fehlen.');
    if (!Number.isInteger(invoice.totalGrossCents) || invoice.totalGrossCents <= 0) errors.push('Gesamtbetrag ist ungueltig.');
    if (!invoice.vatRateBps && !cleanText(invoice.taxExemptionNote, 300)) {
        errors.push('Bei 0 % Umsatzsteuer ist ein Steuerbefreiungshinweis erforderlich.');
    }
    if (errors.length) {
        const error = new Error(errors.join(' '));
        error.code = 'INVOICE_VALIDATION_FAILED';
        throw error;
    }
}

async function allocateInvoiceNumber(issuedAt = new Date()) {
    const year = getInvoiceYear(issuedAt);
    const key = `invoice:${year}:${INVOICE_PREFIX}`;
    let counter = await InvoiceCounter.findById(key);
    if (!counter) {
        try {
            counter = await InvoiceCounter.create({
                _id: key,
                sequence: INVOICE_SEQUENCE_START - 1
            });
        } catch (error) {
            if (!error || error.code !== 11000) throw error;
        }
    }
    counter = await InvoiceCounter.findByIdAndUpdate(
        key,
        { $inc: { sequence: 1 } },
        { returnDocument: 'after' }
    );
    if (!counter) throw new Error('Rechnungsnummer konnte nicht vergeben werden.');
    return `${INVOICE_PREFIX}-${year}-${String(counter.sequence).padStart(6, '0')}`;
}

function drawRightText(doc, text, x, y, width, options = {}) {
    doc.text(text, x, y, { width, align: 'right', lineBreak: false, ...options });
}

function generateInvoicePdf(invoice) {
    validateInvoiceData(invoice);
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 46, right: 46, bottom: 58, left: 46 },
            info: {
                Title: `Rechnung ${invoice.number}`,
                Author: SELLER.businessName,
                Subject: `Rechnung zur Bestellung ${invoice.orderReference}`,
                Creator: 'NOTE. Rechnungsservice'
            },
            bufferPages: true
        });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('error', reject);
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.registerFont('Inter', INTER_REGULAR_FONT);
        doc.registerFont('Inter-Bold', INTER_BOLD_FONT);
        doc.registerFont('Cormorant-Medium', CORMORANT_MEDIUM_FONT);

        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
        const left = doc.page.margins.left;
        const navy = '#2f3b49';
        const ink = '#20252b';
        const muted = '#66717c';
        const pale = '#eef1f4';
        const logoGold = '#b69237';
        const tableRightPadding = 10;

        function drawPageHeader(continuation = false) {
            const logoWidth = 150;
            const logoWord = 'fragrances';
            doc.fillColor(ink).font('Cormorant-Medium').fontSize(30)
                .text('NØTE.', left, 31, { width: logoWidth, align: 'center', characterSpacing: 1.1, lineBreak: false });
            doc.fillColor(logoGold).font('Inter').fontSize(8.5);
            const logoWordWidth = doc.widthOfString(logoWord, { characterSpacing: 0.55 });
            const logoWordX = left + (logoWidth - logoWordWidth) / 2;
            doc.text(logoWord, logoWordX, 67, { characterSpacing: 0.55, lineBreak: false });
            const logoLineY = 74;
            doc.moveTo(left + 4, logoLineY).lineTo(logoWordX - 7, logoLineY).lineWidth(0.8).strokeColor(logoGold).stroke();
            doc.moveTo(logoWordX + logoWordWidth + 7, logoLineY).lineTo(left + logoWidth - 4, logoLineY).lineWidth(0.8).strokeColor(logoGold).stroke();
            doc.fillColor(navy).font('Inter-Bold').fontSize(15);
            drawRightText(doc, continuation ? `RECHNUNG ${invoice.number} - FORTSETZUNG` : 'RECHNUNG', pageWidth - 246, 45, 200);
            doc.moveTo(left, 89).lineTo(pageWidth - doc.page.margins.right, 89).lineWidth(1.1).strokeColor(navy).stroke();
            doc.y = 104;
        }

        function ensureSpace(height, repeatItemsHeader = true) {
            const bottom = doc.page.height - doc.page.margins.bottom - 38;
            if (doc.y + height <= bottom) return;
            doc.addPage();
            drawPageHeader(true);
            if (repeatItemsHeader) drawItemsHeader();
        }

        function drawItemsHeader() {
            const y = doc.y;
            doc.rect(left, y, contentWidth, 24).fill(pale);
            doc.fillColor(ink).font('Inter-Bold').fontSize(8);
            doc.text('POS.', left + 8, y + 8, { width: 32 });
            doc.text('ARTIKEL', left + 44, y + 8, { width: 230 });
            drawRightText(doc, 'MENGE', left + 275, y + 8, 45);
            drawRightText(doc, 'EINZEL BRUTTO', left + 332, y + 8, 82);
            drawRightText(doc, 'GESAMT', left + 425, y + 8, contentWidth - 425 - tableRightPadding);
            doc.y = y + 30;
        }

        drawPageHeader(false);

        doc.fillColor(muted).font('Inter').fontSize(7.5)
            .text(`${SELLER.businessName} | ${SELLER.address.line1} | ${SELLER.address.postalCode} ${SELLER.address.city}`, left, doc.y);
        doc.moveDown(1.3);
        doc.fillColor(ink).font('Inter-Bold').fontSize(10).text(invoice.customer.name, left, doc.y, { width: 250 });
        doc.font('Inter').fontSize(9);
        doc.text(invoice.customer.address.line1, left, doc.y, { width: 250 });
        if (invoice.customer.address.line2) doc.text(invoice.customer.address.line2, left, doc.y, { width: 250 });
        doc.text(`${invoice.customer.address.postalCode} ${invoice.customer.address.city}`, left, doc.y, { width: 250 });
        doc.text(invoice.customer.address.country, left, doc.y, { width: 250 });
        if (Array.isArray(invoice.customer.taxIds) && invoice.customer.taxIds.length) {
            doc.moveDown(0.35);
            doc.fillColor(muted).fontSize(7.5).text(
                `Steuer-ID: ${invoice.customer.taxIds.map(taxId => taxId.value).join(', ')}`,
                left,
                doc.y,
                { width: 250 }
            );
        }

        const metaX = pageWidth - 276;
        const metaY = 104;
        const metaLabelWidth = 86;
        const metaValueWidth = 138;
        const metaRows = [
            ['Rechnungsnummer', invoice.number],
            ['Rechnungsdatum', formatDate(invoice.issuedAt)],
            ['Leistungsdatum', formatDate(invoice.serviceDate)],
            ['Zahlungsdatum', formatDate(invoice.paymentDate)],
            ['Bestellnummer', invoice.orderReference]
        ];
        metaRows.forEach((row, index) => {
            const y = metaY + index * 19;
            doc.fillColor(muted).font('Inter').fontSize(8).text(row[0], metaX, y, { width: metaLabelWidth });
            doc.fillColor(ink).font('Inter-Bold').fontSize(8).text(row[1], metaX + metaLabelWidth, y, { width: metaValueWidth, align: 'right' });
        });

        doc.y = Math.max(doc.y + 22, 220);
        doc.fillColor(ink).font('Inter').fontSize(9)
            .text('Vielen Dank für Ihre Bestellung. Wir berechnen Ihnen folgende Positionen:', left, doc.y, { width: contentWidth });
        doc.moveDown(1.2);
        drawItemsHeader();

        invoice.items.forEach((item) => {
            const descriptionHeight = doc.heightOfString(item.description, { width: 226 });
            const rowHeight = Math.max(28, descriptionHeight + 12);
            ensureSpace(rowHeight + 2);
            const y = doc.y;
            doc.fillColor(ink).font('Inter').fontSize(8.5);
            doc.text(String(item.position), left + 8, y + 5, { width: 30 });
            doc.text(item.description, left + 44, y + 5, { width: 226 });
            drawRightText(doc, String(item.quantity), left + 275, y + 5, 45);
            drawRightText(doc, formatMoney(item.unitGrossCents, invoice.currency), left + 332, y + 5, 82);
            drawRightText(doc, formatMoney(item.totalGrossCents, invoice.currency), left + 425, y + 5, contentWidth - 425 - tableRightPadding);
            doc.moveTo(left, y + rowHeight).lineTo(left + contentWidth, y + rowHeight).lineWidth(0.4).strokeColor('#dddddd').stroke();
            doc.y = y + rowHeight + 2;
        });

        // Die Positionstabelle erhaelt einen klaren optischen Abschluss,
        // bevor der separate Summenblock beginnt.
        doc.y += 16;
        ensureSpace(194, false);
        const totalsLabelX = left + 300;
        const totalsValueX = left + 430;
        const totalsWidth = contentWidth - 430 - tableRightPadding;
        const totalRows = [
            ['Zwischensumme', invoice.subtotalGrossCents],
            ...(invoice.discountGrossCents > 0 ? [['Rabatt', -invoice.discountGrossCents]] : []),
            ['Versand', invoice.shippingGrossCents]
        ];
        let totalsY = doc.y;
        totalRows.forEach(([label, value]) => {
            doc.fillColor(muted).font('Inter').fontSize(8.5).text(label, totalsLabelX, totalsY, { width: 125 });
            drawRightText(doc, formatMoney(value, invoice.currency), totalsValueX, totalsY, totalsWidth);
            totalsY += 18;
        });
        const totalY = totalsY + 3;
        doc.rect(totalsLabelX, totalY, contentWidth - 300, 31).fill(navy);
        doc.fillColor('#ffffff').font('Inter-Bold').fontSize(10).text('GESAMTBETRAG', totalsLabelX + 10, totalY + 10, { width: 120 });
        drawRightText(doc, formatMoney(invoice.totalGrossCents, invoice.currency), totalsValueX, totalY + 9, totalsWidth);
        doc.y = totalY + 47;

        doc.fillColor(ink).font('Inter-Bold').fontSize(9).text('Umsatzsteuerübersicht', left, doc.y, { width: contentWidth });
        doc.moveDown(0.5);
        const taxY = doc.y;
        doc.rect(left, taxY, contentWidth, 22).fill(pale);
        doc.fillColor(ink).font('Inter-Bold').fontSize(8);
        doc.text('STEUERSATZ', left + 8, taxY + 7, { width: 95 });
        drawRightText(doc, 'NETTO', left + 205, taxY + 7, 82);
        drawRightText(doc, 'UMSATZSTEUER', left + 320, taxY + 7, 90);
        drawRightText(doc, 'BRUTTO', left + 425, taxY + 7, contentWidth - 425 - tableRightPadding);
        const taxRowY = taxY + 29;
        doc.fillColor(ink).font('Inter').fontSize(8.5);
        doc.text(`${(invoice.vatRateBps / 100).toFixed(2).replace('.', ',')} %`, left + 8, taxRowY, { width: 95 });
        drawRightText(doc, formatMoney(invoice.totalNetCents, invoice.currency), left + 205, taxRowY, 82);
        drawRightText(doc, formatMoney(invoice.totalTaxCents, invoice.currency), left + 320, taxRowY, 90);
        drawRightText(doc, formatMoney(invoice.totalGrossCents, invoice.currency), left + 425, taxRowY, contentWidth - 425 - tableRightPadding);
        const taxTableBottomY = taxRowY + 23;
        doc.moveTo(left, taxTableBottomY).lineTo(left + contentWidth, taxTableBottomY).lineWidth(0.4).strokeColor('#d7dce1').stroke();
        doc.y = taxTableBottomY + 15;

        if (invoice.taxExemptionNote) {
            doc.fillColor(muted).font('Inter').fontSize(8).text(invoice.taxExemptionNote, left, doc.y, { width: contentWidth });
            doc.moveDown(0.8);
        }
        doc.fillColor(ink).font('Inter-Bold').fontSize(9)
            .text('Der Rechnungsbetrag wurde bereits bezahlt.', left, doc.y, { width: contentWidth });
        doc.moveDown(0.55);
        const currencyLabel = String(invoice.currency || 'eur').toUpperCase();
        const taxSentence = invoice.vatRateBps
            ? 'Die Umsatzsteuer ist im Rechnungsbetrag enthalten.'
            : 'Es wird keine Umsatzsteuer ausgewiesen; der oben genannte Steuerhinweis ist zu beachten.';
        doc.fillColor(muted).font('Inter').fontSize(8)
            .text(`Alle Beträge sind in ${currencyLabel} angegeben. ${taxSentence} Bitte bewahren Sie diese Rechnung für Ihre Unterlagen auf.`, left, doc.y, { width: contentWidth });

        const range = doc.bufferedPageRange();
        for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
            doc.switchToPage(pageIndex);
            const footerY = doc.page.height - doc.page.margins.bottom - 14;
            doc.moveTo(left, footerY - 8).lineTo(doc.page.width - doc.page.margins.right, footerY - 8).lineWidth(0.5).strokeColor('#cccccc').stroke();
            doc.fillColor(muted).font('Inter').fontSize(6.8)
                .text(`${SELLER.businessName} | Inh. ${SELLER.ownerName} | ${SELLER.address.line1}, ${SELLER.address.postalCode} ${SELLER.address.city} | ${SELLER.email} | USt-IdNr. ${SELLER.vatId}`, left, footerY, { width: contentWidth - 45, lineBreak: false });
            drawRightText(doc, `Seite ${pageIndex + 1} / ${range.count}`, doc.page.width - 92, footerY, 46);
        }

        doc.end();
    });
}

async function buildInvoiceFromSnapshot({ order, snapshot, serviceDate, serviceDateSource, taxRateBps, taxExemptionNote, generatedBy }) {
    const issuedAt = new Date();
    const vatRate = Number.isInteger(taxRateBps) ? taxRateBps : DEFAULT_VAT_RATE_BPS;
    const vat = splitIncludedVat(snapshot.totalGrossCents, vatRate);
    const invoiceBaseData = {
        number: 'PENDING',
        issuedAt,
        serviceDate: asDate(serviceDate),
        paymentDate: snapshot.payment.paidAt,
        currency: snapshot.currency,
        orderReference: String(order.orderNumber || ''),
        seller: SELLER,
        customer: snapshot.customer,
        items: snapshot.items.map(item => ({ ...item, vatRateBps: vatRate })),
        subtotalGrossCents: snapshot.subtotalGrossCents,
        discountGrossCents: snapshot.discountGrossCents,
        shippingGrossCents: snapshot.shippingGrossCents,
        totalNetCents: vat.netCents,
        totalTaxCents: vat.taxCents,
        totalGrossCents: vat.grossCents,
        vatRateBps: vatRate,
        taxExemptionNote: cleanText(taxExemptionNote, 300),
        payment: {
            provider: 'Stripe',
            method: snapshot.payment.method,
            stripeSessionId: order.stripeSessionId,
            stripePaymentIntentId: snapshot.payment.paymentIntentId
        },
        source: {
            type: 'stripe_checkout',
            serviceDateSource: cleanText(serviceDateSource, 80),
            deliveryCountry: cleanText(snapshot.deliveryCountry, 10).toUpperCase(),
            generatedBy: cleanText(generatedBy || 'automatic', 80)
        }
    };
    // Erst alle Pflichtangaben prüfen, dann eine nicht wiederverwendbare Nummer verbrauchen.
    validateInvoiceData(invoiceBaseData);
    const invoiceNumber = await allocateInvoiceNumber(issuedAt);
    const invoiceData = { ...invoiceBaseData, number: invoiceNumber };
    validateInvoiceData(invoiceData);
    const pdfData = await generateInvoicePdf(invoiceData);
    const pdfFileName = `Rechnung_${invoiceNumber}.pdf`;
    return {
        ...invoiceData,
        order: order._id,
        pdfFileName,
        pdfContentType: 'application/pdf',
        pdfData,
        pdfByteLength: pdfData.length,
        pdfSha256: crypto.createHash('sha256').update(pdfData).digest('hex'),
        pdfGeneratedAt: new Date()
    };
}

async function ensureInvoiceForOrder({
    order,
    stripeClient,
    serviceDate,
    serviceDateSource,
    taxRateBps,
    taxExemptionNote,
    generatedBy = 'automatic'
}) {
    if (!order || !order._id) throw new Error('Bestellung fehlt.');
    await ensureOrderNumber(order);
    const existing = await Invoice.findOne({ order: order._id });
    if (existing) {
        order.invoicePending = false;
        order.invoice = existing._id;
        order.invoiceNumber = existing.number;
        order.invoiceIssuedAt = existing.issuedAt;
        order.invoiceStatus = 'generated';
        order.invoiceError = '';
        order.taxAmount = existing.totalTaxCents;
        await order.save();
        return { status: 'existing', invoice: existing };
    }

    let snapshot;
    if (order.refundedAmountCents > 0 || (order.disputeStatus && order.disputeStatus !== 'won') || order.amount === 0) {
        order.invoicePending = false;
        order.invoiceStatus = 'manual_review';
        order.invoiceError = 'Erstattung, Streitfall oder Nullbetrag: Original- und Korrekturbelege fachlich prüfen.';
        await order.save();
        return { status: 'manual_review', reason: order.invoiceError };
    }
    order.invoicePending = true;
    await order.save();
    try {
        snapshot = await retrieveCheckoutSnapshot(stripeClient, order);
    } catch (error) {
        order.invoicePending = true;
        order.invoiceStatus = 'error';
        order.invoiceError = cleanText(error.message, 500);
        await order.save();
        throw error;
    }

    if (order.paymentStatus === 'paid' && snapshot.paymentStatus !== 'paid') {
        order.invoicePending = false;
        order.invoiceStatus = 'manual_review';
        order.invoiceError = 'Der Providerstatus widerspricht der bereits bestätigten Zahlung. Bitte abgleichen.';
        await order.save();
        return { status: 'manual_review', reason: order.invoiceError };
    }
    order.paymentStatus = snapshot.paymentStatus;
    order.paidAt = snapshot.payment.paidAt;
    order.stripePaymentIntentId = snapshot.payment.paymentIntentId;
    order.currency = snapshot.currency;
    order.shippingAmount = snapshot.shippingGrossCents;

    if (snapshot.paymentStatus !== 'paid') {
        order.invoicePending = false;
        order.invoiceStatus = 'awaiting_payment';
        order.invoiceError = '';
        await order.save();
        return { status: 'awaiting_payment', snapshot };
    }

    const country = cleanText(snapshot.deliveryCountry || snapshot.customer.address.country, 10).toUpperCase();
    const explicitTaxRate = Number.isInteger(taxRateBps);
    if (!AUTOMATIC_COUNTRIES.has(country) && !explicitTaxRate) {
        order.invoicePending = false;
        order.invoiceStatus = 'manual_review';
        order.invoiceError = `Steuerliche Pruefung fuer Lieferland ${country || 'unbekannt'} erforderlich.`;
        await order.save();
        return { status: 'manual_review', snapshot, reason: order.invoiceError };
    }

    const resolvedServiceDate = asDate(serviceDate) || resolveServiceDate(order).date;
    const resolvedServiceDateSource = serviceDateSource || resolveServiceDate(order).source;
    if (!resolvedServiceDate) {
        order.invoicePending = false;
        order.invoiceStatus = 'awaiting_service_date';
        order.invoiceError = 'Leistungs-/Versanddatum fehlt.';
        await order.save();
        return { status: 'awaiting_service_date', snapshot };
    }

    try {
        const invoiceDocument = await buildInvoiceFromSnapshot({
            order,
            snapshot,
            serviceDate: resolvedServiceDate,
            serviceDateSource: resolvedServiceDateSource,
            taxRateBps,
            taxExemptionNote,
            generatedBy
        });
        const invoice = await Invoice.create(invoiceDocument);
        order.invoicePending = false;
        order.invoice = invoice._id;
        order.invoiceNumber = invoice.number;
        order.invoiceIssuedAt = invoice.issuedAt;
        order.invoiceStatus = 'generated';
        order.invoiceError = '';
        order.taxAmount = invoice.totalTaxCents;
        await order.save();
        return { status: 'generated', invoice };
    } catch (error) {
        if (error && error.code === 11000) {
            const racedInvoice = await Invoice.findOne({ order: order._id });
            if (racedInvoice) {
                order.invoicePending = false;
                order.invoice = racedInvoice._id;
                order.invoiceNumber = racedInvoice.number;
                order.invoiceIssuedAt = racedInvoice.issuedAt;
                order.invoiceStatus = 'generated';
                order.invoiceError = '';
                order.taxAmount = racedInvoice.totalTaxCents;
                await order.save();
                return { status: 'existing', invoice: racedInvoice };
            }
        }
        order.invoicePending = true;
        order.invoiceStatus = 'error';
        order.invoiceError = cleanText(error.message, 500);
        await order.save();
        throw error;
    }
}

function getPublicInvoiceConfig() {
    return {
        seller: SELLER,
        numberPrefix: INVOICE_PREFIX,
        sequenceStart: INVOICE_SEQUENCE_START,
        automaticCountries: Array.from(AUTOMATIC_COUNTRIES),
        defaultVatRate: DEFAULT_VAT_RATE_BPS / 100,
        format: 'PDF (sonstige Rechnung / B2C)'
    };
}

module.exports = {
    SELLER,
    DEFAULT_VAT_RATE_BPS,
    cleanText,
    normalizeAddress,
    isCompleteAddress,
    getDeliveryCountry,
    asDate,
    formatDate,
    getInvoiceYear,
    formatMoney,
    splitIncludedVat,
    resolveServiceDate,
    retrieveCheckoutSnapshot,
    validateInvoiceData,
    generateInvoicePdf,
    ensureInvoiceForOrder,
    getPublicInvoiceConfig
};
