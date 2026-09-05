const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { verify } = require('otplib');
const AdminState = require('../models/AdminState');
function createAdminAuthenticator(env) {
    const accounts = env.ADMIN_ACCOUNTS_JSON ? JSON.parse(env.ADMIN_ACCOUNTS_JSON) : [{ username: env.ADMIN_USERNAME || 'owner', password: env.ADMIN_PASSWORD, totpSecret: env.ADMIN_TOTP_SECRET }];
    if (!Array.isArray(accounts) || !accounts.length || accounts.length > 20) throw new Error('Admin-Konfiguration ungültig.');
    const names = new Set();
    for (const account of accounts) {
        if (!/^[a-zA-Z0-9._-]{3,64}$/.test(account.username) || names.has(account.username)) throw new Error('Admin-Namen müssen eindeutig und gültig sein.');
        names.add(account.username);
        if (!account.passwordHash && !String(account.password || '').trim()) throw new Error('Admin-Passwort fehlt.');
        if (account.passwordHash && !/^\$2[aby]\$(1[0-5])\$[./A-Za-z0-9]{53}$/.test(account.passwordHash)) throw new Error('Admin-Passworthash muss ein gültiger bcrypt-Hash mit Kostenfaktor 10 bis 15 sein.');
        if (env.NODE_ENV === 'production' && (!/^[A-Z2-7]{32,}$/.test(account.totpSecret || '') || (!account.passwordHash && String(account.password || '').length < 16))) throw new Error('Produktive Admin-Konten benötigen ein starkes Passwort und einen eingerichteten TOTP-Faktor.');
    }
    async function authenticate({ username, password, otp }) {
        const name = username || (env.NODE_ENV === 'production' ? '' : 'owner');
        const account = accounts.find(item => item.username === name);
        if (!account || typeof password !== 'string' || Buffer.byteLength(password) > 256) return null;
        const matches = account.passwordHash ? await bcrypt.compare(password, account.passwordHash) : crypto.timingSafeEqual(crypto.createHash('sha256').update(password).digest(), crypto.createHash('sha256').update(String(account.password || '')).digest());
        if (!matches) return null;
        if (account.totpSecret) {
            if (!/^\d{6}$/.test(String(otp || ''))) return null;
            const result = await verify({ secret: account.totpSecret, token: String(otp), epochTolerance: [30, 0] });
            if (!result.valid) return null;
            try { await AdminState.updateOne({ username: name }, { $setOnInsert: { lastTimeStep: -1 } }, { upsert: true }); } catch (error) { if (error.code !== 11000) throw error; }
            const accepted = await AdminState.updateOne({ username: name, lastTimeStep: { $lt: result.timeStep } }, { $set: { lastTimeStep: result.timeStep } });
            if (!accepted.modifiedCount) return null;
        }
        return name;
    }
    const fingerprint = name => { const account = accounts.find(item => item.username === name); return account ? crypto.createHash('sha256').update(JSON.stringify([account.passwordHash || account.password, account.totpSecret || ''])).digest('hex') : ''; };
    return { authenticate, fingerprint, hasAccount: name => names.has(name), mfaRequired: env.NODE_ENV === 'production' || accounts.some(account => !!account.totpSecret) };
}
module.exports = { createAdminAuthenticator };
