function createEmailTemplates({ EMAIL_ICON_CHECK_IMAGE_URL, EMAIL_WAVE_BOTTOM_IMAGE_URL, EMAIL_WAVE_TOP_IMAGE_URL, escapeHtml, sanitizeTrackingUrl }) {
function renderBrandEmail({ badge, title, introHtml, iconHtml = '', iconImageUrl = '', bodyHtml = '', ctaHtml = '', afterBodyHtml = '' }) {
    const safeTopWaveUrl = sanitizeTrackingUrl(EMAIL_WAVE_TOP_IMAGE_URL);
    const safeBottomWaveUrl = sanitizeTrackingUrl(EMAIL_WAVE_BOTTOM_IMAGE_URL);
    const safeIconImageUrl = sanitizeTrackingUrl(iconImageUrl);
    const iconMarkup = safeIconImageUrl
        ? `<img src="${safeIconImageUrl}" width="62" height="62" alt="" style="display:block;width:62px;height:62px;border:0;outline:none;text-decoration:none;margin:0 auto 22px;">`
        : (iconHtml
            ? `<div style="display:inline-block;width:62px;height:62px;border-radius:50%;border:1.5px solid #d4af37;line-height:60px;font-size:22px;color:#d4af37;margin-bottom:22px;">${iconHtml}</div>`
            : '');

    return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#e2dfd8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e2dfd8;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td style="background:#f5f3ee;padding:0;line-height:0;font-size:0;">
        <img src="${safeTopWaveUrl}" width="560" height="46" alt="" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;">
      </td></tr>
      <tr><td style="background:#f5f3ee;padding:18px 48px 14px;text-align:center;">
        <p style="margin:0 0 5px;font-family:Georgia,serif;color:#000000;font-size:30px;letter-spacing:0.12em;font-weight:400;">N&Oslash;TE.</p>
        <table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
          <tr>
            <td style="width:32px;font-size:0;line-height:0;overflow:hidden;border-top:1px solid #333333;">&nbsp;</td>
            <td style="font-family:Arial,sans-serif;font-size:9px;color:#333333;letter-spacing:0.28em;text-transform:uppercase;padding:0 8px;">fragrances</td>
            <td style="width:32px;font-size:0;line-height:0;overflow:hidden;border-top:1px solid #333333;">&nbsp;</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="height:2px;background:#d4af37;"></td></tr>
      <tr><td style="background:#f5f3ee;padding:48px 48px 40px;text-align:center;">
        ${iconMarkup}
        <p style="margin:0 0 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#d4af37;font-weight:700;">${badge}</p>
        <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:28px;color:#1a1a1a;font-weight:400;">${title}</h1>
        <div style="margin:0 auto;font-size:13px;color:#666;line-height:1.8;max-width:400px;">${introHtml}</div>
      </td></tr>
      ${bodyHtml}
      ${ctaHtml ? `<tr><td style="background:#f5f3ee;padding:0 48px 34px;text-align:center;">${ctaHtml}</td></tr>` : ''}
      ${afterBodyHtml}
      <tr><td style="background:#f5f3ee;padding:0;line-height:0;font-size:0;">
        <img src="${safeBottomWaveUrl}" width="560" height="104" alt="" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;">
      </td></tr>
      <tr><td style="background:#0f0f0f;border-bottom:1px solid #d4af37;padding:22px 36px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
          <tr>
            <td colspan="4" style="text-align:center;padding:0 0 16px;">
              <p style="margin:0 0 6px;font-family:Georgia,serif;color:#ffffff;font-size:26px;letter-spacing:0.12em;">N&Oslash;TE.</p>
              <table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td style="width:34px;font-size:0;line-height:0;border-top:1px solid #d4af37;">&nbsp;</td>
                  <td style="font-family:Arial,sans-serif;font-size:9px;color:#d4af37;letter-spacing:0.28em;text-transform:uppercase;padding:0 10px;">fragrances</td>
                  <td style="width:34px;font-size:0;line-height:0;border-top:1px solid #d4af37;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td width="25%" valign="top" style="padding:0 10px 12px 0;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Rechtliches</p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/agb.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">AGB</a></p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/impressum.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Impressum</a></p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/widerrufsrecht.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Widerruf</a></p>
              <p style="margin:0;"><a href="https://note-fragrances.de/datenschutz.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Datenschutz</a></p>
            </td>
            <td width="25%" valign="top" style="padding:0 10px 12px;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Shop</p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/suche.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Kollektion</a></p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/frauenduefte.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Frauenduefte</a></p>
              <p style="margin:0;"><a href="https://note-fragrances.de/herrenduefte.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Herrenduefte</a></p>
            </td>
            <td width="30%" valign="top" style="padding:0 10px 12px;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Ueber Uns</p>
              <p style="margin:0;color:#a0a0a0;font-size:12px;line-height:1.6;">Exklusive Extrait de Parfums mit hoher Duftoel-Konzentration. Intensiv, langanhaltend und kompromisslos in der Qualitaet.</p>
            </td>
            <td width="20%" valign="top" style="padding:0 0 12px 10px;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Service</p>
              <p style="margin:0 0 7px;"><a href="mailto:info@note-fragrances.de" style="color:#a0a0a0;text-decoration:none;font-size:12px;">info@note-fragrances.de</a></p>
              <p style="margin:0;color:#a0a0a0;font-size:12px;">Warnitzer Str. 20<br>13057 Berlin</p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(255,255,255,0.16);padding-top:16px;">
          <tr>
            <td style="font-size:11px;color:#767676;text-align:center;">&copy; 2026 N&Oslash;TE. fragrances. Alle Rechte vorbehalten.</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function formatEuroFromCents(amountCents) {
    const normalized = Number.isFinite(Number(amountCents)) ? Number(amountCents) : 0;
    return (Math.max(0, normalized) / 100).toFixed(2).replace('.', ',');
}

function formatAddressHtml(address) {
    if (!address || typeof address !== 'object') {
        return '&ndash;';
    }

    const line1 = escapeHtml(address.line1 || '');
    const line2 = escapeHtml(address.line2 || '');
    const postalCode = escapeHtml(address.postal_code || '');
    const city = escapeHtml(address.city || '');
    const country = escapeHtml(address.country || '');
    const middleLine = [postalCode, city].filter(Boolean).join(' ');
    const lines = [line1];
    if (line2) lines.push(line2);
    if (middleLine) lines.push(middleLine);
    if (country) lines.push(country);
    const rendered = lines.filter(Boolean).join('<br>');
    return rendered || '&ndash;';
}

function buildEmailItemsHtml(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return '<p style="color:#999;font-size:13px;">&ndash;</p>';
    }

    return items.map((item, index) => {
        const safeDescription = escapeHtml(item.description || '');
        const safeImageUrl = sanitizeTrackingUrl(item.imageUrl || '');
        const qty = Number.isFinite(Number(item.quantity))
            ? Math.max(1, Math.floor(Number(item.quantity)))
            : 1;
        const amountText = escapeHtml(String(item.amountText || '0,00'));
        const isLast = index === items.length - 1;
        const rowBorder = isLast ? 'border-bottom:none;' : 'border-bottom:1px solid #e6e6e6;';
        const imageBlock = safeImageUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:60px;height:60px;border:1px solid #e6e6e6;border-radius:4px;background:#ffffff;"><tr><td align="center" valign="middle" style="width:60px;height:60px;padding:0;">
<img src="${safeImageUrl}" alt="${safeDescription}" style="display:block;border:0;outline:none;text-decoration:none;width:auto;height:auto;max-width:60px;max-height:60px;">
</td></tr></table>`
            : '<div style="width:60px;height:60px;background:#f0ede8;border-radius:4px;border:1px solid #e6e6e6;display:inline-block;"></div>';

        return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;padding-bottom:16px;${rowBorder}">
  <tr>
    <td style="width:70px;vertical-align:middle;">${imageBlock}</td>
    <td style="padding-left:14px;vertical-align:middle;font-family:'Inter',Arial,sans-serif;">
      <p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:500;">${safeDescription}</p>
      <p style="margin:3px 0 0;font-size:12px;color:#999999;">Menge: ${qty}</p>
    </td>
    <td style="text-align:right;vertical-align:middle;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#1a1a1a;font-weight:500;white-space:nowrap;">${amountText} &euro;</td>
  </tr>
</table>`;
    }).join('');
}

function normalizeOrderNumber(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9#-]/g, '')
        .slice(0, 40);
}

function buildEmailOrderNumberLine(orderNumber) {
    const safeOrderNumber = escapeHtml(normalizeOrderNumber(orderNumber));
    if (!safeOrderNumber) return '';
    return `<br><br><span style="display:inline-block;padding:6px 10px;border:1px solid #d9d2c4;border-radius:4px;font-size:11px;letter-spacing:0.08em;color:#5f5a51;background:#faf8f3;">Bestellnummer&nbsp; <strong style="color:#1a1a1a;">${safeOrderNumber}</strong></span>`;
}

function buildOrderConfirmationEmailPayload({
    orderNumber = '',
    customerName = 'Kunde',
    items = [],
    shippingCostCents = null,
    discountAmountCents = 0,
    couponCode = '',
    totalAmountCents = 0,
    address = null
}) {
    const safeCustomerName = escapeHtml(customerName || 'Kunde');
    const safeCouponCode = escapeHtml(couponCode || '');
    const shippingText = Number.isFinite(Number(shippingCostCents))
        ? `${formatEuroFromCents(shippingCostCents)} &euro;`
        : 'Kostenlos';
    const discountHtml = Number(discountAmountCents) > 0
        ? `<tr>
  <td style="font-size:13px;color:#7f776a;padding-top:8px;">Rabatt${safeCouponCode ? ` (${safeCouponCode})` : ''}</td>
  <td style="text-align:right;font-size:13px;color:#7f776a;padding-top:8px;">-${formatEuroFromCents(discountAmountCents)} &euro;</td>
</tr>`
        : '';
    const itemsHtml = buildEmailItemsHtml(items);
    const addressHtml = formatAddressHtml(address);
    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const orderNumberLine = buildEmailOrderNumberLine(normalizedOrderNumber);

    return {
        subject: normalizedOrderNumber
            ? `Deine Bestellung ${normalizedOrderNumber} bei NOTE. fragrances \u2713`
            : 'Deine Bestellung bei NOTE. fragrances \u2713',
        html: renderBrandEmail({
            badge: 'Bestellbestaetigung',
            title: `Vielen Dank, ${safeCustomerName}!`,
            introHtml: `Deine Bestellung ist bei uns eingegangen und wird schnellstmoeglich bearbeitet. Wir melden uns, sobald dein Paket auf dem Weg ist.${orderNumberLine}`,
            iconImageUrl: EMAIL_ICON_CHECK_IMAGE_URL,
            bodyHtml: `<tr><td style="background:#f5f3ee;padding:26px 40px 0;">
  <div style="border-top:1px solid #dfd8ca;padding-top:18px;">
    <p style="margin:0 0 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#9d9688;font-weight:700;">Deine Bestellung</p>
    ${itemsHtml}
  </div>
</td></tr>
<tr><td style="background:#f5f3ee;padding:0 40px 10px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0e8;border:1px solid #e0dacd;border-left:3px solid #d4af37;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="padding:14px 16px 6px;font-size:10px;color:#8f887a;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">Lieferadresse</td>
    </tr>
    <tr>
      <td style="padding:0 16px 14px;font-size:14px;color:#2f2f2f;line-height:1.6;">${addressHtml}</td>
    </tr>
  </table>
</td></tr>
<tr><td style="background:#f5f3ee;padding:0 40px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;background:#f3f0e8;border:1px solid #e0dacd;border-radius:8px;padding:10px 14px;">
    <tr>
      <td style="font-size:13px;color:#7f776a;">Versand</td>
      <td style="text-align:right;font-size:13px;color:#7f776a;">${shippingText}</td>
    </tr>
    ${discountHtml}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #d4af37;padding-top:14px;margin-top:2px;">
    <tr>
      <td style="font-size:11px;color:#8f887a;text-transform:uppercase;letter-spacing:0.15em;vertical-align:bottom;">Gesamtbetrag</td>
      <td style="text-align:right;font-family:Georgia,serif;font-size:26px;color:#1a1a1a;font-weight:400;vertical-align:bottom;">${formatEuroFromCents(totalAmountCents)} &euro;</td>
    </tr>
  </table>
</td></tr>`,
            afterBodyHtml: `<tr><td style="background:#f5f3ee;padding:32px 48px 40px;text-align:center;">
  <p style="margin:0 0 6px;font-size:13px;color:#888;">Fragen zu deiner Bestellung?</p>
  <a href="mailto:info@note-fragrances.de" style="font-size:14px;color:#000;font-weight:700;text-decoration:none;">info@note-fragrances.de</a>
</td></tr>`
        })
    };
}

function buildPickupOrderConfirmationEmailPayload({
    orderNumber = '',
    customerName = 'Kunde',
    items = [],
    discountAmountCents = 0,
    couponCode = '',
    totalAmountCents = 0
}) {
    const safeCustomerName = escapeHtml(customerName || 'Kunde');
    const safeCouponCode = escapeHtml(couponCode || '');
    const itemsHtml = buildEmailItemsHtml(items);
    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const orderNumberLine = buildEmailOrderNumberLine(normalizedOrderNumber);
    const discountHtml = Number(discountAmountCents) > 0
        ? `<tr>
  <td style="font-size:13px;color:#7f776a;padding-top:8px;">Rabatt${safeCouponCode ? ` (${safeCouponCode})` : ''}</td>
  <td style="text-align:right;font-size:13px;color:#7f776a;padding-top:8px;">-${formatEuroFromCents(discountAmountCents)} &euro;</td>
</tr>`
        : '';

    return {
        subject: normalizedOrderNumber
            ? `Deine Abhol-Bestellung ${normalizedOrderNumber} bei NOTE. fragrances \u2713`
            : 'Deine Abhol-Bestellung bei NOTE. fragrances \u2713',
        html: renderBrandEmail({
            badge: 'Bestellbestaetigung',
            title: `Vielen Dank, ${safeCustomerName}!`,
            introHtml: `Deine Bestellung zur <strong>Selbstabholung</strong> ist bei uns eingegangen und wird fuer dich bereitgestellt. Wir melden uns per E-Mail, sobald du sie im Store abholen kannst.${orderNumberLine}`,
            iconImageUrl: EMAIL_ICON_CHECK_IMAGE_URL,
            bodyHtml: `<tr><td style="background:#f5f3ee;padding:26px 40px 0;">
  <div style="border-top:1px solid #dfd8ca;padding-top:18px;">
    <p style="margin:0 0 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#9d9688;font-weight:700;">Deine Bestellung</p>
    ${itemsHtml}
  </div>
</td></tr>
<tr><td style="background:#f5f3ee;padding:0 40px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;background:#f3f0e8;border:1px solid #e0dacd;border-radius:8px;padding:10px 14px;">
    <tr>
      <td style="font-size:13px;color:#7f776a;">Versandart</td>
      <td style="text-align:right;font-size:13px;color:#7f776a;">Selbstabholung</td>
    </tr>
    <tr>
      <td style="font-size:13px;color:#7f776a;padding-top:8px;">Zahlungsart</td>
      <td style="text-align:right;font-size:13px;color:#7f776a;padding-top:8px;">Bar bei Abholung</td>
    </tr>
    ${discountHtml}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #d4af37;padding-top:14px;margin-top:2px;">
    <tr>
      <td style="font-size:11px;color:#8f887a;text-transform:uppercase;letter-spacing:0.15em;vertical-align:bottom;">Gesamtbetrag (Bar)</td>
      <td style="text-align:right;font-family:Georgia,serif;font-size:26px;color:#1a1a1a;font-weight:400;vertical-align:bottom;">${formatEuroFromCents(totalAmountCents)} &euro;</td>
    </tr>
  </table>
</td></tr>`,
            afterBodyHtml: `<tr><td style="background:#f5f3ee;padding:32px 48px 40px;text-align:center;">
  <p style="margin:0 0 6px;font-size:13px;color:#888;">Fragen zu deiner Bestellung?</p>
  <a href="mailto:info@note-fragrances.de" style="font-size:14px;color:#000;font-weight:700;text-decoration:none;">info@note-fragrances.de</a>
</td></tr>`
        })
    };
}

function buildShippingEmailPayload({ orderNumber = '', customerName = 'du', trackingUrl = '' }) {
    const safeOrderName = escapeHtml(customerName || 'du');
    const safeTrackingUrl = sanitizeTrackingUrl(trackingUrl);
    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const orderNumberLine = buildEmailOrderNumberLine(normalizedOrderNumber);
    const trackingBlock = safeTrackingUrl
        ? `<table border="0" cellpadding="0" cellspacing="0" style="margin:12px auto 0;border-collapse:collapse;"><tr><td style="background:#d4af37;border-radius:2px;padding:14px 32px;"><a href="${safeTrackingUrl}" style="font-family:Arial,sans-serif;font-size:12px;color:#000;text-decoration:none;letter-spacing:0.15em;text-transform:uppercase;font-weight:700;">&#128269;&nbsp;Sendung verfolgen</a></td></tr></table>`
        : '';

    return {
        subject: normalizedOrderNumber
            ? `Deine Bestellung ${normalizedOrderNumber} ist unterwegs! \u{1F4E6}`
            : 'Deine Bestellung ist unterwegs! \u{1F4E6}',
        html: renderBrandEmail({
            badge: 'Auf dem Weg zu dir',
            title: `Hallo ${safeOrderName}!`,
            introHtml: `Gute Neuigkeiten &ndash; deine Bestellung ist soeben auf dem Weg zu dir!<br><br>Du kannst deinen Duft in den naechsten <strong style="color:#000;">1&ndash;3 Werktagen</strong> erwarten.<br><br>Wir wuenschen dir viel Freude mit deinem neuen Extrait de Parfum.${orderNumberLine}`,
            iconHtml: '&#128230;',
            ctaHtml: `<table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
  <tr>
    <td style="background:#1a1a1a;border-radius:2px;padding:14px 32px;">
      <a href="https://note-fragrances.de" style="font-family:Arial,sans-serif;font-size:12px;color:#ffffff;text-decoration:none;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;">Zur Website</a>
    </td>
  </tr>
</table>
${trackingBlock}`
        })
    };
}

function buildPickupReadyEmailPayload({ orderNumber = '', customerName = 'du', amountCents = 0 }) {
    const safeCustomerName = escapeHtml(customerName || 'du');
    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const orderNumberLine = buildEmailOrderNumberLine(normalizedOrderNumber);
    return {
        subject: normalizedOrderNumber
            ? `Deine Bestellung ${normalizedOrderNumber} ist abholbereit! \u2713`
            : 'Dein Parfum ist abholbereit! \u2713',
        html: renderBrandEmail({
            badge: 'Abholbereit',
            title: `Hallo ${safeCustomerName}!`,
            introHtml: `Deine Bestellung ist nun fertig gepackt und liegt zur Abholung fuer dich bereit. Hier findest du uns:<br><span style="color:#333;">Warnitzer Str. 20, 13057 Berlin</span><br><br>Bitte bringe den Zahlbetrag von <strong style="color:#000; font-weight:700;">${formatEuroFromCents(amountCents)} &euro;</strong> moeglichst passend in Bar mit. Wir freuen uns auf deinen Besuch!${orderNumberLine}`,
            iconImageUrl: EMAIL_ICON_CHECK_IMAGE_URL
        })
    };
}

function buildNewsletterConfirmationEmailPayload({ confirmUrl }) {
    const safeConfirmUrl = sanitizeTrackingUrl(confirmUrl) || '#';
    return {
        subject: 'Bitte bestaetige deine Newsletter-Anmeldung',
        html: renderBrandEmail({
            badge: 'Ein letzter Schritt',
            title: 'Bestaetige deine Anmeldung',
            introHtml: 'Bitte bestaetige mit einem Klick deine Newsletter-Anmeldung. Erst danach senden wir dir deinen persoenlichen Rabattcode zu.',
            ctaHtml: `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
  <tr><td style="background:#1a1a1a;padding:14px 36px;">
    <a href="${safeConfirmUrl}" style="font-family:Arial,sans-serif;font-size:11px;color:#d4af37;text-decoration:none;letter-spacing:0.18em;text-transform:uppercase;">Anmeldung bestaetigen</a>
  </td></tr>
</table>`,
            afterBodyHtml: `<tr><td style="background:#f5f3ee;padding:0 48px 34px;text-align:center;">
  <p style="margin:0 auto;font-size:12px;color:#999;max-width:360px;line-height:1.7;">Falls du dich nicht selbst eingetragen hast, kannst du diese E-Mail einfach ignorieren.</p>
</td></tr>`
        })
    };
}

function buildNewsletterDiscountEmailPayload({ code, discount }) {
    const safeCode = escapeHtml(code || '');
    const safeDiscount = Number.isFinite(Number(discount)) ? Number(discount) : 0;
    return {
        subject: `Dein persoenlicher Rabattcode - ${safeDiscount}% auf deine erste Bestellung`,
        html: renderBrandEmail({
            badge: 'Willkommen',
            title: 'Schoen, dass du dabei bist!',
            introHtml: `Danke fuer deine Bestaetigung. Als Dankeschoen erhaeltst du exklusiv <strong style="color:#1a1a1a;">${safeDiscount}&nbsp;% Rabatt</strong> auf deine erste Bestellung.`,
            bodyHtml: `<tr><td style="background:#f5f3ee;padding:0 48px 0;text-align:center;">
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;">
    <tr><td style="background:#1a1a1a;padding:20px 40px;text-align:center;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.2em;color:#d4af37;text-transform:uppercase;">Dein persoenlicher Code</p>
      <p style="margin:0;font-family:Georgia,serif;font-size:28px;color:#ffffff;letter-spacing:0.2em;">${safeCode}</p>
    </td></tr>
  </table>
  <p style="margin:0 auto 26px;font-size:12px;color:#999;max-width:360px;line-height:1.7;">Gib diesen Code im Warenkorb unter "Gutscheincode" ein.<br>Gueltig fuer eine Bestellung &middot; Nicht kombinierbar mit anderen Aktionen.</p>
</td></tr>`,
            ctaHtml: `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr><td style="background:#1a1a1a;padding:14px 36px;">
    <a href="https://note-fragrances.de/suche" style="font-family:Arial,sans-serif;font-size:11px;color:#d4af37;text-decoration:none;letter-spacing:0.18em;text-transform:uppercase;">Zur Kollektion &rarr;</a>
  </td></tr>
</table>`
        })
    };
}

function buildContactConfirmationEmailPayload({ name, subjectText }) {
    const safeName = escapeHtml(name || 'Kunde');
    const safeSubject = escapeHtml(subjectText || 'deine Nachricht');
    return {
        subject: 'Wir haben Ihre Nachricht erhalten \u2713',
        html: renderBrandEmail({
            badge: 'Nachricht erhalten',
            title: `Danke, ${safeName}!`,
            introHtml: `Wir haben Ihre Nachricht zum Thema <strong style="color:#1a1a1a;">${safeSubject}</strong> erhalten und melden uns schnellstmoeglich bei Ihnen zurueck.`,
            iconHtml: '&#9993;'
        })
    };
}

function buildContactInternalEmailHtml({ name, email, subjectText, message, receivedAtText }) {
    const safeName = escapeHtml(name || '');
    const safeEmail = escapeHtml(email || '');
    const safeSubject = escapeHtml(subjectText || '');
    const safeMessage = escapeHtml(message || '');
    const safeDate = escapeHtml(receivedAtText || '');

    return `
                <div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;background:#f9f9f9;border-radius:8px;">
                    <h2 style="font-size:20px;margin-bottom:8px;color:#1a1a1a;">Neue Kontaktanfrage</h2>
                    <p style="color:#666;font-size:13px;margin-bottom:24px;border-bottom:1px solid #eee;padding-bottom:16px;">
                        Eingegangen am ${safeDate}
                    </p>
                    <table style="width:100%;font-size:14px;color:#333;">
                        <tr><td style="padding:6px 0;font-weight:600;width:100px;">Name</td><td>${safeName}</td></tr>
                        <tr><td style="padding:6px 0;font-weight:600;">E-Mail</td><td><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
                        <tr><td style="padding:6px 0;font-weight:600;">Betreff</td><td>${safeSubject}</td></tr>
                    </table>
                    <div style="margin-top:20px;padding:16px;background:#fff;border-radius:6px;border:1px solid #eee;">
                        <p style="margin:0;font-size:14px;line-height:1.7;color:#444;white-space:pre-wrap;">${safeMessage}</p>
                    </div>
                </div>
            `;
}

function buildPickupOrderInternalEmailPayload({
    orderNumber = '',
    customerName = '',
    customerEmail = '',
    items = [],
    totalAmountCents = 0,
    discountAmountCents = 0,
    couponCode = '',
    receivedAtText = ''
}) {
    const safeCustomerName = escapeHtml(customerName || 'Kunde');
    const safeCustomerEmail = escapeHtml(customerEmail || '');
    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const safeOrderNumber = escapeHtml(normalizedOrderNumber);
    const safeDate = escapeHtml(receivedAtText || '');
    const safeCouponCode = escapeHtml(couponCode || '');
    const listHtml = Array.isArray(items) && items.length
        ? items.map((item) => {
            const desc = escapeHtml(item.description || '');
            const supplierId = escapeHtml(item.supplierId || '');
            const descWithSupplier = supplierId
                ? `${desc} <span style="color:#b8860b;font-weight:700;">(${supplierId})</span>`
                : desc;
            const qty = Number(item.quantity) || 0;
            const amountText = Number.isFinite(Number(item.amount_total))
                ? `${formatEuroFromCents(item.amount_total)} €`
                : '0,00 €';
            return `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;color:#333;">${descWithSupplier}</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;color:#333;">${qty}</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#333;">${amountText}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="3" style="padding:10px 0;color:#888;">Keine Artikel.</td></tr>';

    const discountLine = Number(discountAmountCents) > 0
        ? `<tr><td style="padding:6px 0;color:#666;">Rabatt${safeCouponCode ? ` (${safeCouponCode})` : ''}</td><td></td><td style="padding:6px 0;text-align:right;color:#666;">-${formatEuroFromCents(discountAmountCents)} €</td></tr>`
        : '';

    const bodyHtml = `<tr><td style="background:#f5f3ee;padding:0 40px;"><div style="border-top:1px solid #dedad3;"></div></td></tr>
<tr><td style="background:#f5f3ee;padding:28px 40px 0;">
  <p style="margin:0 0 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#aaa;font-weight:600;">Bestelldetails (Intern)</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
    ${safeOrderNumber ? `<tr><td style="font-size:13px;color:#666;padding:0 0 6px;">Bestellnummer</td><td style="font-size:13px;color:#1a1a1a;text-align:right;font-weight:700;">${safeOrderNumber}</td></tr>` : ''}
    <tr><td style="font-size:13px;color:#666;padding:0 0 6px;">Kunde</td><td style="font-size:13px;color:#1a1a1a;text-align:right;">${safeCustomerName}</td></tr>
    <tr><td style="font-size:13px;color:#666;padding:0 0 6px;">E-Mail</td><td style="font-size:13px;color:#1a1a1a;text-align:right;"><a href="mailto:${safeCustomerEmail}" style="color:#1a1a1a;text-decoration:none;">${safeCustomerEmail}</a></td></tr>
    <tr><td style="font-size:13px;color:#666;padding:0 0 6px;">Bestelltyp</td><td style="font-size:13px;color:#1a1a1a;text-align:right;">Selbstabholung</td></tr>
    <tr><td style="font-size:13px;color:#666;">Eingang</td><td style="font-size:13px;color:#1a1a1a;text-align:right;">${safeDate}</td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e2da;border-radius:4px;padding:12px 14px;background:#fff;margin:0 0 14px;">
    <tr>
      <td style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.12em;padding-bottom:8px;">Produkt</td>
      <td style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.12em;padding-bottom:8px;text-align:center;">Menge</td>
      <td style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.12em;padding-bottom:8px;text-align:right;">Summe</td>
    </tr>
    ${listHtml}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
    ${discountLine}
  </table>
</td></tr>
<tr><td style="background:#f5f3ee;padding:16px 40px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #d4af37;padding-top:12px;margin-top:12px;"><tr>
    <td style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.15em;">Gesamtbetrag</td>
    <td style="text-align:right;font-family:Georgia,serif;font-size:26px;color:#1a1a1a;">${formatEuroFromCents(totalAmountCents)} €</td>
  </tr></table>
</td></tr>`;

    return {
        subject: normalizedOrderNumber
            ? `Neue Selbstabholung ${normalizedOrderNumber} (${safeCustomerName})`
            : `Neue Selbstabholung-Bestellung (${safeCustomerName})`,
        html: renderBrandEmail({
            badge: 'Interne Bestellung',
            title: 'Neue Selbstabholung',
            introHtml: 'Eine neue Selbstabholung-Bestellung wurde erfasst. Alle Details findest du unten.',
            iconHtml: '&#128230;',
            bodyHtml
        })
    };
}

function buildAdminEmailTemplatePreviews() {
    const sampleItems = [
        {
            description: 'No. L3 (50ml)',
            quantity: 2,
            amountText: '49,98',
            imageUrl: 'https://note-fragrances.de/logo.webp'
        }
    ];
    const sampleAddress = {
        line1: 'Dr.-Rosenthal-Weg 4',
        line2: '',
        postal_code: '77694',
        city: 'Kehl',
        country: 'DE'
    };
    const orderMail = buildOrderConfirmationEmailPayload({
        orderNumber: '#123',
        customerName: 'Max',
        items: sampleItems,
        shippingCostCents: 0,
        discountAmountCents: 0,
        couponCode: '',
        totalAmountCents: 7497,
        address: sampleAddress
    });
    const shippingMail = buildShippingEmailPayload({ orderNumber: '#123', customerName: 'Max', trackingUrl: '' });
    const pickupReadyMail = buildPickupReadyEmailPayload({ orderNumber: '#123', customerName: 'Max', amountCents: 8990 });
    const pickupOrderMail = buildPickupOrderConfirmationEmailPayload({
        orderNumber: '#123',
        customerName: 'Max',
        items: sampleItems,
        discountAmountCents: 0,
        couponCode: '',
        totalAmountCents: 7497
    });
    const newsletterConfirmMail = buildNewsletterConfirmationEmailPayload({ confirmUrl: 'https://note-fragrances.de/newsletter-confirmation.html' });
    const newsletterMail = buildNewsletterDiscountEmailPayload({ code: 'NOTE-M7K2X', discount: 5 });
    const contactConfirmMail = buildContactConfirmationEmailPayload({ name: 'Maria', subjectText: 'Frage zur Bestellung' });
    const pickupOrderInternalPreviewMail = buildPickupOrderInternalEmailPayload({
        orderNumber: '#123',
        customerName: 'Max Mustermann',
        customerEmail: 'max@beispiel.de',
        items: [
            { description: 'No. L3 (50ml) [BARZAHLUNG]', quantity: 2, amount_total: 4998, supplierId: 'W3' },
            { description: 'No. G12 (30ml) [BARZAHLUNG]', quantity: 1, amount_total: 1799, supplierId: 'M66' }
        ],
        totalAmountCents: 6797,
        discountAmountCents: 0,
        couponCode: '',
        receivedAtText: new Date().toLocaleString('de-DE')
    });

    return {
        order: {
            subject: orderMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde',
            html: orderMail.html
        },
        shipping: {
            subject: shippingMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde',
            html: shippingMail.html
        },
        pickup: {
            subject: pickupReadyMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde (Abholung)',
            html: pickupReadyMail.html
        },
        'pickup-order': {
            subject: pickupOrderMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde (Abhol-Kauf)',
            html: pickupOrderMail.html
        },
        'pickup-order-internal': {
            subject: pickupOrderInternalPreviewMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: info@note-fragrances.de',
            html: pickupOrderInternalPreviewMail.html
        },
        'newsletter-confirm': {
            subject: newsletterConfirmMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Abonnent',
            html: newsletterConfirmMail.html
        },
        newsletter: {
            subject: newsletterMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Abonnent',
            html: newsletterMail.html
        },
        'contact-confirm': {
            subject: contactConfirmMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Absender',
            html: contactConfirmMail.html
        },
        'contact-internal': {
            subject: 'Kontaktanfrage: Frage zur Bestellung',
            from: 'Von: N&Oslash;TE. Kontakt <noreply@note-fragrances.de>  \u2022  An: info@note-fragrances.de',
            html: `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:40px 20px;background:#f0f0f0;font-family:Arial,sans-serif;">
${buildContactInternalEmailHtml({
                name: 'Maria Mueller',
                email: 'maria@beispiel.de',
                subjectText: 'Frage zur Bestellung',
                message: 'Hallo, ich wuerde gerne wissen wann meine Bestellung ankommt. Vielen Dank!',
                receivedAtText: new Date().toLocaleString('de-DE')
            })}
</body></html>`
        }
    };
}




return { renderBrandEmail, formatEuroFromCents, formatAddressHtml, buildEmailItemsHtml, normalizeOrderNumber, buildEmailOrderNumberLine, buildOrderConfirmationEmailPayload, buildPickupOrderConfirmationEmailPayload, buildShippingEmailPayload, buildPickupReadyEmailPayload, buildNewsletterConfirmationEmailPayload, buildNewsletterDiscountEmailPayload, buildContactConfirmationEmailPayload, buildContactInternalEmailHtml, buildPickupOrderInternalEmailPayload, buildAdminEmailTemplatePreviews };
}
module.exports = { createEmailTemplates };
