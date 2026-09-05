const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const Session = require('../models/Session');
const { publicOrder } = require('../services/orderData');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 72) fail('Das Passwort muss mindestens 12 Zeichen lang sein und darf 72 Bytes nicht überschreiten.');
}

function registerAuthRoutes(app, deps) {
    const { User, Order, authLimiter, requireTrustedOrigin, requireCsrfToken, sanitizeEmail, sanitizeText, escapeHtml, sessionService, resend, frontendUrl, getUserCookieOptions } = deps;
    const write = [requireTrustedOrigin, requireCsrfToken];
    async function current(req, verified = false) {
        if (!req.userSession?.userId) fail('Bitte melde dich an.', 401);
        const user = await User.findOne({ id: req.userSession.userId });
        if (!user) fail('Bitte melde dich erneut an.', 401);
        if (verified && !user.emailVerifiedAt) fail('Bitte bestätige zuerst deine E-Mail-Adresse.', 403);
        return user;
    }
    const userDto = user => ({ name: user.name, email: user.email, emailVerified: !!user.emailVerifiedAt, firstName: user.firstName || '', lastName: user.lastName || '', addresses: user.addresses || [] });
    async function login(res, user) {
        const token = await sessionService.issue({ userId: user.id, email: user.email, version: user.sessionVersion || 0 }, 86400);
        res.cookie('auth_token', token, getUserCookieOptions());
    }
    async function verification(user) {
        const token = crypto.randomBytes(32).toString('hex');
        user.emailVerificationHash = hash(token);
        user.emailVerificationExpiresAt = new Date(Date.now() + 86400000);
        await user.save();
        const link = new URL(`account.html#verify=${token}`, frontendUrl).toString();
        await resend.enqueue(`verify:${user.id}:${hash(token)}`, { from: 'NØTE. <info@note-fragrances.de>', to: user.email, subject: 'Bestätige deine E-Mail-Adresse', html: `<p>Bitte melde dich in deinem NØTE.-Konto an und bestätige danach deine E-Mail-Adresse.</p><p><a href="${escapeHtml(link)}">E-Mail-Adresse bestätigen</a></p><p>Der Link gilt 24 Stunden. Wenn du kein Konto angelegt hast, musst du nichts tun.</p>` });
    }

    app.post('/api/register', authLimiter, ...write, async (req, res) => {
        const email = sanitizeEmail(req.body.email);
        if (!email || email.length > 254) fail('Bitte gib eine gültige E-Mail-Adresse ein.');
        validatePassword(req.body.password);
        if (await User.exists({ email })) fail('Ein Konto mit dieser Adresse existiert bereits. Bitte anmelden oder Passwort zurücksetzen.');
        const user = await User.create({ email, password: await bcrypt.hash(req.body.password, 12), name: sanitizeText(req.body.name, 120), emailVerifiedAt: null });
        await verification(user);
        await login(res, user);
        res.status(201).json({ success: true, requiresVerification: true, user: userDto(user), message: 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse.' });
    });
    app.post('/api/login', authLimiter, ...write, async (req, res) => {
        const email = sanitizeEmail(req.body.email);
        const password = req.body.password;
        if (!email || typeof password !== 'string' || Buffer.byteLength(password) > 72) fail('Ungültige Anmeldedaten.', 401);
        const user = await User.findOne({ email });
        if (!user || !await bcrypt.compare(password, user.password)) fail('Ungültige Anmeldedaten.', 401);
        await login(res, user);
        res.json({ success: true, user: userDto(user) });
    });
    app.post('/api/logout', ...write, async (req, res) => {
        await sessionService.revoke(req.userSession);
        res.clearCookie('auth_token', { ...getUserCookieOptions(), maxAge: undefined });
        res.json({ success: true });
    });
    app.get('/api/user', async (req, res) => res.json({ user: userDto(await current(req)) }));
    app.post('/api/user/verification', authLimiter, ...write, async (req, res) => {
        const user = await current(req);
        if (!user.emailVerifiedAt) await verification(user);
        res.json({ success: true, message: 'Der Bestätigungslink wurde zum Versand vorgemerkt.' });
    });
    app.post('/api/user/verify-email', authLimiter, ...write, async (req, res) => {
        const user = await current(req);
        const token = String(req.body.token || '');
        if (!/^[a-f0-9]{64}$/.test(token)) fail('Ungültiger Bestätigungslink.');
        const result = await User.findOneAndUpdate({ id: user.id, emailVerificationHash: hash(token), emailVerificationExpiresAt: { $gt: new Date() } }, { $set: { emailVerifiedAt: new Date() }, $unset: { emailVerificationHash: 1, emailVerificationExpiresAt: 1 } }, { returnDocument: 'after' });
        if (!result) fail('Der Bestätigungslink ist ungültig oder abgelaufen.');
        res.json({ success: true, user: userDto(result) });
    });
    app.post('/api/password-reset/request', authLimiter, ...write, async (req, res) => {
        const user = await User.findOne({ email: sanitizeEmail(req.body.email) });
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            await User.updateOne({ _id: user._id }, { $set: { passwordResetHash: hash(token), passwordResetExpiresAt: new Date(Date.now() + 1800000) } });
            const link = new URL(`account.html#reset=${token}`, frontendUrl).toString();
            await resend.enqueue(`reset:${user.id}:${hash(token)}`, { from: 'NØTE. <info@note-fragrances.de>', to: user.email, subject: 'Passwort zurücksetzen', html: `<p><a href="${escapeHtml(link)}">Neues Passwort festlegen</a></p><p>Der Link gilt 30 Minuten. Falls du dies nicht angefordert hast, ignoriere diese Nachricht.</p>` });
        }
        res.json({ success: true, message: 'Wenn ein Konto existiert, erhältst du einen Link zum Zurücksetzen.' });
    });
    app.post('/api/password-reset/confirm', authLimiter, ...write, async (req, res) => {
        validatePassword(req.body.password);
        const token = String(req.body.token || '');
        if (!/^[a-f0-9]{64}$/.test(token)) fail('Ungültiger Link.');
        const user = await User.findOneAndUpdate({ passwordResetHash: hash(token), passwordResetExpiresAt: { $gt: new Date() } }, { $set: { password: await bcrypt.hash(req.body.password, 12), emailVerifiedAt: new Date() }, $inc: { sessionVersion: 1 }, $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1, emailVerificationHash: 1, emailVerificationExpiresAt: 1 } }, { returnDocument: 'after' });
        if (!user) fail('Der Link ist ungültig oder abgelaufen.');
        await Session.deleteMany({ userId: user.id });
        await login(res, user);
        res.json({ success: true });
    });
    app.put('/api/user/profile', ...write, async (req, res) => {
        const user = await current(req);
        for (const field of ['firstName', 'lastName']) if (req.body[field] !== undefined) user[field] = sanitizeText(req.body[field], 80);
        await user.save();
        res.json({ success: true });
    });
    app.post('/api/user/address', ...write, async (req, res) => {
        const user = await current(req);
        if (user.addresses.length >= 20) fail('Es können höchstens 20 Adressen gespeichert werden.');
        const address = { id: crypto.randomUUID() };
        for (const field of ['firstName', 'lastName', 'label', 'street', 'city', 'zip', 'country']) address[field] = sanitizeText(req.body[field], field === 'street' ? 120 : 80);
        user.addresses.push(address); await user.save();
        res.json({ success: true, addresses: user.addresses });
    });
    app.delete('/api/user/address/:id', ...write, async (req, res) => {
        const user = await current(req);
        user.addresses = user.addresses.filter(address => address.id !== req.params.id);
        await user.save(); res.json({ success: true, addresses: user.addresses });
    });
    app.post('/api/user/orders/claim', ...write, async (req, res) => {
        const user = await current(req, true);
        const result = await Order.updateMany({ email: user.email, userId: null }, { $set: { userId: user.id } });
        res.json({ success: true, claimed: result.modifiedCount });
    });
    app.get('/api/user/orders', async (req, res) => {
        const user = await current(req, true);
        const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
        const limit = 20;
        const orders = await Order.find({ userId: user.id }).sort({ date: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1);
        res.json({ orders: orders.slice(0, limit).map(publicOrder), page, hasMore: orders.length > limit });
    });
}
module.exports = { registerAuthRoutes, validatePassword };
