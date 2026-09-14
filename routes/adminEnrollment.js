function registerAdminEnrollment(app, { enrollment, limiter, isAdmin, requireTrustedOrigin, requireCsrfToken, parseCookies, cookieOptions, issueAdmin }) {
    const cookie = 'admin_setup';
    const write = [requireTrustedOrigin, requireCsrfToken];
    const token = req => parseCookies(req)[cookie];
    const guard = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'Bitte als Admin anmelden.' });
    app.get('/api/admin/access', guard, async (req, res) => res.json({ accounts: await enrollment.list() }));
    app.post('/api/admin/access/invite', limiter, ...write, guard, async (req, res) => {
        res.status(201).json(await enrollment.invite(req.body.username, req.adminSession.adminId, req.body.renew === true));
    });
    app.get('/api/admin/setup', async (req, res) => res.json(await enrollment.status(token(req))));
    app.post('/api/admin/setup/password', limiter, ...write, async (req, res) => res.json(await enrollment.setPassword(token(req), req.body.password)));
    app.post('/api/admin/setup/confirm', limiter, ...write, async (req, res) => {
        const username = await enrollment.confirm(token(req), req.body.otp);
        res.clearCookie(cookie, { ...cookieOptions(), maxAge: undefined });
        await issueAdmin(res, username);
    });
    app.post('/api/admin/setup/cancel', ...write, async (req, res) => {
        if (token(req)) await enrollment.cancel(token(req));
        res.clearCookie(cookie, { ...cookieOptions(), maxAge: undefined });
        res.json({ success: true });
    });
}
module.exports = { registerAdminEnrollment };
