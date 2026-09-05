function createApp(options = {}) {
const env = options.env || process.env;
require('./config/environment').validateEnvironment(env);
const express = require('express');
const path = require('node:path');
const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Invoice = require('./models/Invoice');
const Review = require('./models/Review');
const Subscriber = require('./models/Subscriber');
const {
    asDate: asInvoiceDate,
    cleanText: cleanInvoiceText,
    resolveServiceDate,
    ensureInvoiceForOrder,
    getPublicInvoiceConfig
} = require('./services/invoiceService');
const {
    allocateOrderNumber,
    ensureOrderNumber,
    ensureOrderNumbers,
    getPublicOrderNumberConfig
} = require('./services/orderNumberService');
const publicProductNames = require('./publicProductNames.json');
const stripe = options.stripe || require('./integrations/providers').createStripeClient(env);
const resend = require('./services/mailService').createMailService({ env, provider: options.mailProvider });
const app = express();
require('./middleware/asyncRoutes').installAsyncRoutes(app);
const LOCAL_DEV_SAFE_MODE = env.LOCAL_DEV_SAFE_MODE === 'true';
const CHECKOUT_DRY_RUN = LOCAL_DEV_SAFE_MODE || env.CHECKOUT_DRY_RUN === 'true';
const IS_PRODUCTION = env.NODE_ENV === 'production';

if (LOCAL_DEV_SAFE_MODE) {
    const mongoUri = env.MONGO_URI || '';
    const isLocalMongoUri = /^mongodb(?:\+srv)?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(mongoUri);

    if (!isLocalMongoUri) {
        throw new Error('LOCAL_DEV_SAFE_MODE darf nur mit einer lokalen MongoDB verwendet werden. Bitte nutze z. B. mongodb://127.0.0.1:27017/note-localtest');
    }
}

const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const rateKey = req => require('express-rate-limit').ipKeyGenerator(req.noteClientIP || req.ip);
const { MongoRateStore } = require('./middleware/mongoRateStore');
const adminAuthenticator = require('./services/adminAuth').createAdminAuthenticator(env);
const {
    supplierEntries,
    findSupplierEntryById,
    findBestSupplierMatchByInspiredBy
} = require('./supplierCatalogMap');

const JWT_SECRET = env.JWT_SECRET;
const sessionService = require('./services/sessionService').createSessionService(JWT_SECRET);
const JWT_ALGORITHM = 'HS256';
const ADMIN_TOKEN_COOKIE = 'admin_token';
const USER_TOKEN_COOKIE = 'auth_token';
const CSRF_TOKEN_COOKIE = 'csrf_token';
const PORT = Number(env.PORT || 4242);
const INVOICES_ENABLED = ['1', 'true', 'yes', 'on'].includes(
    String(env.INVOICES_ENABLED || 'true').trim().toLowerCase()
);
const BACKEND_PUBLIC_URL = env.BACKEND_PUBLIC_URL || (IS_PRODUCTION ? 'https://note-backend-5gy0.onrender.com' : 'http://localhost:4242');
const FRONTEND_PUBLIC_URL = env.FRONTEND_PUBLIC_URL || (IS_PRODUCTION ? 'https://note-fragrances.de' : 'http://localhost:5500');
const INTERNAL_ORDER_NOTIFICATION_EMAIL = String(env.INTERNAL_ORDER_NOTIFICATION_EMAIL || 'info@note-fragrances.de').trim();
const EXPECTS_LIVE_STRIPE_MODE = String(env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
const APP_STARTED_AT = Date.now();
const TRUSTED_BROWSER_ORIGINS = Array.from(new Set([
    ...(IS_PRODUCTION ? [] : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500'
    ]),
    'https://note-fragrances.de',
    'https://www.note-fragrances.de',
    ...String(env.TRUSTED_BROWSER_ORIGINS || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    FRONTEND_PUBLIC_URL,
    BACKEND_PUBLIC_URL
].filter(Boolean).map(value => {
    try {
        return new URL(value).origin;
    } catch (err) {
        return null;
    }
}).filter(Boolean)));

function looksLikePlaceholder(value) {
    const normalized = String(value || '').toLowerCase();
    if (!normalized) return true;
    return normalized.includes('placeholder')
        || /<[^>]+>/.test(normalized)
        || normalized.includes('change-me')
        || normalized.includes('example');
}

if (IS_PRODUCTION) {
    const requiredProdEnv = [
        ['MONGO_URI', env.MONGO_URI],
        ['JWT_SECRET', env.JWT_SECRET],
        ['NEWSLETTER_UNSUBSCRIBE_SECRET', env.NEWSLETTER_UNSUBSCRIBE_SECRET],
        ['ADMIN_CREDENTIALS', env.ADMIN_ACCOUNTS_JSON || env.ADMIN_PASSWORD],
        ['STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY],
        ['STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET],
        ['RESEND_API_KEY', env.RESEND_API_KEY],
        ['FRONTEND_PUBLIC_URL', env.FRONTEND_PUBLIC_URL],
        ['BACKEND_PUBLIC_URL', env.BACKEND_PUBLIC_URL]
    ];

    const missing = requiredProdEnv.filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
    const weak = requiredProdEnv
        .filter(([, value]) => String(value || '').trim() && looksLikePlaceholder(value))
        .map(([name]) => name);

    if (missing.length || weak.length) {
        throw new Error(
            `Production ENV invalid. Missing: [${missing.join(', ')}], Placeholder-like: [${weak.join(', ')}]`
        );
    }
    for (const name of ['FRONTEND_PUBLIC_URL', 'BACKEND_PUBLIC_URL']) {
        const url = new URL(env[name]);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(name + ' muss eine HTTPS-Origin ohne Zugangsdaten, Pfad oder Query sein.');
    }
    if (!/^sk_live_\S+$/.test(env.STRIPE_SECRET_KEY) || !/^whsec_\S+$/.test(env.STRIPE_WEBHOOK_SECRET) || !/^re_\S+$/.test(env.RESEND_API_KEY)) throw new Error('Ungültiges Format der produktiven Provider-Schlüssel.');
}

const authLimiter = rateLimit({
    store: new MongoRateStore('authLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Anfragen. Bitte versuche es in ein paar Minuten erneut.' }
});

const adminAuthLimiter = rateLimit({
    store: new MongoRateStore('adminAuthLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Admin-Anfragen. Bitte versuche es später erneut.' }
});

const formLimiter = rateLimit({
    store: new MongoRateStore('formLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Formularanfragen. Bitte versuche es später erneut.' }
});

const newsletterLimiter = rateLimit({
    store: new MongoRateStore('newsletterLimiter'), keyGenerator: rateKey,
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Newsletter-Anmeldungen. Bitte versuche es später erneut.' }
});

const couponLimiter = rateLimit({
    store: new MongoRateStore('couponLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Gutschein-Prüfungen. Bitte versuche es später erneut.' }
});

const reviewLimiter = rateLimit({
    store: new MongoRateStore('reviewLimiter'), keyGenerator: rateKey,
    windowMs: 60 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Bewertungsanfragen. Bitte später erneut versuchen.' }
});

const viewLimiter = rateLimit({
    store: new MongoRateStore('viewLimiter'), keyGenerator: rateKey,
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Live-View-Anfragen. Bitte kurz warten.' }
});

const adminWriteLimiter = rateLimit({
    store: new MongoRateStore('adminWriteLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Admin-Schreibanfragen. Bitte kurz warten.' }
});

const csrfTokenLimiter = rateLimit({
    store: new MongoRateStore('csrfTokenLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Sicherheits-Token-Anfragen. Bitte kurz warten.' }
});

const checkoutLimiter = rateLimit({
    store: new MongoRateStore('checkoutLimiter'), keyGenerator: rateKey,
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Checkout-Anfragen. Bitte kurz warten.' }
});

const recentJsonParseErrorTimestamps = [];

function signAuthToken(payload, expiresIn) {
    return jwt.sign(payload, JWT_SECRET, {
        algorithm: JWT_ALGORITHM,
        expiresIn
    });
}

function verifyAuthToken(token) {
    return jwt.verify(token, JWT_SECRET, {
        algorithms: [JWT_ALGORITHM]
    });
}



function getRequestOrigin(req) {
    const origin = req.headers.origin;
    if (origin) {
        try {
            return new URL(origin).origin;
        } catch (err) {
            return null;
        }
    }

    const referer = req.headers.referer;
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch (err) {
            return null;
        }
    }

    return null;
}

function requireTrustedOrigin(req, res, next) {
    const requestOrigin = getRequestOrigin(req);
    if (!requestOrigin || !TRUSTED_BROWSER_ORIGINS.includes(requestOrigin)) {
        return res.status(403).json({ error: 'Origin nicht erlaubt.' });
    }
    next();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeEmail(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return '';
    }
    return normalized;
}

function sanitizeHeaderText(value) {
    return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeText(value, maxLength = 200) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<[^>]*>/g, ' ')
        .replace(/javascript:/gi, ' ')
        .replace(/on\w+\s*=/gi, ' ')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[<>`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizeMultilineText(value, maxLength = 5000) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function extractCheckoutCustomerInfo(session) {
    const customerDetails = session && session.customer_details ? session.customer_details : {};
    const collectedInformation = session && session.collected_information ? session.collected_information : {};
    const shippingDetails = collectedInformation.shipping_details
        || (session && session.shipping_details)
        || null;

    const name = sanitizeText(
        (shippingDetails && shippingDetails.name)
        || collectedInformation.individual_name
        || customerDetails.individual_name
        || customerDetails.name
        || collectedInformation.business_name
        || customerDetails.business_name
        || '',
        120
    );
    const email = sanitizeEmail(customerDetails.email || (session && session.customer_email) || '');
    const rawAddress = (shippingDetails && shippingDetails.address)
        || customerDetails.address
        || null;

    let address = null;
    if (rawAddress && typeof rawAddress === 'object') {
        address = {
            line1: sanitizeText(rawAddress.line1 || '', 200),
            line2: sanitizeText(rawAddress.line2 || '', 200),
            city: sanitizeText(rawAddress.city || '', 120),
            postal_code: sanitizeText(rawAddress.postal_code || '', 30),
            state: sanitizeText(rawAddress.state || '', 120),
            country: sanitizeText(rawAddress.country || '', 10)
        };
        if (name) address.name = name;
    }

    return { name, email, address };
}

async function resolveCheckoutCustomerInfo(session) {
    let info = extractCheckoutCustomerInfo(session);
    if (info.name || !session || !session.id) return info;

    try {
        const refreshedSession = await stripe.checkout.sessions.retrieve(session.id);
        info = extractCheckoutCustomerInfo(refreshedSession);
    } catch (error) {
        console.warn('[Stripe] Kundendaten konnten nicht erneut geladen werden:', error.message);
    }

    return info;
}

function sanitizeCategory(value) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    if (!normalized) return '';
    if (!['women', 'men', 'unisex'].includes(normalized)) return '';
    return normalized;
}

function sanitizeProductId(value) {
    const normalized = sanitizeText(value, 40).toUpperCase();
    if (!/^[A-Z0-9_-]{1,40}$/.test(normalized)) return '';
    if (['__PROTO__', 'PROTOTYPE', 'CONSTRUCTOR'].includes(normalized)) return '';
    return normalized;
}

function sanitizeAssetPath(value) {
    const normalized = sanitizeText(value, 300);
    if (!normalized) return '';
    const lowered = normalized.toLowerCase();
    if (lowered.startsWith('javascript:') || lowered.startsWith('data:')) return '';
    return normalized;
}

function parseMoneyValue(value, { allowNull = false } = {}) {
    if (allowNull && (value === null || value === undefined || value === '')) {
        return null;
    }
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value).trim())) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) {
        return undefined;
    }
    return parsed;
}

function sanitizeTrackingUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }

    try {
        const parsed = new URL(value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }
        return parsed.toString();
    } catch (err) {
        return '';
    }
}

function sanitizeQuantity(value) {
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return null;
    }
    return quantity;
}

function csrfSubject(req) { return [req?.userSession?.jti || '', req?.adminSession?.jti || ''].join(':'); }
function generateCsrfToken(req) {
    const nonce = crypto.randomBytes(24).toString('hex');
    return nonce + '.' + crypto.createHmac('sha256', JWT_SECRET).update(nonce + ':' + csrfSubject(req)).digest('hex');
}
function validCsrfToken(token, req) {
    if (!/^[a-f0-9]{48}\.[a-f0-9]{64}$/.test(String(token || ''))) return false;
    const [nonce, mac] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(nonce + ':' + csrfSubject(req)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function getAdminCookieOptions() {
    return {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'Lax',
        maxAge: 3600 * 1000,
        path: '/'
    };
}

function getUserCookieOptions() {
    return {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'Lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
    };
}

function getCsrfCookieOptions() {
    return {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'Lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
    };
}

async function findValidCoupon(code) { return require('./services/couponService').findCoupon(code); }

function generateConfirmationToken() {
    return crypto.randomBytes(24).toString('hex');
}

async function generateNewsletterCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = 'NOTE-' + Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join('');
    } while (await Subscriber.findOne({ code }));

    return code;
}

function buildBackendPublicUrl(req) {
    if (req && req.headers && req.headers.host && !IS_PRODUCTION) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        return `${protocol}://${req.headers.host}`;
    }

    return BACKEND_PUBLIC_URL;
}

function buildFrontendPublicUrl(req) {
    if (req && req.headers && req.headers.origin && /localhost|127\.0\.0\.1/i.test(req.headers.origin)) {
        return req.headers.origin;
    }

    return FRONTEND_PUBLIC_URL;
}

function buildFrontendPageUrl(pagePath) {
    const base = FRONTEND_PUBLIC_URL.endsWith('/') ? FRONTEND_PUBLIC_URL : `${FRONTEND_PUBLIC_URL}/`;
    return new URL(pagePath, base).toString();
}

const EMAIL_WAVE_TOP_IMAGE_URL = buildFrontendPageUrl('email-wave-top.png');
const EMAIL_WAVE_BOTTOM_IMAGE_URL = buildFrontendPageUrl('email-wave-bottom.png');
const EMAIL_ICON_CHECK_IMAGE_URL = buildFrontendPageUrl('email-icon-check-gold.png');

function getMongoStateLabel(readyState) {
    switch (readyState) {
        case 0: return 'disconnected';
        case 1: return 'connected';
        case 2: return 'connecting';
        case 3: return 'disconnecting';
        default: return 'unknown';
    }
}

const { renderBrandEmail, formatEuroFromCents, formatAddressHtml, buildEmailItemsHtml, normalizeOrderNumber, buildEmailOrderNumberLine, buildOrderConfirmationEmailPayload, buildPickupOrderConfirmationEmailPayload, buildShippingEmailPayload, buildPickupReadyEmailPayload, buildNewsletterConfirmationEmailPayload, buildNewsletterDiscountEmailPayload, buildContactConfirmationEmailPayload, buildContactInternalEmailHtml, buildPickupOrderInternalEmailPayload, buildAdminEmailTemplatePreviews } = require('./services/emailTemplates').createEmailTemplates({ EMAIL_ICON_CHECK_IMAGE_URL, EMAIL_WAVE_BOTTOM_IMAGE_URL, EMAIL_WAVE_TOP_IMAGE_URL, escapeHtml, sanitizeTrackingUrl });

function getUserDisplayName(user) {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (user.name && user.name.trim()) return user.name.trim();
    if (user.email) return user.email.split('@')[0];
    return 'Anonymer Kunde';
}

async function getAuthenticatedUser(req) {
    const token = getUserTokenFromRequest(req);
    if (!token) {
        const error = new Error('Nicht eingeloggt');
        error.status = 401;
        throw error;
    }

    try {
        const decoded = verifyAuthToken(token);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) {
            const error = new Error('User nicht gefunden');
            error.status = 404;
            throw error;
        }
        return user;
    } catch (err) {
        if (err.status) throw err;
        const error = new Error('Ungültiger Token');
        error.status = 401;
        throw error;
    }
}

async function buildReviewPayload(productId, userId = null, requestedPage = 1) {
    const page = Math.min(10000, Math.max(1, Math.trunc(Number(requestedPage) || 1)));
    const [reviews, summary, own] = await Promise.all([
        Review.find({ productId }).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * 50).limit(51).lean(),
        Review.aggregate([{ $match: { productId } }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]),
        userId ? Review.findOne({ productId, userId }).lean() : null
    ]);
    const serialize = review => ({ id: String(review._id), authorName: review.authorName, rating: review.rating, title: review.title || '', comment: review.comment || '', verifiedPurchase: review.verificationVersion === 2 && !!review.verifiedPurchase, createdAt: review.createdAt, updatedAt: review.updatedAt, isOwnReview: !!userId && review.userId === userId });
    return { summary: { average: summary[0]?.average || 0, count: summary[0]?.count || 0 }, reviews: reviews.slice(0, 50).map(serialize), ownReview: own ? serialize(own) : null, page, hasMore: reviews.length > 50 };
}

async function buildReviewSummaryMap(productIds) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
        return {};
    }

    const summaries = await Review.aggregate([
        { $match: { productId: { $in: productIds } } },
        {
            $group: {
                _id: '$productId',
                average: { $avg: '$rating' },
                count: { $sum: 1 }
            }
        }
    ]);

    return summaries.reduce((acc, item) => {
        acc[item._id] = {
            average: item.average || 0,
            count: item.count || 0
        };
        return acc;
    }, {});
}

// --- SERVER-SIDE CACHE ---
let productCache = null;
let catalogLoadedAt = 0, catalogRefresh;
async function refreshProductCache() {
    if (catalogRefresh) return catalogRefresh;
    catalogRefresh = loadCatalog().finally(() => { catalogRefresh = null; });
    return catalogRefresh;
}
async function loadCatalog() {
    try {
        const databaseProducts = await Product.find({}, '-_id -__v').lean();

        // Lokale Vorschau: Neuheiten aus products.json einblenden, ohne die
        // verbundene Produktionsdatenbank beim Entwickeln zu verändern.
        if (!IS_PRODUCTION && env.LOCAL_CATALOG_OVERLAY === 'true' && fs.existsSync(path.join(__dirname, 'products.json'))) {
            const catalogPath = path.join(__dirname, 'products.json');
            const localCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
            const mergedProducts = new Map(databaseProducts.map((product) => [product.id, product]));

            localCatalog.forEach((product) => {
                if (product.newArrival === true) {
                    mergedProducts.set(product.id, product);
                    return;
                }

                // Lokal erzeugte Ersatzmotive sollen in der Vorschau sichtbar
                // sein, ohne die Produktionsdatenbank oder andere Produktdaten
                // zu verändern. Nur die versionierten Natural-V3-Bilder werden
                // deshalb über die Datenbankbilder gelegt.
                const localPrimaryImage = Array.isArray(product.images)
                    ? String(product.images[0] || '').trim()
                    : '';
                const existingProduct = mergedProducts.get(product.id);
                const isLocalNaturalV3Image = /^images_website\/new-arrivals\/[gl]\d+-notes-v3-natural-v\d+\.webp$/i
                    .test(localPrimaryImage);

                if (existingProduct && isLocalNaturalV3Image) {
                    mergedProducts.set(product.id, {
                        ...existingProduct,
                        images: product.images
                    });
                }
            });
            productCache = Array.from(mergedProducts.values());
        } else {
            productCache = databaseProducts;
        }
        catalogLoadedAt = Date.now();
    } catch (e) {
        throw e;
    }
}

function isAdmin(req) { return req.adminSession?.role === 'admin'; }

function normalizeInternalExternalProductId(rawValue) {
    return String(rawValue || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/[^A-Z0-9]/g, '');
}

function parseInternalOrSupplierId(rawValue) {
    const normalized = normalizeInternalExternalProductId(rawValue);
    const match = normalized.match(/^([GLMW])(\d{1,4})$/);
    if (!match) return null;

    const prefix = match[1];
    const number = parseInt(match[2], 10);
    if (!Number.isFinite(number) || number <= 0) return null;

    return {
        normalized,
        prefix,
        number,
        internalId: (prefix === 'G' || prefix === 'L') ? `${prefix}${number}` : `${prefix === 'M' ? 'G' : 'L'}${number}`,
        supplierId: (prefix === 'M' || prefix === 'W') ? `${prefix}${number}` : null,
        direction: (prefix === 'G' || prefix === 'L') ? 'internal-to-supplier' : 'supplier-to-internal'
    };
}

function extractInternalIdFromOrderItemDescription(description) {
    const raw = String(description || '').toUpperCase();
    if (!raw) return '';

    const compact = raw
        .replace(/NØTE\./g, ' ')
        .replace(/NO\./g, ' ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();

    const match = compact.match(/\b([GL])\s*([0-9]{1,4})\b/);
    if (!match) return '';
    return `${match[1]}${parseInt(match[2], 10)}`;
}

function buildSupplierMappingForInternalId(internalId, productMapById) {
    const parsed = parseInternalOrSupplierId(internalId);
    if (!parsed || parsed.direction !== 'internal-to-supplier') {
        return null;
    }

    const expectedSupplierPrefix = parsed.prefix === 'G' ? 'M' : 'W';
    const product = productMapById.get(parsed.internalId) || null;
    if (!product || !String(product.inspiredBy || '').trim()) {
        return null;
    }

    const best = findBestSupplierMatchByInspiredBy(product.inspiredBy, expectedSupplierPrefix);
    if (!best || !best.supplierId) {
        return null;
    }

    return {
        supplierId: best.supplierId,
        confidence: Number(best.confidence) || 0,
        matchedBy: best.matchedBy || 'fuzzy'
    };
}

// Cookie names are client-controlled. A null-prototype map prevents special
// names such as "__proto__" or "constructor" from affecting object state.
const parseCookies = (request) => {
    const list = Object.create(null);
    const rawCookies = request && request.headers ? request.headers.cookie : '';

    if (!rawCookies) return list;

    rawCookies.split(';').forEach((cookie) => {
        const parts = cookie.split('=');
        const name = String(parts.shift() || '').trim();
        if (!name) return;

        const rawValue = parts.join('=');
        try {
            list[name] = decodeURIComponent(rawValue);
        } catch (error) {
            list[name] = rawValue;
        }
    });

    return list;
}

function getUserTokenFromRequest(req) {
    return req.userSession ? String(parseCookies(req)[USER_TOKEN_COOKIE] || '') : '';
}

function ensureCsrfCookie(req, res, next) {
    if (['/health', '/ready', '/webhook'].includes(req.path)) return next();
    let token = parseCookies(req)[CSRF_TOKEN_COOKIE];
    if (!validCsrfToken(token, req)) {
        token = generateCsrfToken(req);
        res.cookie(CSRF_TOKEN_COOKIE, token, getCsrfCookieOptions());
    }
    req.csrfToken = token;
    next();
}
function requireCsrfToken(req, res, next) {
    const cookie = String(parseCookies(req)[CSRF_TOKEN_COOKIE] || '');
    const header = String(req.headers['x-csrf-token'] || '');
    if (!cookie || cookie !== header || !validCsrfToken(header, req)) return res.status(403).json({ error: 'CSRF-Token ungültig.', code: 'CSRF_INVALID' });
    next();
}

const cors = require('cors');
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: IS_PRODUCTION ? [] : null
        }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Enable CORS for frontend
app.use(cors({
    origin: TRUSTED_BROWSER_ORIGINS, // Allow local UI ports and trusted frontend domains
    credentials: true
}));
const globalLimiter = rateLimit({ store: new MongoRateStore('global'), keyGenerator: rateKey, windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false, skip: req => ['/health', '/ready', '/webhook'].includes(req.path), message: { error: 'Zu viele Anfragen. Bitte kurz warten.' } });
app.use((req, res, next) => {
    const configured = String(env.PROXY_SHARED_SECRET || '');
    const supplied = String(req.get('X-Note-Proxy-Secret') || '');
    const ip = req.get('X-Note-Client-IP');
    if (configured.length >= 32 && require('node:net').isIP(ip || '') && crypto.timingSafeEqual(crypto.createHash('sha256').update(configured).digest(), crypto.createHash('sha256').update(supplied).digest())) req.noteClientIP = ip;
    next();
});
app.use(globalLimiter);
app.use((req, res, next) => {
    if (['/health', '/ready', '/webhook'].includes(req.path)) return next();
    const cookies = parseCookies(req);
    Promise.all([sessionService.resolve(cookies[USER_TOKEN_COOKIE]), sessionService.resolve(cookies[ADMIN_TOKEN_COOKIE])])
        .then(([user, admin]) => { req.userSession = user?.role !== 'admin' ? user : null; req.adminSession = admin?.role === 'admin' && adminAuthenticator.hasAccount(admin.adminId) && admin.credentialVersion === adminAuthenticator.fingerprint(admin.adminId) ? admin : null; next(); }).catch(next);
});
app.use(ensureCsrfCookie);
// Webhook-Route MUSS vor app.use(express.json()) definiert werden
const webhookService = require('./services/webhookService').createWebhookService({
    stripe, Order, Product, allocateOrderNumber, ensureInvoiceForOrder,
    invoicesEnabled: INVOICES_ENABLED, resolveCustomer: resolveCheckoutCustomerInfo,
    resend, buildOrderConfirmationEmailPayload
});
app.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET);
    } catch { return res.status(400).json({ error: 'Ungültige Webhook-Signatur.' }); }
    if (event.livemode !== EXPECTS_LIVE_STRIPE_MODE) return res.status(400).json({ error: 'Falscher Stripe-Modus.' });
    try { await webhookService.receive(event); return res.json({ received: true }); }
    catch (error) { console.error('[Webhook] Verarbeitung wird wiederholt:', error.message); return res.status(503).json({ error: 'Ereignis noch nicht vollständig verarbeitet.' }); }
});

// Middleware for parsing JSON and URL-encoded data
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Einheitliche Antwort bei kaputtem JSON-Body statt HTML-Stacktrace
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, 'body')) {
        recentJsonParseErrorTimestamps.push(Date.now());
        if (recentJsonParseErrorTimestamps.length > 1000) recentJsonParseErrorTimestamps.splice(0, recentJsonParseErrorTimestamps.length - 1000);
        return res.status(400).json({ error: 'Ungültiges JSON-Format.' });
    }
    return next(err);
});

app.get('/health', (req, res) => {
    const mongoReadyState = mongoose.connection ? mongoose.connection.readyState : 0;
    const dbConnected = mongoReadyState === 1;

    return res.status(200).json({
        status: 'ok',
        service: 'onlineshop-backend',
        now: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        startedAt: new Date(APP_STARTED_AT).toISOString(),
        env: IS_PRODUCTION ? 'production' : 'non-production',
        safeMode: LOCAL_DEV_SAFE_MODE,
        externalAdaptersDisabled: (LOCAL_DEV_SAFE_MODE || env.NODE_ENV === 'test') && !options.stripe && !options.mailProvider,
        version: env.RENDER_GIT_COMMIT || env.GIT_COMMIT || 'unknown',
        checks: {
            db: {
                ok: dbConnected,
                state: getMongoStateLabel(mongoReadyState)
            }
        }
    });
});

app.get('/ready', async (req, res) => {
    const mongoReadyState = mongoose.connection ? mongoose.connection.readyState : 0;
    const dbConnected = mongoReadyState === 1;

    if (!dbConnected || !mongoose.connection.db) {
        return res.status(503).json({
            status: 'not_ready',
            reason: 'database_not_connected',
            checks: {
                db: {
                    ok: false,
                    state: getMongoStateLabel(mongoReadyState)
                }
            }
        });
    }

    try {
        await mongoose.connection.db.admin().ping();
        if (!Array.isArray(productCache) || productCache.length === 0) {
            await refreshProductCache();
        }

        const productsReady = Array.isArray(productCache) && productCache.length > 0;
        if (!productsReady) {
            return res.status(503).json({
                status: 'not_ready',
                reason: 'product_catalog_not_ready',
                checks: {
                    db: {
                        ok: true,
                        state: getMongoStateLabel(mongoReadyState)
                    },
                    products: {
                        ok: false,
                        count: 0
                    }
                }
            });
        }

        return res.status(200).json({
            status: 'ready',
            now: new Date().toISOString(),
            checks: {
                db: {
                    ok: true,
                    state: getMongoStateLabel(mongoReadyState)
                },
                products: {
                    ok: true,
                    count: productCache.length
                }
            }
        });
    } catch (err) {
        return res.status(503).json({
            status: 'not_ready',
            reason: 'database_ping_failed',
            checks: {
                db: {
                    ok: false,
                    state: getMongoStateLabel(mongoReadyState)
                }
            }
        });
    }
});

app.get('/api/csrf-token', csrfTokenLimiter, (req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ csrfToken: req.csrfToken });
});

app.use('/api', (req, res, next) => {
    if (!['/products', '/commerce-config'].includes(req.path) && !/^\/products\/[^/]+\/reviews$/.test(req.path)) res.set('Cache-Control', 'private, no-store');
    next();
});
app.use('/api/admin', (req, res, next) => {
    if (!isAdmin(req) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || ['/login', '/logout'].includes(req.path)) return next();
    const Audit = require('./models/AdminAudit');
    const details = {};
    for (const key of ['ids', 'applyToAll', 'price30', 'price50', 'originalPrice30', 'originalPrice50', 'status', 'bestseller', 'newArrival']) if (req.body[key] !== undefined) details[key] = req.body[key];
    Audit.create({ actor: req.adminSession.adminId, action: req.method + ' ' + req.path, target: req.path, details: { request: details, outcome: 'requested' } }).then(entry => {
        res.once('finish', () => Audit.updateOne({ _id: entry._id }, { $set: { 'details.httpStatus': res.statusCode, 'details.outcome': res.statusCode < 400 ? 'completed' : 'rejected' } }).catch(error => console.error('Audit completion:', error.message)));
        next();
    }).catch(next);
});
// --- Contact Form ---
app.post('/api/contact', formLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich.' });
    }

    try {
        const normalizedName = sanitizeText(name, 120);
        const safeEmail = sanitizeEmail(email);
        const normalizedSubject = sanitizeText(subject, 180);
        const safeSubjectHeader = sanitizeHeaderText(normalizedSubject).slice(0, 180);
        const normalizedMessage = sanitizeMultilineText(message, 5000);

        if (!normalizedName || !safeEmail || !normalizedSubject || !normalizedMessage) {
            return res.status(400).json({ error: 'Ungültige Formulardaten.' });
        }

        // 1. Nachricht an info@note-fragrances.de
        await resend.emails.send({
            from: 'NØTE. Kontakt <noreply@note-fragrances.de>',
            to: 'info@note-fragrances.de',
            replyTo: safeEmail,
            subject: `Kontaktanfrage: ${safeSubjectHeader}`,
            html: buildContactInternalEmailHtml({
                name: normalizedName,
                email: safeEmail,
                subjectText: normalizedSubject,
                message: normalizedMessage,
                receivedAtText: new Date().toLocaleString('de-DE')
            })
        });

        // 2. Bestätigung an den Absender
        const contactConfirmationMail = buildContactConfirmationEmailPayload({
            name: normalizedName,
            subjectText: normalizedSubject
        });
        await resend.emails.send({
            from: 'NOTE. fragrances <info@note-fragrances.de>',
            to: safeEmail,
            subject: contactConfirmationMail.subject,
            html: contactConfirmationMail.html
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Kontaktformular Fehler:', err);
        res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden.' });
    }
});

app.locals.newsletterService = require('./routes/newsletter').registerNewsletterRoutes(app, {
    env, resend, newsletterLimiter, requireTrustedOrigin, requireCsrfToken,
    sanitizeEmail, escapeHtml, frontendUrl: FRONTEND_PUBLIC_URL.replace(/\/$/, ''),
    backendUrl: (IS_PRODUCTION ? FRONTEND_PUBLIC_URL : BACKEND_PUBLIC_URL).replace(/\/$/, ''),
    buildNewsletterConfirmationEmailPayload, buildNewsletterDiscountEmailPayload,
    safeMode: LOCAL_DEV_SAFE_MODE
});

// --- Coupon validieren ---
app.post('/api/validate-coupon', couponLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ valid: false });

        const sub = await findValidCoupon(code);
        if (sub) {
            const freeShipping = sub.freeShipping === true;
            const discountLabel = `-${sub.discount}% Newsletter-Rabatt`;
            const label = freeShipping ? `${discountLabel} + Gratis Versand` : discountLabel;
            return res.json({
                valid: true,
                code: sub.code,
                discount: sub.discount,
                freeShipping,
                label
            });
        }
        res.json({ valid: false });
    } catch (err) {
        console.error('Coupon validation error:', err);
        res.status(503).json({ error: 'Gutschein-Prüfung aktuell nicht verfügbar.' });
    }
});

// --- User Auth Routes ---

require('./routes/auth').registerAuthRoutes(app, {
    User, Order, authLimiter, requireTrustedOrigin, requireCsrfToken, sanitizeEmail,
    sanitizeText, escapeHtml, sessionService, resend, frontendUrl: FRONTEND_PUBLIC_URL, getUserCookieOptions
});

app.get('/api/products/:productId/reviews', async (req, res) => {
    try {
        const productId = (req.params.productId || '').trim();
        if (!productId) {
            return res.status(400).json({ error: 'Produkt-ID fehlt' });
        }

        let userId = null;
        try {
            const token = getUserTokenFromRequest(req);
            if (token) {
                const decoded = verifyAuthToken(token);
                userId = decoded.userId || null;
            }
        } catch (err) {
            userId = null;
        }

        const payload = await buildReviewPayload(productId, userId, req.query.page);
        res.json(payload);
    } catch (err) {
        console.error('Fehler beim Laden der Bewertungen:', err);
        res.status(500).json({ error: 'Bewertungen konnten nicht geladen werden.' });
    }
});

app.post('/api/products/:productId/reviews', reviewLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    try {
        const productId = (req.params.productId || '').trim();
        if (!productId) {
            return res.status(400).json({ error: 'Produkt-ID fehlt' });
        }

        const product = await Product.findOne({ id: productId }, 'id name');
        if (!product) {
            return res.status(404).json({ error: 'Produkt nicht gefunden' });
        }

        const user = await getAuthenticatedUser(req);
        const rawRating = Number(req.body.rating);
        const rating = Number.isFinite(rawRating) ? Math.round(rawRating) : NaN;
        const title = sanitizeText(req.body.title, 120);
        const comment = sanitizeText(req.body.comment, 1200);

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Bitte gib eine Bewertung zwischen 1 und 5 Sternen ab.' });
        }

        if (!comment || comment.length < 10) {
            return res.status(400).json({ error: 'Bitte schreibe mindestens 10 Zeichen zu deiner Bewertung.' });
        }

        const verifiedPurchase = !!user.emailVerifiedAt && await Order.exists({
            userId: user.id, paymentStatus: 'paid', refundedAmountCents: 0,
            'items.productId': productId
        });

        const review = await Review.findOneAndUpdate(
            { productId, userId: user.id },
            {
                productId,
                userId: user.id,
                userEmail: user.email,
                authorName: getUserDisplayName(user),
                rating,
                title,
                comment,
                verifiedPurchase: !!verifiedPurchase,
                verificationVersion: 2,
                updatedAt: new Date()
            },
            {
                upsert: true,
                returnDocument: 'after',
                setDefaultsOnInsert: true,
                runValidators: true
            }
        );

        const payload = await buildReviewPayload(productId, user.id);
        res.status(201).json({
            success: true,
            message: review.createdAt && review.updatedAt && review.createdAt.getTime() === review.updatedAt.getTime()
                ? 'Bewertung gespeichert.'
                : 'Bewertung aktualisiert.',
            ...payload
        });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('Fehler beim Speichern der Bewertung:', err);
        res.status(500).json({ error: 'Bewertung konnte nicht gespeichert werden.' });
    }
});


app.post('/api/view-product', (req, res) => res.status(410).json({ disabled: true }));
app.post('/admin/login', (req, res) => res.status(410).send('Diese Anmelderoute wurde entfernt.'));

// --- NEW API-based Admin Routes ---
app.post('/api/admin/login', adminAuthLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const adminId = await adminAuthenticator.authenticate(req.body);
    if (!adminId) return res.status(401).json({ error: 'Benutzername, Passwort oder Sicherheitscode ungültig.' });
    const token = await sessionService.issue({ role: 'admin', adminId, credentialVersion: adminAuthenticator.fingerprint(adminId) }, 3600);
    res.cookie(ADMIN_TOKEN_COOKIE, token, getAdminCookieOptions());
    res.json({ success: true, features: { invoices: INVOICES_ENABLED } });
});

app.post('/api/admin/logout', requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    await sessionService.revoke(req.adminSession);
    res.clearCookie(ADMIN_TOKEN_COOKIE, { ...getAdminCookieOptions(), maxAge: undefined });
    res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
    if (isAdmin(req)) {
        res.json({
            success: true,
            features: {
                invoices: INVOICES_ENABLED
            }
        });
    } else {
        res.status(401).json({ error: 'Not authorized' });
    }
});

app.get('/api/admin/email-templates', (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        return res.json({ templates: buildAdminEmailTemplatePreviews() });
    } catch (err) {
        console.error('Fehler beim Erstellen der E-Mail-Template-Previews:', err);
        return res.status(500).json({ error: 'Server Fehler' });
    }
});

app.get('/api/admin/security-status', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Bitte anmelden.' });
    res.json(await require('./services/operationsStatus').operationsStatus(env));
});
app.get('/api/admin/audit', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Bitte anmelden.' });
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const entries = await require('./models/AdminAudit').find().sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 50).limit(51).lean();
    res.json({ entries: entries.slice(0, 50), page, hasMore: entries.length > 50 });
});

app.get('/api/admin/id-mapping', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    const inputId = normalizeInternalExternalProductId(req.query.id || '');
    if (!inputId) {
        return res.status(400).json({ error: 'Bitte eine Produkt-ID uebergeben (z.B. G122 oder M122).' });
    }

    const parsed = parseInternalOrSupplierId(inputId);
    if (!parsed) {
        return res.status(400).json({ error: 'Ungueltiges ID-Format. Erlaubt: G/L/M/W + Zahl (z.B. G122).' });
    }

    try {
        if (!Array.isArray(productCache) || Date.now() - catalogLoadedAt > 60000) {
            await refreshProductCache();
        }
    } catch (error) {
        // keep response resilient even if cache refresh fails
    }

    const products = Array.isArray(productCache) ? productCache : [];
    const warnings = [];

    if (parsed.direction === 'internal-to-supplier') {
        const product = products.find(p => String(p.id || '').toUpperCase() === parsed.internalId) || null;
        const expectedSupplierPrefix = parsed.prefix === 'G' ? 'M' : 'W';
        let supplierMatch = null;

        if (product && product.inspiredBy) {
            supplierMatch = findBestSupplierMatchByInspiredBy(product.inspiredBy, expectedSupplierPrefix);
        }

        if (!product) {
            warnings.push(`Interne Produkt-ID ${parsed.internalId} wurde im aktuellen Katalog nicht gefunden.`);
        }
        if (product && !supplierMatch) {
            warnings.push(`Kein sicherer Match in der Referenzliste fuer "${product.inspiredBy || '-'}" gefunden.`);
        }

        return res.json({
            query: inputId,
            direction: parsed.direction,
            internalId: parsed.internalId,
            supplierId: supplierMatch ? supplierMatch.supplierId : null,
            supplierLine: supplierMatch ? supplierMatch.supplierId : null,
            number: parsed.number,
            matchedBy: supplierMatch ? supplierMatch.matchedBy : null,
            confidence: supplierMatch ? supplierMatch.confidence : null,
            alternatives: supplierMatch && Array.isArray(supplierMatch.alternatives) ? supplierMatch.alternatives : [],
            product: product ? {
                id: product.id,
                name: product.name,
                inspiredBy: product.inspiredBy || '',
                category: product.category || ''
            } : null,
            supplierReference: supplierMatch ? {
                inspiredBy: supplierMatch.inspiredBy
            } : null,
            warnings
        });
    }

    const supplierEntry = findSupplierEntryById(parsed.supplierId);
    if (!supplierEntry) {
        warnings.push(`Listen-ID ${parsed.supplierId} wurde in der Referenzliste nicht gefunden.`);
    }

    const expectedInternalPrefix = parsed.prefix === 'M' ? 'G' : 'L';
    const candidateProducts = products
        .filter(p => String(p.id || '').toUpperCase().startsWith(expectedInternalPrefix))
        .map((product) => {
            const match = findBestSupplierMatchByInspiredBy(product.inspiredBy || '', parsed.prefix);
            return {
                product,
                match
            };
        })
        .filter(item => item.match && item.match.supplierId === parsed.supplierId)
        .sort((a, b) => (Number(b.match.confidence) || 0) - (Number(a.match.confidence) || 0))
        .slice(0, 5)
        .map(item => ({
            id: item.product.id,
            name: item.product.name,
            inspiredBy: item.product.inspiredBy || '',
            confidence: item.match.confidence,
            matchedBy: item.match.matchedBy
        }));

    if (!candidateProducts.length) {
        warnings.push(`Kein internes Produkt mit passender inspiredBy-Zuordnung fuer ${parsed.supplierId} gefunden.`);
    }

    return res.json({
        query: inputId,
        direction: parsed.direction,
        internalId: parsed.internalId,
        supplierId: parsed.supplierId,
        supplierLine: parsed.supplierId,
        number: parsed.number,
        matchedBy: null,
        confidence: null,
        product: candidateProducts[0] || null,
        candidates: candidateProducts,
        supplierReference: supplierEntry ? {
            supplierId: supplierEntry.supplierId,
            inspiredBy: supplierEntry.inspiredBy
        } : null,
        warnings
    });
});

app.get('/api/admin/id-mapping/catalog', (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    const men = [];
    const women = [];

    const source = Array.isArray(supplierEntries) ? supplierEntries : [];
    source.forEach((entry) => {
        const payload = {
            supplierId: entry.supplierId,
            inspiredBy: entry.inspiredBy || ''
        };
        if (entry.prefix === 'M') {
            men.push(payload);
        } else if (entry.prefix === 'W') {
            women.push(payload);
        }
    });

    men.sort((a, b) => Number(a.supplierId.slice(1)) - Number(b.supplierId.slice(1)));
    women.sort((a, b) => Number(a.supplierId.slice(1)) - Number(b.supplierId.slice(1)));

    return res.json({ men, women });
});

app.delete('/api/admin/products/:id', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const deletedProduct = await Product.findOneAndDelete({ id: req.params.id });
        if (!deletedProduct) {
            return res.status(404).json({ error: 'Produkt nicht gefunden' });
        }
        productCache = null; // Invalidate cache
        res.json({ success: true, message: 'Produkt gelöscht' });
    } catch (err) {
        console.error('Fehler beim Löschen:', err);
        res.status(500).json({ error: 'Server Fehler beim Löschen' });
    }
});

app.put('/api/admin/products/:id', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const { name, inspiredBy, description, category, price30, price50, originalPrice30, originalPrice50 } = req.body;

        const updateData = {};
        if (name !== undefined) {
            const safeName = sanitizeText(name, 120);
            if (!safeName) return res.status(400).json({ error: 'Name ist ungültig.' });
            updateData.name = safeName;
        }
        if (inspiredBy !== undefined) updateData.inspiredBy = sanitizeText(inspiredBy, 160);
        if (description !== undefined) updateData.description = sanitizeText(description, 1200);
        if (category !== undefined) {
            const safeCategory = sanitizeCategory(category);
            if (!safeCategory) return res.status(400).json({ error: 'Kategorie ist ungültig.' });
            updateData.category = safeCategory;
        }
        if (req.body.bestseller !== undefined) {
            if (typeof req.body.bestseller !== 'boolean') return res.status(400).json({ error: 'Bestseller muss ein Wahrheitswert sein.' });
            updateData.bestseller = req.body.bestseller;
        }
        if (req.body.newArrival !== undefined) updateData.newArrival = req.body.newArrival === true;

        // Variants
        if (price30 !== undefined) {
            const parsed = parseMoneyValue(price30);
            if (parsed === undefined) return res.status(400).json({ error: 'Preis 30ml ist ungültig.' });
            updateData['variants.30.price'] = parsed;
        }
        if (price50 !== undefined) {
            const parsed = parseMoneyValue(price50);
            if (parsed === undefined) return res.status(400).json({ error: 'Preis 50ml ist ungültig.' });
            updateData['variants.50.price'] = parsed;
        }
        if (originalPrice30 !== undefined) {
            const parsed = parseMoneyValue(originalPrice30, { allowNull: true });
            if (parsed === undefined) return res.status(400).json({ error: 'Originalpreis 30ml ist ungültig.' });
            updateData['variants.30.originalPrice'] = parsed;
        }
        if (originalPrice50 !== undefined) {
            const parsed = parseMoneyValue(originalPrice50, { allowNull: true });
            if (parsed === undefined) return res.status(400).json({ error: 'Originalpreis 50ml ist ungültig.' });
            updateData['variants.50.originalPrice'] = parsed;
        }

        const updated = await Product.findOneAndUpdate(
            { id: req.params.id },
            { $set: updateData },
            { returnDocument: 'after', runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ error: 'Produkt nicht gefunden' });
        }
        productCache = null; // Invalidate cache
        res.json({ success: true, product: updated });
    } catch (err) {
        console.error('Fehler beim Aktualisieren:', err);
        res.status(500).json({ error: 'Server Fehler beim Aktualisieren' });
    }
});

// Bulk price update – updates any subset of products (or ALL if ids array is empty/missing)
app.put('/api/admin/products-bulk', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const { ids, price30, price50, originalPrice30, originalPrice50 } = req.body;

        const updateData = {};
        if (price30 !== undefined && price30 !== '') {
            const parsed = parseMoneyValue(price30);
            if (parsed === undefined) return res.status(400).json({ error: 'Preis 30ml ist ungültig.' });
            updateData['variants.30.price'] = parsed;
        }
        if (price50 !== undefined && price50 !== '') {
            const parsed = parseMoneyValue(price50);
            if (parsed === undefined) return res.status(400).json({ error: 'Preis 50ml ist ungültig.' });
            updateData['variants.50.price'] = parsed;
        }
        if (originalPrice30 !== undefined) {
            const parsed = parseMoneyValue(originalPrice30, { allowNull: true });
            if (parsed === undefined) return res.status(400).json({ error: 'Originalpreis 30ml ist ungültig.' });
            updateData['variants.30.originalPrice'] = parsed;
        }
        if (originalPrice50 !== undefined) {
            const parsed = parseMoneyValue(originalPrice50, { allowNull: true });
            if (parsed === undefined) return res.status(400).json({ error: 'Originalpreis 50ml ist ungültig.' });
            updateData['variants.50.originalPrice'] = parsed;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'Keine Preisfelder angegeben' });
        }

        // If ids provided → only update those, else update ALL
        const safeIds = Array.isArray(ids)
            ? ids.map(id => sanitizeProductId(id)).filter(Boolean)
            : [];
        if (req.body.applyToAll !== true && (!Array.isArray(ids) || !ids.length || safeIds.length !== ids.length)) {
            return res.status(400).json({ error: 'Eine gültige Produktauswahl oder die ausdrückliche Aktion Alle Produkte ist erforderlich.' });
        }
        if (req.body.applyToAll === true && Array.isArray(ids) && ids.length) return res.status(400).json({ error: 'Gesamtauswahl und einzelne IDs dürfen nicht kombiniert werden.' });
        const filter = req.body.applyToAll === true ? {} : { id: { $in: safeIds } };

        const result = await Product.updateMany(filter, { $set: updateData }, { runValidators: true });
        productCache = null; // Invalidate cache
        res.json({ success: true, updated: result.modifiedCount });
    } catch (err) {
        console.error('Bulk update Fehler:', err);
        res.status(500).json({ error: 'Server Fehler beim Massenupdate' });
    }
});

// Bulk bestseller update – set/unset bestseller for a list of product IDs
app.put('/api/admin/products-bestseller', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    try {
        const { ids, bestseller } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ error: 'ids array required' });
        }
        const safeIds = ids.map(id => sanitizeProductId(id)).filter(Boolean);
        if (safeIds.length === 0) {
            return res.status(400).json({ error: 'Keine gültigen Produkt-IDs angegeben.' });
        }
        const result = await Product.updateMany(
            { id: { $in: safeIds } },
            { $set: { bestseller: !!bestseller } }
        );
        productCache = null; // Invalidate cache
        res.json({ success: true, updated: result.modifiedCount });
    } catch (err) {
        console.error('Bestseller bulk update Fehler:', err);
        res.status(500).json({ error: 'Server Fehler' });
    }
});

// Create new product
app.post('/api/admin/products', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const { id, name, category, inspiredBy, description, images, notes, variants, newArrival } = req.body;

        const safeId = sanitizeProductId(id);
        const safeName = sanitizeText(name, 120);
        if (!safeId || !safeName) {
            return res.status(400).json({ error: 'ID und Name sind Pflichtfelder' });
        }

        const safeCategory = category !== undefined ? sanitizeCategory(category) : 'unisex';
        if (!safeCategory) {
            return res.status(400).json({ error: 'Kategorie ist ungültig.' });
        }

        const safeImages = Array.isArray(images)
            ? images.map(image => sanitizeAssetPath(image)).filter(Boolean)
            : [];
        const safeNotes = {
            head: sanitizeText(notes && notes.head, 120),
            heart: sanitizeText(notes && notes.heart, 120),
            base: sanitizeText(notes && notes.base, 120)
        };
        const safeVariants = {};
        [30, 50, 100].forEach((size) => {
            if (!variants || !variants[size]) return;
            const parsedPrice = parseMoneyValue(variants[size].price);
            const parsedOriginal = parseMoneyValue(variants[size].originalPrice, { allowNull: true });
            if (parsedPrice === undefined || parsedOriginal === undefined) return;
            safeVariants[size] = {
                price: parsedPrice,
                originalPrice: parsedOriginal
            };
        });

        if (!Object.keys(safeVariants).length || Object.keys(variants || {}).some(size => !safeVariants[size])) return res.status(400).json({ error: 'Alle Varianten benötigen gültige positive Preise.' });
        if (Array.isArray(images) && images.length !== safeImages.length) return res.status(400).json({ error: 'Bildpfade sind ungültig.' });

        // Check for duplicate ID
        const existing = await Product.findOne({ id: safeId });
        if (existing) {
            return res.status(409).json({ error: 'Produkt-ID existiert bereits: ' + safeId });
        }

        const newProduct = new Product({
            id: safeId,
            name: safeName,
            category: safeCategory,
            inspiredBy: sanitizeText(inspiredBy, 160),
            description: sanitizeText(description, 1200),
            images: safeImages,
            notes: safeNotes,
            variants: safeVariants,
            newArrival: newArrival === true
        });

        await newProduct.save();
        productCache = null; // Invalidate cache
        res.status(201).json({ success: true, product: newProduct });
    } catch (err) {
        console.error('Fehler beim Anlegen:', err);
        res.status(500).json({ error: 'Server Fehler beim Anlegen' });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Not authorized' });
    const page = Math.min(10000, Math.max(1, Math.trunc(Number(req.query.page) || 1)));
    const status = String(req.query.status || 'neu');
    if (!['neu', 'in_bearbeitung', 'abgeschlossen', 'archiv'].includes(status)) return res.status(400).json({ error: 'Ungültiger Bestellstatus.' });
    const orders = await Order.find({ status }).sort({ date: -1, _id: -1 }).skip((page - 1) * 50).limit(51).lean();
    const { itemCents } = require('./services/orderData');
    res.json({ orders: orders.slice(0, 50).map(order => ({ ...order, items: (order.items || []).map(item => ({ ...item, lineTotalCents: itemCents(order, item), amount_total: itemCents(order, item) })), schemaVersion: 2 })), page, hasMore: orders.length > 50 });
});

function getMissingInvoiceOrderQuery() {
    return {
        stripeSessionId: { $exists: true, $nin: ['', null] },
        $or: [
            { invoice: { $exists: false } },
            { invoice: null }
        ]
    };
}

function serializeInvoice(invoice) {
    const raw = invoice && typeof invoice.toObject === 'function' ? invoice.toObject() : invoice;
    return {
        id: String(raw._id),
        number: raw.number,
        status: raw.status,
        issuedAt: raw.issuedAt,
        serviceDate: raw.serviceDate,
        paymentDate: raw.paymentDate,
        orderReference: raw.orderReference,
        currency: raw.currency,
        customer: raw.customer,
        subtotalGrossCents: raw.subtotalGrossCents,
        discountGrossCents: raw.discountGrossCents,
        shippingGrossCents: raw.shippingGrossCents,
        totalNetCents: raw.totalNetCents,
        totalTaxCents: raw.totalTaxCents,
        totalGrossCents: raw.totalGrossCents,
        vatRateBps: raw.vatRateBps,
        payment: raw.payment,
        pdfFileName: raw.pdfFileName,
        pdfByteLength: raw.pdfByteLength,
        pdfSha256: raw.pdfSha256,
        pdfGeneratedAt: raw.pdfGeneratedAt
    };
}

function serializePendingInvoiceOrder(order) {
    const raw = order && typeof order.toObject === 'function' ? order.toObject() : order;
    const serviceDate = resolveServiceDate(raw);
    const address = raw.address && typeof raw.address === 'object' ? raw.address : {};
    return {
        orderId: String(raw._id),
        orderNumber: raw.orderNumber || '',
        orderDate: raw.date,
        name: raw.name || address.name || '',
        email: raw.email || '',
        amount: raw.amount || 0,
        currency: raw.currency || 'eur',
        country: String(address.country || '').toUpperCase(),
        orderStatus: raw.status || 'neu',
        paymentStatus: raw.paymentStatus || 'not_synced',
        paidAt: raw.paidAt || null,
        shippedAt: raw.shippedAt || null,
        proposedServiceDate: serviceDate.date,
        invoiceStatus: raw.invoiceStatus || '',
        invoiceError: raw.invoiceError || ''
    };
}

app.get('/api/admin/invoices', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    if (!INVOICES_ENABLED) {
        return res.status(404).json({ error: 'Die Rechnungsfunktion ist derzeit deaktiviert.' });
    }

    try {
        const page = Math.min(10000, Math.max(1, Math.trunc(Number(req.query.page) || 1)));
        const pendingPage = Math.min(10000, Math.max(1, Math.trunc(Number(req.query.pendingPage) || 1)));
        const search = String(req.query.orderNumber || '').trim().slice(0, 50);
        const invoiceQuery = search ? { orderReference: search } : {};
        const [invoices, pendingOrders] = await Promise.all([
            Invoice.find(invoiceQuery).select('-pdfData').sort({ issuedAt: -1, _id: -1 }).skip((page - 1) * 50).limit(51).lean(),
            Order.find(getMissingInvoiceOrderQuery())
                .select('date orderNumber email name amount currency address status paymentStatus paidAt shippedAt statusUpdatedAt invoiceStatus invoiceError')
                .sort({ date: 1, _id: 1 }).skip((pendingPage - 1) * 50).limit(51)
                .lean()
        ]);

        const serializedInvoices = invoices.slice(0, 50).map(serializeInvoice);
        const pending = pendingOrders.slice(0, 50).map(serializePendingInvoiceOrder);
        const totalGrossCents = serializedInvoices
            .filter(invoice => invoice.status === 'issued')
            .reduce((sum, invoice) => sum + Number(invoice.totalGrossCents || 0), 0);
        const totalTaxCents = serializedInvoices
            .filter(invoice => invoice.status === 'issued')
            .reduce((sum, invoice) => sum + Number(invoice.totalTaxCents || 0), 0);

        return res.json({
            invoices: serializedInvoices,
            page, pendingPage, hasMore: invoices.length > 50, pendingHasMore: pendingOrders.length > 50,
            pending,
            summary: {
                scope: 'Angezeigte Seite',
                issuedCount: serializedInvoices.filter(invoice => invoice.status === 'issued').length,
                pendingCount: pending.length,
                awaitingServiceDateCount: pending.filter(item => item.invoiceStatus === 'awaiting_service_date').length,
                manualReviewCount: pending.filter(item => item.invoiceStatus === 'manual_review').length,
                errorCount: pending.filter(item => item.invoiceStatus === 'error').length,
                totalGrossCents,
                totalTaxCents
            },
            config: {
                ...getPublicInvoiceConfig(),
                orderNumbers: getPublicOrderNumberConfig()
            }
        });
    } catch (error) {
        console.error('[Invoice] Admin-Liste konnte nicht geladen werden:', error);
        return res.status(500).json({ error: 'Rechnungen konnten nicht geladen werden.' });
    }
});

app.get('/api/admin/invoices/:id/pdf', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    if (!INVOICES_ENABLED) {
        return res.status(404).json({ error: 'Die Rechnungsfunktion ist derzeit deaktiviert.' });
    }

    try {
        const invoice = await Invoice.findById(req.params.id).select('+pdfData');
        if (!invoice || !invoice.pdfData) {
            return res.status(404).json({ error: 'Rechnungs-PDF nicht gefunden.' });
        }
        const disposition = req.query.download === '1' ? 'attachment' : 'inline';
        const safeFileName = String(invoice.pdfFileName || `Rechnung_${invoice.number}.pdf`)
            .replace(/[^A-Za-z0-9_.-]/g, '_');
        const pdfBuffer = Buffer.isBuffer(invoice.pdfData)
            ? invoice.pdfData
            : Buffer.from(invoice.pdfData.buffer || invoice.pdfData);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', String(pdfBuffer.length));
        res.setHeader('Content-Disposition', `${disposition}; filename="${safeFileName}"`);
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        return res.send(pdfBuffer);
    } catch (error) {
        if (error && error.name === 'CastError') {
            return res.status(400).json({ error: 'Ungültige Rechnungs-ID.' });
        }
        console.error('[Invoice] PDF konnte nicht geladen werden:', error);
        return res.status(500).json({ error: 'Rechnungs-PDF konnte nicht geladen werden.' });
    }
});

app.post('/api/admin/invoices/backfill', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    if (!INVOICES_ENABLED) {
        return res.status(404).json({ error: 'Die Rechnungsfunktion ist derzeit deaktiviert.' });
    }
    if (LOCAL_DEV_SAFE_MODE) {
        return res.status(409).json({
            error: 'Der historische Stripe-Abgleich ist im lokalen Safe-Mode absichtlich deaktiviert.'
        });
    }

    const requestedLimit = Number.parseInt(req.body && req.body.limit, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const cursor = cleanInvoiceText(req.body && req.body.cursor, 80);
    if (cursor && !mongoose.Types.ObjectId.isValid(cursor)) {
        return res.status(400).json({ error: 'Ungültiger Abgleich-Cursor.' });
    }

    try {
        const missingInvoiceQuery = getMissingInvoiceOrderQuery();
        const query = cursor
            ? { $and: [missingInvoiceQuery, { _id: { $gt: new mongoose.Types.ObjectId(cursor) } }] }
            : missingInvoiceQuery;
        const orders = await Order.find(query).sort({ _id: 1 }).limit(limit);
        const summary = {
            checked: 0,
            generated: 0,
            existing: 0,
            awaitingPayment: 0,
            awaitingServiceDate: 0,
            manualReview: 0,
            errors: 0
        };
        const results = [];

        for (const order of orders) {
            summary.checked += 1;
            try {
                const result = await ensureInvoiceForOrder({
                    order,
                    stripeClient: stripe,
                    generatedBy: 'admin_historical_backfill'
                });
                if (result.status === 'generated') summary.generated += 1;
                else if (result.status === 'existing') summary.existing += 1;
                else if (result.status === 'awaiting_payment') summary.awaitingPayment += 1;
                else if (result.status === 'awaiting_service_date') summary.awaitingServiceDate += 1;
                else if (result.status === 'manual_review') summary.manualReview += 1;
                results.push({
                    orderId: String(order._id),
                    status: result.status,
                    invoiceNumber: result.invoice ? result.invoice.number : '',
                    reason: result.reason || order.invoiceError || ''
                });
            } catch (error) {
                summary.errors += 1;
                results.push({
                    orderId: String(order._id),
                    status: 'error',
                    reason: cleanInvoiceText(error.message, 500)
                });
            }
        }

        return res.json({
            success: true,
            summary,
            results,
            remainingMayExist: orders.length === limit,
            nextCursor: orders.length ? String(orders[orders.length - 1]._id) : ''
        });
    } catch (error) {
        console.error('[Invoice] Historischer Abgleich fehlgeschlagen:', error);
        return res.status(500).json({ error: 'Historischer Rechnungsabgleich fehlgeschlagen.' });
    }
});

app.post('/api/admin/invoices/orders/:orderId/generate', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    if (!INVOICES_ENABLED) {
        return res.status(404).json({ error: 'Die Rechnungsfunktion ist derzeit deaktiviert.' });
    }
    if (LOCAL_DEV_SAFE_MODE) {
        return res.status(409).json({
            error: 'Die Stripe-Rechnungserzeugung ist im lokalen Safe-Mode absichtlich deaktiviert.'
        });
    }

    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
        if (!order.stripeSessionId) {
            return res.status(400).json({ error: 'Nur bestätigte Stripe-Zahlungen können hier verarbeitet werden.' });
        }

        const serviceDate = asInvoiceDate(req.body && req.body.serviceDate);
        if (!serviceDate) {
            return res.status(400).json({ error: 'Bitte ein gültiges Leistungs-/Versanddatum angeben.' });
        }
        if (serviceDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
            return res.status(400).json({ error: 'Das Leistungsdatum darf nicht in der Zukunft liegen.' });
        }

        let taxRateBps;
        if (req.body && req.body.taxRate !== undefined && req.body.taxRate !== '') {
            const taxRate = Number(req.body.taxRate);
            if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 30) {
                return res.status(400).json({ error: 'Der Umsatzsteuersatz ist ungültig.' });
            }
            taxRateBps = Math.round(taxRate * 100);
        }
        const taxExemptionNote = cleanInvoiceText(req.body && req.body.taxExemptionNote, 300);
        if (taxRateBps === 0 && !taxExemptionNote) {
            return res.status(400).json({
                error: 'Bei 0 % Umsatzsteuer ist ein konkreter Steuerbefreiungshinweis erforderlich.'
            });
        }

        order.shippedAt = serviceDate;
        await order.save();
        const result = await ensureInvoiceForOrder({
            order,
            stripeClient: stripe,
            serviceDate,
            serviceDateSource: 'admin_confirmed_historical_date',
            taxRateBps,
            taxExemptionNote,
            generatedBy: 'admin_manual_completion'
        });
        if (!result.invoice) {
            return res.status(409).json({
                error: result.reason || 'Die Rechnung konnte noch nicht finalisiert werden.',
                status: result.status
            });
        }
        return res.status(result.status === 'generated' ? 201 : 200).json({
            success: true,
            status: result.status,
            invoice: serializeInvoice(result.invoice)
        });
    } catch (error) {
        if (error && error.name === 'CastError') {
            return res.status(400).json({ error: 'Ungültige Bestell-ID.' });
        }
        console.error('[Invoice] Manuelle Erzeugung fehlgeschlagen:', error);
        return res.status(500).json({ error: cleanInvoiceText(error.message, 500) || 'Rechnung konnte nicht erzeugt werden.' });
    }
});

require('./routes/orderActions').registerOrderActions(app, {
    Order, isAdmin, adminWriteLimiter, requireTrustedOrigin, requireCsrfToken,
    ensureOrderNumber, sanitizeTrackingUrl, resend, buildShippingEmailPayload,
    buildPickupReadyEmailPayload, ensureInvoiceForOrder, INVOICES_ENABLED, stripe
});
app.post('/admin/logout', (req, res) => res.status(410).send('Diese Abmelderoute wurde entfernt.'));

app.get('/admin', (req, res) => res.status(410).send('Diese Verwaltungsroute wurde entfernt.'));

const SUMMER_BUNDLE_CONFIG = Object.freeze({
    30: Object.freeze({ priceCents: 6900, originalPriceCents: 10497 }),
    50: Object.freeze({ priceCents: 9900, originalPriceCents: 13497 })
});

const AUTODUFT_PRODUCT_ID = 'AUTODUFT';
const AUTODUFT_PRICE_VARIANT = '30';

async function resolveAutoduftItem(item) {
    const match = String(item && item.id || '').trim().toUpperCase().match(/^AUTODUFT-([GL]\d{1,4})$/);
    if (!match) return null;

    const scentId = match[1];
    const [autoduftProduct, scentProduct] = await Promise.all([
        Product.findOne({ id: AUTODUFT_PRODUCT_ID }),
        Product.findOne({ id: scentId })
    ]);

    const priceVariant = autoduftProduct && autoduftProduct.variants
        ? autoduftProduct.variants[AUTODUFT_PRICE_VARIANT]
        : null;
    const price = priceVariant ? Number(priceVariant.price) : NaN;

    if (!autoduftProduct || !Number.isFinite(price) || price <= 0) {
        const error = new Error('Der Autoduft ist derzeit nicht verfügbar.');
        error.statusCode = 404;
        throw error;
    }

    if (!scentProduct || !['men', 'women'].includes(String(scentProduct.category || ''))) {
        const error = new Error(`Die gewählte Duftfüllung ${scentId} ist nicht verfügbar.`);
        error.statusCode = 404;
        throw error;
    }

    const scentName = publicProductNames[scentId] || scentProduct.name || scentId;
    return {
        product: autoduftProduct,
        scentProduct,
        scentId,
        scentName,
        priceCents: Math.round(price * 100),
        checkoutName: `${autoduftProduct.name || 'NØTE. Autoduft'} · ${scentId} Duftnote`,
        checkoutDescription: `Duftfüllung: ${scentName}`
    };
}

async function resolveSummerBundleItem(item, size) {
    const config = SUMMER_BUNDLE_CONFIG[size];
    if (!config) return null;

    const selectionIds = Array.isArray(item.bundleSelections)
        ? item.bundleSelections.map((id) => String(id || '').trim().toUpperCase())
        : [];
    if (
        selectionIds.length !== 3
        || new Set(selectionIds).size !== 3
        || selectionIds.some((id) => !/^[A-Z0-9_-]{1,32}$/.test(id))
    ) {
        const error = new Error('Bitte wähle genau drei unterschiedliche Düfte für das Sommerbundle.');
        error.statusCode = 400;
        throw error;
    }

    const products = await Product.find({ id: { $in: selectionIds } });
    const productsById = new Map(products.map((product) => [String(product.id || '').toUpperCase(), product]));
    const selectedProducts = selectionIds.map((id) => productsById.get(id));
    if (selectedProducts.some((product) => !product || !product.variants || !product.variants[size])) {
        const error = new Error('Mindestens ein gewählter Bundle-Duft ist in dieser Größe nicht verfügbar.');
        error.statusCode = 404;
        throw error;
    }

    return {
        ...config,
        size,
        selectionIds,
        selectedProducts,
        pricePerBottleCents: config.priceCents / 3
    };
}

const checkoutService = require('./services/checkoutService').createCheckoutService({ stripe, onCompleted: session => webhookService.receive({ id: `reconcile:${session.id}:${session.payment_status}`, type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), livemode: session.livemode, data: { object: { id: session.id } } }) });
const cartService = require('./services/cartService').createCartService({
    Product, resolveAutoduftItem, resolveSummerBundleItem, sanitizeQuantity,
    mapSupplier: product => {
        const prefix = String(product.id || '').startsWith('G') ? 'M' : String(product.id || '').startsWith('L') ? 'W' : '';
        return prefix && product.inspiredBy ? findBestSupplierMatchByInspiredBy(product.inspiredBy, prefix)?.supplierId : '';
    }
});
require('./routes/checkout').registerCheckoutRoutes(app, {
    Order, User, cartService, checkoutService, checkoutLimiter, requireTrustedOrigin,
    requireCsrfToken, sanitizeEmail, sanitizeText, allocateOrderNumber, resend,
    buildFrontendPageUrl, buildPickupOrderConfirmationEmailPayload,
    buildPickupOrderInternalEmailPayload, INTERNAL_ORDER_NOTIFICATION_EMAIL, CHECKOUT_DRY_RUN
});

let publicCatalogCache = null;
app.get('/api/products', async (req, res) => {
    if (!productCache || Date.now() - catalogLoadedAt > 60000) await refreshProductCache();
    if (!publicCatalogCache || publicCatalogCache.loadedAt !== catalogLoadedAt || Date.now() - publicCatalogCache.at > 60000) {
        const summaries = await buildReviewSummaryMap(productCache.map(product => product.id));
        const { publicProduct } = require('./services/publicProduct');
        publicCatalogCache = { loadedAt: catalogLoadedAt, at: Date.now(), products: productCache.map(product => publicProduct(product, summaries[product.id])) };
    }
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30').json(publicCatalogCache.products);
});

// Fallback Error-Handler: keine internen Details an den Client leaken
app.use((err, req, res, next) => {
    if (Number(err.status || err.statusCode || 500) >= 500) console.error('Request failed:', err.name, err.message);
    if (res.headersSent) return next(err);
    const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : Number(err.status || err.statusCode);
    res.status(status >= 400 && status < 500 ? status : 500).json({ error: status >= 400 && status < 500 ? err.message : 'Interner Serverfehler.', ...(err.code === 'CHECKOUT_RESTART' ? { code: err.code } : {}) });
});

app.locals.refreshProductCache = refreshProductCache;
app.locals.notificationService = require('./services/notificationService').createNotificationService({
    Order, resend, internalEmail: INTERNAL_ORDER_NOTIFICATION_EMAIL,
    builders: { shipping: buildShippingEmailPayload, order: buildOrderConfirmationEmailPayload, pickup: buildPickupOrderConfirmationEmailPayload, pickupInternal: buildPickupOrderInternalEmailPayload }
});
app.locals.mailService = resend;
app.locals.webhookService = webhookService;
app.locals.checkoutService = checkoutService;
app.locals.invoiceRepairService = require('./services/invoiceRepairService').createInvoiceRepairService({ stripe, enabled: INVOICES_ENABLED });
return app;
}
module.exports = { createApp };
