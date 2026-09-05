const crypto = require('node:crypto');
const Subscriber = require('../models/Subscriber');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const CONSENT_VERSION = 'newsletter-doi-2026-09-05';
function registerNewsletterRoutes(app, deps) {
    const { env, resend, newsletterLimiter, requireTrustedOrigin, requireCsrfToken, sanitizeEmail, escapeHtml, frontendUrl, backendUrl, buildNewsletterConfirmationEmailPayload, buildNewsletterDiscountEmailPayload, safeMode } = deps;
    const secret = env.NEWSLETTER_UNSUBSCRIBE_SECRET || env.JWT_SECRET;
    const signature = id => crypto.createHmac('sha256', secret).update('unsubscribe:' + id).digest('hex');
    const unsubscribeUrl = subscriber => `${backendUrl}/api/newsletter/unsubscribe?token=${subscriber._id}.${signature(String(subscriber._id))}`;
    function unsubscribeId(token) {
        const match = String(token || '').match(/^([a-f0-9]{24})\.([a-f0-9]{64})$/);
        if (!match || !crypto.timingSafeEqual(Buffer.from(signature(match[1])), Buffer.from(match[2]))) return null;
        return match[1];
    }
    async function code() {
        for (let i = 0; i < 10; i++) {
            const value = 'NOTE-' + crypto.randomBytes(8).toString('hex').toUpperCase();
            if (!await Subscriber.exists({ code: value })) return value;
        }
        throw new Error('Gutscheincode konnte nicht erstellt werden.');
    }
    async function discountMail(subscriber) {
        if (!subscriber.code) { subscriber.code = await code(); await subscriber.save(); }
        const link = unsubscribeUrl(subscriber);
        const mail = buildNewsletterDiscountEmailPayload({ code: subscriber.code, discount: subscriber.discount });
        const footer = `<p style="text-align:center;font-size:12px"><a href="${escapeHtml(link)}">Newsletter abbestellen</a></p>`;
        const html = mail.html.includes('</body>') ? mail.html.replace('</body>', footer + '</body>') : mail.html + footer;
        await resend.enqueue(`newsletter-discount:${subscriber._id}:${subscriber.confirmedAt.toISOString()}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to: subscriber.email, subject: mail.subject, html, headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }, { subscriberId: subscriber._id, consentAt: subscriber.confirmedAt });
        await Subscriber.updateOne({ _id: subscriber._id, confirmedAt: subscriber.confirmedAt }, { $set: { pendingDiscountMail: false } });
    }
    app.post('/api/newsletter', newsletterLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
        const email = sanitizeEmail(req.body.email);
        if (!email || email.length > 254) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
        let subscriber = await Subscriber.findOne({ email });
        if (subscriber?.status === 'active' && subscriber.confirmedAt) {
            await discountMail(subscriber);
            return res.json({ success: true, message: 'Bitte prüfe dein E-Mail-Postfach.' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        if (!subscriber) subscriber = new Subscriber({ email, code: await code() });
        subscriber.status = 'pending'; subscriber.confirmTokenHash = hash(token); subscriber.confirmToken = undefined;
        subscriber.confirmTokenExpiresAt = new Date(Date.now() + 86400000);
        subscriber.subscribedAt = new Date(); subscriber.consentVersion = CONSENT_VERSION; subscriber.consentMethod = 'double_opt_in';
        // Keep suppression history and coupon redemption; rejoining never creates
        // a second welcome discount for an already redeemed address.
        subscriber.purgeAt = subscriber.unsubscribedAt ? undefined : new Date(Date.now() + 30 * 86400000);
        await subscriber.save();
        const link = `${backendUrl}/api/newsletter/confirm?token=${token}`;
        const mail = buildNewsletterConfirmationEmailPayload({ confirmUrl: link });
        await resend.enqueue(`newsletter-confirm:${subscriber._id}:${hash(token)}`, { from: 'NOTE. fragrances <info@note-fragrances.de>', to: email, subject: mail.subject, html: mail.html });
        res.json({ success: true, requiresConfirmation: true, message: 'Bitte bestätige deine Anmeldung über die E-Mail.', ...(safeMode ? { safeMode: true, confirmUrl: link } : {}) });
    });
    app.get('/api/newsletter/confirm', async (req, res) => {
        const token = String(req.query.token || '');
        const redirect = status => res.redirect(`${frontendUrl}/newsletter-confirmation.html?status=${status}`);
        if (!/^[a-f0-9]{48,64}$/.test(token)) return redirect('invalid');
        const subscriber = await Subscriber.findOneAndUpdate({ status: 'pending', confirmTokenExpiresAt: { $gt: new Date() }, $or: [{ confirmTokenHash: hash(token) }, { confirmToken: token }] }, { $set: { status: 'active', confirmedAt: new Date(), consentVersion: CONSENT_VERSION, consentMethod: 'double_opt_in', pendingDiscountMail: true }, $unset: { confirmTokenHash: 1, confirmToken: 1, confirmTokenExpiresAt: 1, purgeAt: 1 } }, { returnDocument: 'after' });
        if (!subscriber) return redirect('invalid');
        if (!subscriber.code) { subscriber.code = await code(); await subscriber.save(); }
        await discountMail(subscriber);
        if (safeMode) return res.redirect(`${frontendUrl}/newsletter-confirmation.html?status=success&code=${encodeURIComponent(subscriber.code)}`);
        return redirect('success');
    });
    app.get('/api/newsletter/unsubscribe', (req, res) => {
        const token = String(req.query.token || '');
        if (!unsubscribeId(token)) return res.status(400).send('Dieser Abmeldelink ist ungültig.');
        res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter abbestellen</title></head><body><main><h1>Newsletter abbestellen</h1><p>Du erhältst danach keine Newsletter mehr. Bestellinformationen bleiben davon unabhängig.</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Newsletter abbestellen</button></form></main></body></html>`);
    });
    // The signed capability token authorizes this action. It also supports the
    // provider's RFC 8058 one-click POST, which has no browser session/CSRF cookie.
    app.post('/api/newsletter/unsubscribe', newsletterLimiter, async (req, res) => {
        const id = unsubscribeId(req.body.token || req.query.token);
        if (!id) return res.status(400).send('Dieser Abmeldelink ist ungültig.');
        await Subscriber.updateOne({ _id: id }, { $set: { status: 'unsubscribed', unsubscribedAt: new Date() }, $unset: { confirmTokenHash: 1, confirmToken: 1, confirmTokenExpiresAt: 1, purgeAt: 1 } });
        res.set('Cache-Control', 'no-store');
        if (req.is('application/json')) return res.json({ success: true });
        res.type('html').send('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abgemeldet</title><h1>Du bist vom Newsletter abgemeldet.</h1><p>Du kannst dich jederzeit erneut mit einer Bestätigung per E-Mail anmelden.</p></html>');
    });
    return { async processPending() {
        const subscribers = await Subscriber.find({ status: 'active', pendingDiscountMail: true }).limit(20);
        for (const subscriber of subscribers) { try { await discountMail(subscriber); } catch { /* durable flag remains */ } }
    } };
}
module.exports = { registerNewsletterRoutes };
