const crypto = require('node:crypto');
const { createSources } = require('./securitySources');
const SecurityStatus = require('../models/SecurityStatus');
const DAY = 24 * 60 * 60 * 1000;
const SOURCES = [
    ['backend-npm', 'Backend · npm-Advisories'], ['backend-osv', 'Backend · OSV-Advisories'], ['backend-updates', 'Backend · Paketupdates'],
    ['frontend-npm', 'Frontend · npm-Advisories'], ['frontend-osv', 'Frontend · OSV-Advisories'], ['frontend-updates', 'Frontend · Paketupdates'],
    ['node-backend', 'Node · laufendes Backend'], ['node-frontend', 'Node · veröffentlichter Frontend-Build'], ['node-cves', 'Node · NVD-CVEs'],
    ['mongodb-version', 'MongoDB · installierte Version'], ['mongodb-cves', 'MongoDB · NVD-CVEs'], ['mongodb-access', 'MongoDB · Rechte des Shop-Zugangs'],
    ['cloudflare-edge', 'Cloudflare · HTTPS und Header'], ['render-edge', 'Render · HTTPS und Header'],
    ['github-backend', 'GitHub · Backend-Code, Pakete und Secrets'], ['github-frontend', 'GitHub · Frontend-Code, Pakete und Secrets'],
    ['cloudflare-config', 'Cloudflare · Konto und Konfiguration'], ['render-config', 'Render · Konto und Konfiguration'], ['mongodb-config', 'MongoDB · Rechte, Netzwerk und Backups']
];

function publicSource(key, label, row, now = Date.now()) {
    const checkedAt = row?.checkedAt || null;
    const isStale = !checkedAt || now - new Date(checkedAt).getTime() > DAY * 1.5;
    const data = row?.data || {};
    return { key, label, checkedAt, attemptedAt: row?.attemptedAt || null, isStale, error: row?.error || '',
        status: row?.error ? 'error' : !checkedAt ? 'missing' : isStale ? 'stale' : data.gaps?.length ? 'partial' : data.findings?.length ? 'finding' : data.updates?.length ? 'update' : 'checked',
        ...Object.fromEntries(['target', 'summary', 'findings', 'updates', 'checks', 'links', 'gaps'].map(name => [name, data[name] ?? (['target', 'summary'].includes(name) ? '' : [])])),
        history: row?.history || [] };
}

async function saveSource(key, run, { model = SecurityStatus, now = () => new Date() } = {}) {
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(key)) throw Error('Ungültige Prüfquelle.');
    const at = now();
    try {
        const data = await run();
        await model.updateOne({ key }, { $set: { data, checkedAt: at, attemptedAt: at, error: '' }, $push: { history: { $each: [{ at, ok: true, findings: data.findings?.length || 0, updates: data.updates?.length || 0 }], $slice: -30 } } }, { upsert: true });
        return true;
    } catch (error) {
        // Keep the last successful findings and their date. An outage cannot clear a vulnerability.
        await model.updateOne({ key }, { $set: { attemptedAt: at, error: 'Prüfung fehlgeschlagen. Letztes erfolgreiches Ergebnis bleibt erhalten.' }, $push: { history: { $each: [{ at, ok: false }], $slice: -30 } } }, { upsert: true });
        return false;
    }
}

function createSecurityMonitor({ env, database, model = SecurityStatus, sources = createSources, now = () => new Date() }) {
    let active;
    const revision = env.RENDER_GIT_COMMIT || 'local';
    const enabled = env.NODE_ENV === 'production' && env.LOCAL_DEV_SAFE_MODE !== 'true';
    async function init() {
        try { await model.updateOne({ key: 'scheduler' }, { $setOnInsert: { nextRunAt: new Date(0), lockedUntil: new Date(0) } }, { upsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; }
    }
    async function status() {
        const rows = await model.find({ key: { $in: [...SOURCES.map(([key]) => key), 'scheduler'] } }).lean();
        const state = rows.find(row => row.key === 'scheduler');
        return { enabled, intervalHours: 24, staleAfterHours: 36, running: !!state?.lockedUntil && new Date(state.lockedUntil) > now(), queued: !!state?.nextRunAt && new Date(state.nextRunAt) <= now(), nextRunAt: state?.nextRunAt || null, completedAt: state?.completedAt || null,
            scope: 'Bekannte Schwachstellen, Updates und nachvollziehbare Kontrollen. Ungeprüfte Bereiche und Quellfehler bleiben sichtbar; dies ist keine Sicherheitszertifizierung.',
            sources: SOURCES.map(([key, label]) => publicSource(key, label, rows.find(row => row.key === key), now().getTime())) };
    }
    async function request() {
        if (!enabled) return { accepted: false, reason: 'disabled' };
        await init();
        const at = now();
        const row = await model.findOneAndUpdate({ key: 'scheduler', lockedUntil: { $lte: at }, $or: [{ requestedAt: { $exists: false } }, { requestedAt: { $lte: new Date(at - 15 * 60000) } }] }, { $set: { requestedAt: at, nextRunAt: at } }, { returnDocument: 'after' }).lean();
        return { accepted: !!row, reason: row ? 'queued' : 'busy-or-cooldown' };
    }
    async function tick() {
        if (!enabled || active) return;
        active = (async () => {
            await init();
            const at = now(), owner = crypto.randomUUID();
            const lease = await model.findOneAndUpdate({ key: 'scheduler', lockedUntil: { $lte: at }, $or: [{ nextRunAt: { $lte: at } }, { revision: { $ne: revision } }] }, { $set: { owner, lockedUntil: new Date(at.getTime() + 15 * 60000), revision, nextRunAt: new Date(at.getTime() + DAY) } }, { returnDocument: 'after' }).lean();
            if (!lease) return;
            try {
                const jobs = sources({ env, database });
                for (const [key, run] of jobs) {
                    const held = await model.exists({ key: 'scheduler', owner, lockedUntil: { $gt: now() } });
                    if (!held) break;
                    await saveSource(key, run, { model, now });
                }
                await model.updateOne({ key: 'scheduler', owner }, { $set: { completedAt: now() } });
            } finally {
                await model.updateOne({ key: 'scheduler', owner }, { $set: { lockedUntil: new Date(0) }, $unset: { owner: 1 } });
            }
        })().finally(() => { active = null; });
        return active;
    }
    return { status, request, tick, wait: () => active || Promise.resolve() };
}
module.exports = { SOURCES, publicSource, saveSource, createSecurityMonitor };
