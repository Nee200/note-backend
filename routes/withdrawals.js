const crypto = require('node:crypto');
const Withdrawal = require('../models/Withdrawal');
const MailJob = require('../models/MailJob');
const declaration = scope => scope === 'partial'
    ? 'Hiermit widerrufe ich den angegebenen Vertrag hinsichtlich der unten genannten Artikel.'
    : 'Hiermit widerrufe ich den angegebenen Vertrag vollständig.';
const fields = ['reference', 'name', 'email', 'contract', 'scope', 'items', 'declaration', 'receivedAt'];
const receipt = record => Object.fromEntries(fields.map(key => [key, record[key]]));
const key = (record, audience) => `withdrawal:${record._id}:${audience}`;
function validate(body, sanitizeEmail) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) ? value.trim() : null;
    const requestId = typeof body.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId) ? body.requestId.toLowerCase() : null;
    const name = text(body.name, 200), contract = text(body.contract, 1500);
    const email = sanitizeEmail(body.email);
    const scope = ['full', 'partial'].includes(body.scope) ? body.scope : null;
    const items = scope === 'partial' ? text(body.items, 2000) : '';
    if (!requestId || !name || !contract || !email || email.length > 254 || !scope || items === null) return null;
    return { requestId, name, email, contract, scope, items, declaration: declaration(scope) };
}
function registerWithdrawalRoutes(app, { resend, limiter, adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, sanitizeEmail, escapeHtml, renderBrandEmail, notificationEmail, isAdmin }) {
    function emailPayload(record, internal) {
        const timestamp = record.receivedAt.toISOString();
        const lines = [internal ? 'Neuer elektronischer Widerruf' : 'Eingangsbestätigung deines Widerrufs',
            `Referenz: ${record.reference}`, `Eingang (UTC): ${timestamp}`,
            `Eingang (Berlin): ${record.receivedAt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', timeZoneName: 'short' })}`,
            `Name: ${record.name}`, `E-Mail für die Eingangsbestätigung: ${record.email}`,
            `Vertrag / Bestellung: ${record.contract}`, `Umfang: ${record.scope === 'partial' ? 'Genannte Artikel' : 'Vollständiger Vertrag'}`,
            ...(record.items ? [`Artikel: ${record.items}`] : []), `Erklärung: ${record.declaration}`,
            internal ? 'Bitte im Admin-Bereich unter Widerrufe bearbeiten. Diese Mitteilung löst keine automatische Erstattung aus.' : 'Wir bestätigen den Eingang deiner Erklärung. Informationen zur Rücksendung findest du in unserer Widerrufsbelehrung: https://note-fragrances.de/widerrufsrecht.html',
            'NØTE. fragrances · Deniz Löbel · Warnitzer Str. 20 · 13057 Berlin · info@note-fragrances.de'];
        const text = lines.join('\n\n');
        return { from: 'NOTE. fragrances <info@note-fragrances.de>', to: internal ? notificationEmail : record.email,
            subject: `${internal ? 'Neuer Widerruf' : 'Eingangsbestätigung Widerruf'} ${record.reference}`,
            text, html: renderBrandEmail({ badge: 'Widerruf', title: internal ? 'Neuer Widerruf eingegangen' : 'Dein Widerruf ist eingegangen', introHtml: lines.slice(1).map(line => `<p style="white-space:pre-wrap;overflow-wrap:anywhere;text-align:left">${escapeHtml(line)}</p>`).join('') }) };
    }
    async function enqueue(record) {
        // A durable flag repairs a crash between storing the declaration and
        // creating both outbox jobs. Unique mail keys make retries safe.
        await resend.enqueue(key(record, 'customer'), emailPayload(record, false));
        await resend.enqueue(key(record, 'operator'), emailPayload(record, true));
        await Withdrawal.updateOne({ _id: record._id }, { $set: { mailQueued: true } });
    }
    async function mailStatus(records) {
        const jobs = await MailJob.find({ key: { $in: records.flatMap(record => [key(record, 'customer'), key(record, 'operator')]) } }).select('key status').lean();
        const map = new Map(jobs.map(job => [job.key, job.status]));
        return record => ({ customer: map.get(key(record, 'customer')) || 'not_queued', operator: map.get(key(record, 'operator')) || 'not_queued' });
    }
    app.post('/api/withdrawals', limiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
        const data = validate(req.body, sanitizeEmail);
        if (!data) return res.status(400).json({ error: 'Bitte Name, gültige E-Mail-Adresse, Vertrag und gegebenenfalls Artikel vollständig angeben.' });
        const { requestId, ...payload } = data;
        const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        let record, created = false;
        try {
            record = await Withdrawal.create({ requestId, payloadHash, ...payload, reference: 'WR-' + crypto.randomBytes(12).toString('hex').toUpperCase(), receivedAt: new Date() });
            created = true;
        } catch (error) {
            if (error.code !== 11000) throw error;
            record = await Withdrawal.findOne({ requestId }).select('+payloadHash');
            if (!record || record.payloadHash !== payloadHash) return res.status(409).json({ error: 'Diese Übermittlung wurde bereits mit anderen Angaben verwendet. Bitte beginne für eine neue Erklärung erneut.' });
        }
        // An e-mail outage must never erase or reject an already received declaration.
        // The outbox retries; the customer can also download the receipt immediately.
        let timer;
        await Promise.race([
            (async () => {
                if (!record.mailQueued) await enqueue(record);
                await Promise.allSettled(['customer', 'operator'].map(audience => resend.deliver(key(record, audience))));
            })().catch(() => {}),
            new Promise(resolve => { timer = setTimeout(resolve, 5000); timer.unref(); })
        ]).finally(() => clearTimeout(timer));
        const status = (await mailStatus([record]))(record);
        res.status(created ? 201 : 200).json({ success: true, receipt: receipt(record), emailStatus: ['accepted', 'simulated'].includes(status.customer) ? 'accepted' : 'pending' });
    });
    app.get('/api/admin/withdrawals', async (req, res) => {
        if (!isAdmin(req)) return res.status(401).json({ error: 'Bitte anmelden.' });
        const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
        const records = await Withdrawal.find().sort({ receivedAt: -1, _id: -1 }).skip((page - 1) * 25).limit(26).lean();
        const status = await mailStatus(records);
        res.json({ withdrawals: records.slice(0, 25).map(record => ({ ...receipt(record), _id: record._id, status: record.status, mailStatus: status(record) })), page, hasMore: records.length > 25 });
    });
    app.post('/api/admin/withdrawals/:id/status', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
        if (!isAdmin(req)) return res.status(401).json({ error: 'Bitte anmelden.' });
        if (!/^[a-f0-9]{24}$/i.test(req.params.id) || !['received', 'processing', 'completed'].includes(req.body.status)) return res.status(400).json({ error: 'Ungültiger Widerruf oder Status.' });
        const now = new Date();
        // After completion keep evidence for three full calendar years;
        // reopening removes automatic deletion while the case is unresolved.
        const changes = { $set: { status: req.body.status, statusChangedAt: now } };
        if (req.body.status === 'completed') changes.$set.purgeAt = new Date(Date.UTC(now.getUTCFullYear() + 4, 0, 1));
        else changes.$unset = { purgeAt: 1 };
        const record = await Withdrawal.findByIdAndUpdate(req.params.id, changes, { returnDocument: 'after' });
        if (!record) return res.status(404).json({ error: 'Widerruf nicht gefunden.' });
        res.json({ success: true, status: record.status });
    });
    return { async processPending() {
        const records = await Withdrawal.find({ mailQueued: false }).sort({ receivedAt: 1 }).limit(20);
        for (const record of records) { try { await enqueue(record); } catch { /* the durable flag remains */ } }
    } };
}
module.exports = { registerWithdrawalRoutes };
