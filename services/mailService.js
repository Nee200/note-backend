const crypto = require('node:crypto');
const MailJob = require('../models/MailJob');

function createMailService({ env, provider, model = MailJob }) {
    const safe = env.LOCAL_DEV_SAFE_MODE === 'true' || env.NODE_ENV === 'test';
    const client = provider || (safe ? null : new (require('resend').Resend)(env.RESEND_API_KEY));

    async function enqueue(key, payload, audience = {}) {
        if (!key || key.length > 200) throw new Error('Ungültiger Mailauftrag.');
        try {
            return await model.findOneAndUpdate({ key }, { $setOnInsert: { payload, status: 'pending', nextAttemptAt: new Date(), newsletterSubscriberId: audience.subscriberId, consentAt: audience.consentAt } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
        } catch (error) {
            if (error.code !== 11000) throw error;
            return model.findOne({ key });
        }
    }

    async function deliver(key) {
        const now = new Date();
        const job = await model.findOneAndUpdate({ key, status: { $in: ['pending', 'sending'] }, nextAttemptAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, { $set: { status: 'sending', lockedUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: 'after' }).select('+payload');
        if (!job) return model.findOne({ key });
        if (job.newsletterSubscriberId) {
            const active = await require('../models/Subscriber').exists({ _id: job.newsletterSubscriberId, status: 'active', confirmedAt: job.consentAt });
            if (!active) {
                await model.updateOne({ _id: job._id }, { $set: { status: 'suppressed', lockedUntil: null, expiresAt: new Date(Date.now() + 86400000) }, $unset: { payload: 1 } });
                return { status: 'suppressed' };
            }
        }
        // Resend deduplicates for 24h. Past that boundary require an explicit
        // provider reconciliation instead of risking an automatic duplicate.
        if (job.attempts > 1 && Date.now() - job.createdAt.getTime() > 23 * 3600000) {
            await model.updateOne({ _id: job._id }, { $set: { status: 'manual_review', lockedUntil: null, lastError: 'Idempotenzfenster abgelaufen; Providerstatus prüfen.' } });
            throw new Error('Mailauftrag benötigt eine manuelle Providerprüfung.');
        }
        try {
            const result = client ? await client.emails.send(job.payload, { idempotencyKey: crypto.createHash('sha256').update(key).digest('hex') }) : { data: { id: 'simulated' } };
            if (result?.error || !result?.data?.id) throw new Error(String(result?.error?.name || 'Provider hat Mail nicht angenommen.'));
            await model.updateOne({ _id: job._id }, { $set: { status: client ? 'accepted' : 'simulated', providerId: result.data.id, acceptedAt: new Date(), lockedUntil: null, lastError: '', expiresAt: new Date(Date.now() + 90 * 86400000) } });
            return { data: result.data, simulated: !client };
        } catch (error) {
            const delay = Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7));
            await model.updateOne({ _id: job._id }, { $set: { status: 'pending', lockedUntil: null, nextAttemptAt: new Date(Date.now() + delay), lastError: String(error.message).slice(0, 200) } });
            throw error;
        }
    }

    async function send(payload, options = {}) {
        const key = options.idempotencyKey || `message:${crypto.randomUUID()}`;
        await enqueue(key, payload);
        const result = await deliver(key);
        if (!result?.data?.id && !['accepted', 'simulated'].includes(result?.status)) throw new Error('E-Mail ist noch nicht angenommen.');
        return result;
    }

    async function processPending() {
        await model.updateMany({ status: { $in: ['accepted', 'simulated', 'suppressed'] }, expiresAt: { $lte: new Date() }, payload: { $exists: true } }, { $unset: { payload: 1 } });
        const jobs = await model.find({ status: { $in: ['pending', 'sending'] }, nextAttemptAt: { $lte: new Date() }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] }).sort({ nextAttemptAt: 1 }).limit(20).select('key');
        for (const job of jobs) { try { await deliver(job.key); } catch { /* persisted for retry/monitoring */ } }
    }
    return { emails: { send }, enqueue, deliver, processPending };
}
module.exports = { createMailService };
