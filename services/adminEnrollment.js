const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { generateSecret, generateURI, verify } = require('otplib');
const QRCode = require('qrcode');
const Account = require('../models/AdminAccount');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const privateFields = '+invitationHash +setupHash +passwordHash +totpEncrypted';
const SETUP_SECONDS = 1800;

function createAdminEnrollment({ secret, reserved = () => false }) {
    const key = crypto.hkdfSync('sha256', secret, 'note-admin-enrollment', 'totp-at-rest-v1', 32);
    function encrypt(value, username) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(username));
        const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
    }
    function decrypt(value, username) {
        const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
        const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(username)); cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    }
    const validName = name => typeof name === 'string' && /^[a-zA-Z0-9._-]{3,64}$/.test(name);
    async function invite(username, actor, renew = false) {
        if (!validName(username) || reserved(username)) fail('Dieser Benutzername ist nicht verfügbar.');
        const password = crypto.randomBytes(18).toString('base64url');
        const invitationExpiresAt = new Date(Date.now() + 48 * 3600000);
        const fields = { invitationHash: await bcrypt.hash(password, 12), invitationExpiresAt, status: 'invited', setupAttempts: 0 };
        if (renew) {
            const result = await Account.updateOne({ username, status: { $ne: 'active' } }, {
                $set: fields, $unset: { setupHash: 1, setupExpiresAt: 1, passwordHash: 1, totpEncrypted: 1 }
            });
            if (!result.modifiedCount) fail('Nur noch nicht aktivierte Einladungen können erneuert werden.', 409);
        } else {
            try { await Account.create({ username, ...fields, createdBy: actor }); }
            catch (error) { if (error.code === 11000) fail('Dieser Benutzername ist bereits vergeben.', 409); throw error; }
        }
        return { username, oneTimePassword: password, expiresAt: invitationExpiresAt };
    }
    async function begin(username, password) {
        if (!validName(username) || reserved(username) || typeof password !== 'string' || Buffer.byteLength(password) > 72) return null;
        const account = await Account.findOne({ username, status: 'invited', invitationExpiresAt: { $gt: new Date() } }).select(privateFields);
        if (!account || !await bcrypt.compare(password, account.invitationHash)) return null;
        const token = crypto.randomBytes(32).toString('base64url');
        const accepted = await Account.updateOne({ _id: account._id, status: 'invited', invitationHash: account.invitationHash, invitationExpiresAt: { $gt: new Date() } }, {
            $set: { status: 'password', setupHash: hash(token), setupExpiresAt: new Date(Date.now() + SETUP_SECONDS * 1000), setupAttempts: 0 }
        });
        return accepted.modifiedCount ? token : null;
    }
    function setupQuery(token) {
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('Die Einrichtung ist abgelaufen. Bitte eine neue Einladung anfordern.', 401);
        return { setupHash: hash(token), setupExpiresAt: { $gt: new Date() }, status: { $in: ['password', 'mfa'] } };
    }
    async function setup(token) {
        const account = await Account.findOne(setupQuery(token)).select(privateFields);
        if (!account) fail('Die Einrichtung ist abgelaufen. Bitte eine neue Einladung anfordern.', 401);
        return account;
    }
    async function status(token) {
        const account = await setup(token);
        const data = { username: account.username, step: account.status, expiresAt: account.setupExpiresAt };
        if (account.status === 'mfa') {
            data.secret = decrypt(account.totpEncrypted, account.username);
            data.uri = generateURI({ issuer: 'NOTE Fragrances', label: account.username, secret: data.secret });
            data.qr = await QRCode.toDataURL(data.uri, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
        }
        return data;
    }
    async function setPassword(token, password) {
        if (typeof password !== 'string' || password.length < 16 || Buffer.byteLength(password) > 72) fail('Bitte ein Passwort mit mindestens 16 Zeichen und höchstens 72 Bytes wählen.');
        const account = await setup(token);
        if (account.status !== 'password') fail('Das neue Passwort wurde bereits festgelegt.', 409);
        if (await bcrypt.compare(password, account.invitationHash)) fail('Das neue Passwort muss sich vom Einmalpasswort unterscheiden.');
        const result = await Account.updateOne({ ...setupQuery(token), status: 'password' }, {
            $set: { status: 'mfa', passwordHash: await bcrypt.hash(password, 12), totpEncrypted: encrypt(generateSecret(), account.username) },
            $unset: { invitationHash: 1, invitationExpiresAt: 1 }
        });
        if (!result.modifiedCount) fail('Die Einrichtung ist abgelaufen oder wurde bereits fortgesetzt.', 409);
        return status(token);
    }
    async function confirm(token, otp) {
        // Bound guesses across IPs/restarts as well as applying the route rate limit.
        const account = await Account.findOneAndUpdate({ ...setupQuery(token), status: 'mfa', setupAttempts: { $lt: 10 } }, { $inc: { setupAttempts: 1 } }, { returnDocument: 'after' }).select(privateFields);
        if (!account) fail('Einrichtung abgelaufen oder zu viele Versuche. Bitte eine neue Einladung anfordern.', 401);
        if (!/^\d{6}$/.test(String(otp || ''))) fail('Bitte den sechsstelligen Authenticator-Code eingeben.');
        const checked = await verify({ secret: decrypt(account.totpEncrypted, account.username), token: String(otp), epochTolerance: [30, 0] });
        if (!checked.valid) fail('Der Authenticator-Code ist ungültig. Bitte den aktuellen Code verwenden.');
        const result = await Account.updateOne({ ...setupQuery(token), status: 'mfa', totpEncrypted: account.totpEncrypted }, {
            $set: { status: 'active', lastTimeStep: checked.timeStep, credentialVersion: crypto.randomBytes(24).toString('hex'), activatedAt: new Date() },
            $unset: { setupHash: 1, setupExpiresAt: 1, setupAttempts: 1, invitationHash: 1, invitationExpiresAt: 1 }
        });
        if (!result.modifiedCount) fail('Die Einrichtung wurde bereits abgeschlossen oder erneuert.', 409);
        return account.username;
    }
    async function authenticate(username, password, otp) {
        if (!validName(username) || reserved(username) || typeof password !== 'string' || Buffer.byteLength(password) > 72 || !/^\d{6}$/.test(String(otp || ''))) return null;
        const account = await Account.findOne({ username, status: 'active' }).select(privateFields);
        if (!account || !await bcrypt.compare(password, account.passwordHash)) return null;
        const checked = await verify({ secret: decrypt(account.totpEncrypted, username), token: String(otp), epochTolerance: [30, 0] });
        if (!checked.valid) return null;
        const accepted = await Account.updateOne({ _id: account._id, status: 'active', credentialVersion: account.credentialVersion, lastTimeStep: { $lt: checked.timeStep } }, { $set: { lastTimeStep: checked.timeStep } });
        return accepted.modifiedCount ? username : null;
    }
    async function fingerprint(username) {
        return (await Account.findOne({ username, status: 'active' }).select('credentialVersion').lean())?.credentialVersion || '';
    }
    const list = () => Account.find().select('username status invitationExpiresAt setupExpiresAt activatedAt createdAt').sort({ createdAt: -1 }).lean();
    const cancel = token => Account.updateOne(setupQuery(token), { $unset: { setupHash: 1, setupExpiresAt: 1 } });
    return { invite, begin, status, setPassword, confirm, authenticate, fingerprint, list, cancel, setupSeconds: SETUP_SECONDS };
}
module.exports = { createAdminEnrollment };
