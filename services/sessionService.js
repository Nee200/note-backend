const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
function createSessionService(secret) {
    async function issue(payload, seconds) {
        const jti = crypto.randomBytes(24).toString('hex');
        await Session.create({ jti, userId: payload.userId, role: payload.role || 'customer', adminId: payload.adminId, expiresAt: new Date(Date.now() + seconds * 1000) });
        return jwt.sign({ ...payload, jti }, secret, { algorithm: 'HS256', expiresIn: seconds });
    }
    async function resolve(token) {
        if (!token || token.length > 2048) return null;
        let claims;
        try { claims = jwt.verify(token, secret, { algorithms: ['HS256'] }); } catch { return null; }
        if (!claims.jti) return null; // retire legacy, non-revocable tokens
        const session = await Session.findOne({ jti: claims.jti, expiresAt: { $gt: new Date() } }).lean();
        if (!session || session.userId !== claims.userId || session.role !== (claims.role || 'customer')) return null;
        if (session.role === 'customer') {
            const user = await require('../models/User').findOne({ id: session.userId }).select('sessionVersion').lean();
            if (!user || Number(user.sessionVersion || 0) !== Number(claims.version || 0)) return null;
        }
        return claims;
    }
    const revoke = claims => claims?.jti ? Session.deleteOne({ jti: claims.jti }) : Promise.resolve();
    return { issue, resolve, revoke };
}
module.exports = { createSessionService };
