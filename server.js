require('dotenv').config();
const express = require('express');
const path = require('path');
require('dotenv').config({
    path: process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '.env'),
    // Hosting-Umgebungsvariablen dürfen nicht von lokaler .env überschrieben werden.
    override: false
});
const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Review = require('./models/Review');
const Subscriber = require('./models/Subscriber');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
const LOCAL_DEV_SAFE_MODE = process.env.LOCAL_DEV_SAFE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (LOCAL_DEV_SAFE_MODE) {
    const mongoUri = process.env.MONGO_URI || '';
    const isLocalMongoUri = /^mongodb(?:\+srv)?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//i.test(mongoUri);

    if (!isLocalMongoUri) {
        throw new Error('LOCAL_DEV_SAFE_MODE darf nur mit einer lokalen MongoDB verwendet werden. Bitte nutze z. B. mongodb://127.0.0.1:27017/note-localtest');
    }
}

mongoose.connect(process.env.MONGO_URI, {
}).then(() => {
    console.log('MongoDB connected');
    refreshProductCache(); // Initial cache load
}).catch(err => console.log('MongoDB connection error:', err));

const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN_COOKIE = 'admin_token';
const USER_TOKEN_COOKIE = 'auth_token';
const CSRF_TOKEN_COOKIE = 'csrf_token';
const PORT = Number(process.env.PORT || 4242);
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || (IS_PRODUCTION ? 'https://note-backend-5gy0.onrender.com' : 'http://localhost:4242');
const FRONTEND_PUBLIC_URL = process.env.FRONTEND_PUBLIC_URL || (IS_PRODUCTION ? 'https://note-fragrances.de' : 'http://localhost:5500');
const EXPECTS_LIVE_STRIPE_MODE = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
const APP_STARTED_AT = Date.now();
const TRUSTED_BROWSER_ORIGINS = Array.from(new Set([
    ...(IS_PRODUCTION ? [] : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500'
    ]),
    'https://keen-mooncake-5c73e2.netlify.app',
    'https://note-fragrances.de',
    'https://www.note-fragrances.de',
    ...String(process.env.TRUSTED_BROWSER_ORIGINS || '')
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
    if (normalized.startsWith('sk_test_') || normalized.startsWith('sk_live_')) return false;
    if (normalized.startsWith('pk_test_') || normalized.startsWith('pk_live_')) return false;
    if (normalized.startsWith('whsec_')) return false;
    if (normalized.startsWith('re_')) return false;
    return normalized.includes('placeholder')
        || normalized.includes('change-me')
        || normalized.includes('example');
}

if (IS_PRODUCTION) {
    const requiredProdEnv = [
        ['MONGO_URI', process.env.MONGO_URI],
        ['JWT_SECRET', process.env.JWT_SECRET],
        ['ADMIN_PASSWORD', process.env.ADMIN_PASSWORD],
        ['STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY],
        ['STRIPE_WEBHOOK_SECRET', process.env.STRIPE_WEBHOOK_SECRET],
        ['RESEND_API_KEY', process.env.RESEND_API_KEY],
        ['FRONTEND_PUBLIC_URL', process.env.FRONTEND_PUBLIC_URL],
        ['BACKEND_PUBLIC_URL', process.env.BACKEND_PUBLIC_URL]
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
}

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Anfragen. Bitte versuche es in ein paar Minuten erneut.' }
});

const adminAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Admin-Anfragen. Bitte versuche es später erneut.' }
});

const formLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Formularanfragen. Bitte versuche es später erneut.' }
});

const newsletterLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Newsletter-Anmeldungen. Bitte versuche es später erneut.' }
});

const couponLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Gutschein-Prüfungen. Bitte versuche es später erneut.' }
});

const reviewLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Bewertungsanfragen. Bitte später erneut versuchen.' }
});

const viewLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Live-View-Anfragen. Bitte kurz warten.' }
});

const adminWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Admin-Schreibanfragen. Bitte kurz warten.' }
});

const SECURITY_MONITOR_INTERVAL_MS = Number(process.env.SECURITY_MONITOR_INTERVAL_MS || 300000);
const SECURITY_MONITOR_HISTORY_LIMIT = 25;
const JSON_PARSE_ERROR_WINDOW_MS = 10 * 60 * 1000;
const DEPENDENCY_SCAN_INTERVAL_MS = Number(process.env.DEPENDENCY_SCAN_INTERVAL_MS || 24 * 60 * 60 * 1000);
const DEPENDENCY_SCAN_TIMEOUT_MS = Number(process.env.DEPENDENCY_SCAN_TIMEOUT_MS || 120000);
const OSV_BATCH_URL = process.env.OSV_BATCH_URL || 'https://api.osv.dev/v1/querybatch';
const OSV_BATCH_SIZE = Number(process.env.OSV_BATCH_SIZE || 100);
const OSV_SCAN_TIMEOUT_MS = Number(process.env.OSV_SCAN_TIMEOUT_MS || 120000);
const CSRF_TOKEN_MEMORY_TTL_MS = Number(process.env.CSRF_TOKEN_MEMORY_TTL_MS || 2 * 60 * 60 * 1000);
const recentJsonParseErrorTimestamps = [];
const issuedCsrfTokens = new Map();

function pruneIssuedCsrfTokens(now = Date.now()) {
    for (const [token, expiresAt] of issuedCsrfTokens.entries()) {
        if (!expiresAt || expiresAt <= now) {
            issuedCsrfTokens.delete(token);
        }
    }
}

function rememberCsrfToken(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return;
    const now = Date.now();
    pruneIssuedCsrfTokens(now);
    issuedCsrfTokens.set(normalized, now + CSRF_TOKEN_MEMORY_TTL_MS);
}

function hasRememberedCsrfToken(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return false;
    const now = Date.now();
    const expiresAt = issuedCsrfTokens.get(normalized);
    if (!expiresAt) return false;
    if (expiresAt <= now) {
        issuedCsrfTokens.delete(normalized);
        return false;
    }
    return true;
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

function sanitizeCategory(value) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    if (!normalized) return '';
    if (!['women', 'men', 'unisex'].includes(normalized)) return '';
    return normalized;
}

function sanitizeProductId(value) {
    const normalized = sanitizeText(value, 40).toUpperCase();
    if (!/^[A-Z0-9_-]{1,40}$/.test(normalized)) return '';
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
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
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

function generateCsrfToken() {
    return crypto.randomBytes(24).toString('hex');
}

function getAdminCookieOptions() {
    return {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: IS_PRODUCTION ? 'None' : 'Lax',
        maxAge: 3600 * 1000,
        path: '/'
    };
}

function getUserCookieOptions() {
    return {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: IS_PRODUCTION ? 'None' : 'Lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
    };
}

function getCsrfCookieOptions() {
    return {
        httpOnly: false,
        secure: IS_PRODUCTION,
        sameSite: IS_PRODUCTION ? 'None' : 'Lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
    };
}

async function findValidCoupon(code) {
    if (!code) return null;

    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return null;

    const subscriber = await Subscriber.findOne({
        code: normalizedCode,
        used: false,
        $or: [
            { status: 'active' },
            { status: { $exists: false } }
        ]
    });
    if (!subscriber) {
        return null;
    }

    return subscriber;
}

function generateConfirmationToken() {
    return crypto.randomBytes(24).toString('hex');
}

async function generateNewsletterCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = 'NOTE-' + Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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

function renderBrandEmail({ badge, title, introHtml, iconHtml = '', iconImageUrl = '', bodyHtml = '', ctaHtml = '', afterBodyHtml = '' }) {
    const safeTopWaveUrl = sanitizeTrackingUrl(EMAIL_WAVE_TOP_IMAGE_URL);
    const safeBottomWaveUrl = sanitizeTrackingUrl(EMAIL_WAVE_BOTTOM_IMAGE_URL);
    const safeIconImageUrl = sanitizeTrackingUrl(iconImageUrl);
    const iconMarkup = safeIconImageUrl
        ? `<img src="${safeIconImageUrl}" width="62" height="62" alt="" style="display:block;width:62px;height:62px;border:0;outline:none;text-decoration:none;margin:0 auto 22px;">`
        : (iconHtml
            ? `<div style="display:inline-block;width:62px;height:62px;border-radius:50%;border:1.5px solid #d4af37;line-height:60px;font-size:22px;color:#d4af37;margin-bottom:22px;">${iconHtml}</div>`
            : '');

    return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#e2dfd8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e2dfd8;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td style="background:#f5f3ee;padding:0;line-height:0;font-size:0;">
        <img src="${safeTopWaveUrl}" width="560" height="46" alt="" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;">
      </td></tr>
      <tr><td style="background:#f5f3ee;padding:18px 48px 14px;text-align:center;">
        <p style="margin:0 0 5px;font-family:Georgia,serif;color:#000000;font-size:30px;letter-spacing:0.12em;font-weight:400;">N&Oslash;TE.</p>
        <table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
          <tr>
            <td style="width:32px;font-size:0;line-height:0;overflow:hidden;border-top:1px solid #333333;">&nbsp;</td>
            <td style="font-family:Arial,sans-serif;font-size:9px;color:#333333;letter-spacing:0.28em;text-transform:uppercase;padding:0 8px;">fragrances</td>
            <td style="width:32px;font-size:0;line-height:0;overflow:hidden;border-top:1px solid #333333;">&nbsp;</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="height:2px;background:#d4af37;"></td></tr>
      <tr><td style="background:#f5f3ee;padding:48px 48px 40px;text-align:center;">
        ${iconMarkup}
        <p style="margin:0 0 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#d4af37;font-weight:700;">${badge}</p>
        <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:28px;color:#1a1a1a;font-weight:400;">${title}</h1>
        <div style="margin:0 auto;font-size:13px;color:#666;line-height:1.8;max-width:400px;">${introHtml}</div>
      </td></tr>
      ${bodyHtml}
      ${ctaHtml ? `<tr><td style="background:#f5f3ee;padding:0 48px 34px;text-align:center;">${ctaHtml}</td></tr>` : ''}
      ${afterBodyHtml}
      <tr><td style="background:#f5f3ee;padding:0;line-height:0;font-size:0;">
        <img src="${safeBottomWaveUrl}" width="560" height="104" alt="" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:560px;height:auto;">
      </td></tr>
      <tr><td style="background:#0f0f0f;border-bottom:1px solid #d4af37;padding:22px 36px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
          <tr>
            <td colspan="4" style="text-align:center;padding:0 0 16px;">
              <p style="margin:0 0 6px;font-family:Georgia,serif;color:#ffffff;font-size:26px;letter-spacing:0.12em;">N&Oslash;TE.</p>
              <table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td style="width:34px;font-size:0;line-height:0;border-top:1px solid #d4af37;">&nbsp;</td>
                  <td style="font-family:Arial,sans-serif;font-size:9px;color:#d4af37;letter-spacing:0.28em;text-transform:uppercase;padding:0 10px;">fragrances</td>
                  <td style="width:34px;font-size:0;line-height:0;border-top:1px solid #d4af37;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td width="25%" valign="top" style="padding:0 10px 12px 0;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Rechtliches</p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/agb.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">AGB</a></p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/impressum.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Impressum</a></p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/widerrufsrecht.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Widerruf</a></p>
              <p style="margin:0;"><a href="https://note-fragrances.de/datenschutz.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Datenschutz</a></p>
            </td>
            <td width="25%" valign="top" style="padding:0 10px 12px;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Shop</p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/suche.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Kollektion</a></p>
              <p style="margin:0 0 7px;"><a href="https://note-fragrances.de/frauenduefte.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Frauenduefte</a></p>
              <p style="margin:0;"><a href="https://note-fragrances.de/herrenduefte.html" style="color:#a0a0a0;text-decoration:none;font-size:12px;">Herrenduefte</a></p>
            </td>
            <td width="30%" valign="top" style="padding:0 10px 12px;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Ueber Uns</p>
              <p style="margin:0;color:#a0a0a0;font-size:12px;line-height:1.6;">Exklusive Extrait de Parfums mit hoher Duftoel-Konzentration. Intensiv, langanhaltend und kompromisslos in der Qualitaet.</p>
            </td>
            <td width="20%" valign="top" style="padding:0 0 12px 10px;">
              <p style="margin:0 0 10px;color:#f1eee8;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Service</p>
              <p style="margin:0 0 7px;"><a href="mailto:info@note-fragrances.de" style="color:#a0a0a0;text-decoration:none;font-size:12px;">info@note-fragrances.de</a></p>
              <p style="margin:0;color:#a0a0a0;font-size:12px;">Warnitzer Str. 20<br>13057 Berlin</p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(255,255,255,0.16);padding-top:16px;">
          <tr>
            <td style="font-size:11px;color:#767676;text-align:center;">&copy; 2026 N&Oslash;TE. fragrances. Alle Rechte vorbehalten.</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function formatEuroFromCents(amountCents) {
    const normalized = Number.isFinite(Number(amountCents)) ? Number(amountCents) : 0;
    return (Math.max(0, normalized) / 100).toFixed(2).replace('.', ',');
}

function formatAddressHtml(address) {
    if (!address || typeof address !== 'object') {
        return '&ndash;';
    }

    const line1 = escapeHtml(address.line1 || '');
    const line2 = escapeHtml(address.line2 || '');
    const postalCode = escapeHtml(address.postal_code || '');
    const city = escapeHtml(address.city || '');
    const country = escapeHtml(address.country || '');
    const middleLine = [postalCode, city].filter(Boolean).join(' ');
    const lines = [line1];
    if (line2) lines.push(line2);
    if (middleLine) lines.push(middleLine);
    if (country) lines.push(country);
    const rendered = lines.filter(Boolean).join('<br>');
    return rendered || '&ndash;';
}

function buildEmailItemsHtml(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return '<p style="color:#999;font-size:13px;">&ndash;</p>';
    }

    return items.map((item, index) => {
        const safeDescription = escapeHtml(item.description || '');
        const safeImageUrl = sanitizeTrackingUrl(item.imageUrl || '');
        const qty = Number.isFinite(Number(item.quantity))
            ? Math.max(1, Math.floor(Number(item.quantity)))
            : 1;
        const amountText = escapeHtml(String(item.amountText || '0,00'));
        const isLast = index === items.length - 1;
        const rowBorder = isLast ? 'border-bottom:none;' : 'border-bottom:1px solid #e6e6e6;';
        const imageBlock = safeImageUrl
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:60px;height:60px;border:1px solid #e6e6e6;border-radius:4px;background:#ffffff;"><tr><td align="center" valign="middle" style="width:60px;height:60px;padding:0;">
<img src="${safeImageUrl}" alt="${safeDescription}" style="display:block;border:0;outline:none;text-decoration:none;width:auto;height:auto;max-width:60px;max-height:60px;">
</td></tr></table>`
            : '<div style="width:60px;height:60px;background:#f0ede8;border-radius:4px;border:1px solid #e6e6e6;display:inline-block;"></div>';

        return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;padding-bottom:16px;${rowBorder}">
  <tr>
    <td style="width:70px;vertical-align:middle;">${imageBlock}</td>
    <td style="padding-left:14px;vertical-align:middle;font-family:'Inter',Arial,sans-serif;">
      <p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:500;">${safeDescription}</p>
      <p style="margin:3px 0 0;font-size:12px;color:#999999;">Menge: ${qty}</p>
    </td>
    <td style="text-align:right;vertical-align:middle;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#1a1a1a;font-weight:500;white-space:nowrap;">${amountText} &euro;</td>
  </tr>
</table>`;
    }).join('');
}

function buildOrderConfirmationEmailPayload({
    customerName = 'Kunde',
    items = [],
    shippingCostCents = null,
    discountAmountCents = 0,
    couponCode = '',
    totalAmountCents = 0,
    address = null
}) {
    const safeCustomerName = escapeHtml(customerName || 'Kunde');
    const safeCouponCode = escapeHtml(couponCode || '');
    const shippingText = Number.isFinite(Number(shippingCostCents))
        ? `${formatEuroFromCents(shippingCostCents)} &euro;`
        : 'Kostenlos';
    const discountHtml = Number(discountAmountCents) > 0
        ? `<tr>
  <td style="font-size:13px;color:#7f776a;padding-top:8px;">Rabatt${safeCouponCode ? ` (${safeCouponCode})` : ''}</td>
  <td style="text-align:right;font-size:13px;color:#7f776a;padding-top:8px;">-${formatEuroFromCents(discountAmountCents)} &euro;</td>
</tr>`
        : '';
    const itemsHtml = buildEmailItemsHtml(items);
    const addressHtml = formatAddressHtml(address);

    return {
        subject: 'Deine Bestellung bei NOTE. fragrances \u2713',
        html: renderBrandEmail({
            badge: 'Bestellbestaetigung',
            title: `Vielen Dank, ${safeCustomerName}!`,
            introHtml: 'Deine Bestellung ist bei uns eingegangen und wird schnellstmoeglich bearbeitet. Wir melden uns, sobald dein Paket auf dem Weg ist.',
            iconImageUrl: EMAIL_ICON_CHECK_IMAGE_URL,
            bodyHtml: `<tr><td style="background:#f5f3ee;padding:26px 40px 0;">
  <div style="border-top:1px solid #dfd8ca;padding-top:18px;">
    <p style="margin:0 0 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#9d9688;font-weight:700;">Deine Bestellung</p>
    ${itemsHtml}
  </div>
</td></tr>
<tr><td style="background:#f5f3ee;padding:0 40px 10px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0e8;border:1px solid #e0dacd;border-left:3px solid #d4af37;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="padding:14px 16px 6px;font-size:10px;color:#8f887a;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">Lieferadresse</td>
    </tr>
    <tr>
      <td style="padding:0 16px 14px;font-size:14px;color:#2f2f2f;line-height:1.6;">${addressHtml}</td>
    </tr>
  </table>
</td></tr>
<tr><td style="background:#f5f3ee;padding:0 40px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;background:#f3f0e8;border:1px solid #e0dacd;border-radius:8px;padding:10px 14px;">
    <tr>
      <td style="font-size:13px;color:#7f776a;">Versand</td>
      <td style="text-align:right;font-size:13px;color:#7f776a;">${shippingText}</td>
    </tr>
    ${discountHtml}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #d4af37;padding-top:14px;margin-top:2px;">
    <tr>
      <td style="font-size:11px;color:#8f887a;text-transform:uppercase;letter-spacing:0.15em;vertical-align:bottom;">Gesamtbetrag</td>
      <td style="text-align:right;font-family:Georgia,serif;font-size:26px;color:#1a1a1a;font-weight:400;vertical-align:bottom;">${formatEuroFromCents(totalAmountCents)} &euro;</td>
    </tr>
  </table>
</td></tr>`,
            afterBodyHtml: `<tr><td style="background:#f5f3ee;padding:32px 48px 40px;text-align:center;">
  <p style="margin:0 0 6px;font-size:13px;color:#888;">Fragen zu deiner Bestellung?</p>
  <a href="mailto:info@note-fragrances.de" style="font-size:14px;color:#000;font-weight:700;text-decoration:none;">info@note-fragrances.de</a>
</td></tr>`
        })
    };
}

function buildPickupOrderConfirmationEmailPayload({
    customerName = 'Kunde',
    items = [],
    discountAmountCents = 0,
    couponCode = '',
    totalAmountCents = 0
}) {
    const safeCustomerName = escapeHtml(customerName || 'Kunde');
    const safeCouponCode = escapeHtml(couponCode || '');
    const itemsHtml = buildEmailItemsHtml(items);
    const discountHtml = Number(discountAmountCents) > 0
        ? `<tr>
  <td style="font-size:13px;color:#7f776a;padding-top:8px;">Rabatt${safeCouponCode ? ` (${safeCouponCode})` : ''}</td>
  <td style="text-align:right;font-size:13px;color:#7f776a;padding-top:8px;">-${formatEuroFromCents(discountAmountCents)} &euro;</td>
</tr>`
        : '';

    return {
        subject: 'Deine Abhol-Bestellung bei NOTE. fragrances \u2713',
        html: renderBrandEmail({
            badge: 'Bestellbestaetigung',
            title: `Vielen Dank, ${safeCustomerName}!`,
            introHtml: 'Deine Bestellung zur <strong>Selbstabholung</strong> ist bei uns eingegangen und wird fuer dich bereitgestellt. Wir melden uns per E-Mail, sobald du sie im Store abholen kannst.',
            iconImageUrl: EMAIL_ICON_CHECK_IMAGE_URL,
            bodyHtml: `<tr><td style="background:#f5f3ee;padding:26px 40px 0;">
  <div style="border-top:1px solid #dfd8ca;padding-top:18px;">
    <p style="margin:0 0 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#9d9688;font-weight:700;">Deine Bestellung</p>
    ${itemsHtml}
  </div>
</td></tr>
<tr><td style="background:#f5f3ee;padding:0 40px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;background:#f3f0e8;border:1px solid #e0dacd;border-radius:8px;padding:10px 14px;">
    <tr>
      <td style="font-size:13px;color:#7f776a;">Versandart</td>
      <td style="text-align:right;font-size:13px;color:#7f776a;">Selbstabholung</td>
    </tr>
    <tr>
      <td style="font-size:13px;color:#7f776a;padding-top:8px;">Zahlungsart</td>
      <td style="text-align:right;font-size:13px;color:#7f776a;padding-top:8px;">Bar bei Abholung</td>
    </tr>
    ${discountHtml}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #d4af37;padding-top:14px;margin-top:2px;">
    <tr>
      <td style="font-size:11px;color:#8f887a;text-transform:uppercase;letter-spacing:0.15em;vertical-align:bottom;">Gesamtbetrag (Bar)</td>
      <td style="text-align:right;font-family:Georgia,serif;font-size:26px;color:#1a1a1a;font-weight:400;vertical-align:bottom;">${formatEuroFromCents(totalAmountCents)} &euro;</td>
    </tr>
  </table>
</td></tr>`,
            afterBodyHtml: `<tr><td style="background:#f5f3ee;padding:32px 48px 40px;text-align:center;">
  <p style="margin:0 0 6px;font-size:13px;color:#888;">Fragen zu deiner Bestellung?</p>
  <a href="mailto:info@note-fragrances.de" style="font-size:14px;color:#000;font-weight:700;text-decoration:none;">info@note-fragrances.de</a>
</td></tr>`
        })
    };
}

function buildShippingEmailPayload({ customerName = 'du', trackingUrl = '' }) {
    const safeOrderName = escapeHtml(customerName || 'du');
    const safeTrackingUrl = sanitizeTrackingUrl(trackingUrl);
    const trackingBlock = safeTrackingUrl
        ? `<table border="0" cellpadding="0" cellspacing="0" style="margin:12px auto 0;border-collapse:collapse;"><tr><td style="background:#d4af37;border-radius:2px;padding:14px 32px;"><a href="${safeTrackingUrl}" style="font-family:Arial,sans-serif;font-size:12px;color:#000;text-decoration:none;letter-spacing:0.15em;text-transform:uppercase;font-weight:700;">&#128269;&nbsp;Sendung verfolgen</a></td></tr></table>`
        : '';

    return {
        subject: 'Deine Bestellung ist unterwegs! \u{1F4E6}',
        html: renderBrandEmail({
            badge: 'Auf dem Weg zu dir',
            title: `Hallo ${safeOrderName}!`,
            introHtml: 'Gute Neuigkeiten &ndash; deine Bestellung ist soeben auf dem Weg zu dir!<br><br>Du kannst deinen Duft in den naechsten <strong style="color:#000;">1&ndash;3 Werktagen</strong> erwarten.<br><br>Wir wuenschen dir viel Freude mit deinem neuen Extrait de Parfum.',
            iconHtml: '&#128230;',
            ctaHtml: `<table border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
  <tr>
    <td style="background:#1a1a1a;border-radius:2px;padding:14px 32px;">
      <a href="https://note-fragrances.de" style="font-family:Arial,sans-serif;font-size:12px;color:#ffffff;text-decoration:none;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;">Zur Website</a>
    </td>
  </tr>
</table>
${trackingBlock}`
        })
    };
}

function buildPickupReadyEmailPayload({ customerName = 'du', amountCents = 0 }) {
    const safeCustomerName = escapeHtml(customerName || 'du');
    return {
        subject: 'Dein Parfum ist abholbereit! \u2713',
        html: renderBrandEmail({
            badge: 'Abholbereit',
            title: `Hallo ${safeCustomerName}!`,
            introHtml: `Deine Bestellung ist nun fertig gepackt und liegt zur Abholung fuer dich bereit. Hier findest du uns:<br><span style="color:#333;">Warnitzer Str. 20, 13057 Berlin</span><br><br>Bitte bringe den Zahlbetrag von <strong style="color:#000; font-weight:700;">${formatEuroFromCents(amountCents)} &euro;</strong> moeglichst passend in Bar mit. Wir freuen uns auf deinen Besuch!`,
            iconImageUrl: EMAIL_ICON_CHECK_IMAGE_URL
        })
    };
}

function buildNewsletterConfirmationEmailPayload({ confirmUrl }) {
    const safeConfirmUrl = sanitizeTrackingUrl(confirmUrl) || '#';
    return {
        subject: 'Bitte bestaetige deine Newsletter-Anmeldung',
        html: renderBrandEmail({
            badge: 'Ein letzter Schritt',
            title: 'Bestaetige deine Anmeldung',
            introHtml: 'Bitte bestaetige mit einem Klick deine Newsletter-Anmeldung. Erst danach senden wir dir deinen persoenlichen Rabattcode zu.',
            ctaHtml: `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
  <tr><td style="background:#1a1a1a;padding:14px 36px;">
    <a href="${safeConfirmUrl}" style="font-family:Arial,sans-serif;font-size:11px;color:#d4af37;text-decoration:none;letter-spacing:0.18em;text-transform:uppercase;">Anmeldung bestaetigen</a>
  </td></tr>
</table>`,
            afterBodyHtml: `<tr><td style="background:#f5f3ee;padding:0 48px 34px;text-align:center;">
  <p style="margin:0 auto;font-size:12px;color:#999;max-width:360px;line-height:1.7;">Falls du dich nicht selbst eingetragen hast, kannst du diese E-Mail einfach ignorieren.</p>
</td></tr>`
        })
    };
}

function buildNewsletterDiscountEmailPayload({ code, discount }) {
    const safeCode = escapeHtml(code || '');
    const safeDiscount = Number.isFinite(Number(discount)) ? Number(discount) : 0;
    return {
        subject: `Dein persoenlicher Rabattcode - ${safeDiscount}% auf deine erste Bestellung`,
        html: renderBrandEmail({
            badge: 'Willkommen',
            title: 'Schoen, dass du dabei bist!',
            introHtml: `Danke fuer deine Bestaetigung. Als Dankeschoen erhaeltst du exklusiv <strong style="color:#1a1a1a;">${safeDiscount}&nbsp;% Rabatt</strong> auf deine erste Bestellung.`,
            bodyHtml: `<tr><td style="background:#f5f3ee;padding:0 48px 0;text-align:center;">
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px;">
    <tr><td style="background:#1a1a1a;padding:20px 40px;text-align:center;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.2em;color:#d4af37;text-transform:uppercase;">Dein persoenlicher Code</p>
      <p style="margin:0;font-family:Georgia,serif;font-size:28px;color:#ffffff;letter-spacing:0.2em;">${safeCode}</p>
    </td></tr>
  </table>
  <p style="margin:0 auto 26px;font-size:12px;color:#999;max-width:360px;line-height:1.7;">Gib diesen Code im Warenkorb unter "Gutscheincode" ein.<br>Gueltig fuer eine Bestellung &middot; Nicht kombinierbar mit anderen Aktionen.</p>
</td></tr>`,
            ctaHtml: `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr><td style="background:#1a1a1a;padding:14px 36px;">
    <a href="https://note-fragrances.de/suche" style="font-family:Arial,sans-serif;font-size:11px;color:#d4af37;text-decoration:none;letter-spacing:0.18em;text-transform:uppercase;">Zur Kollektion &rarr;</a>
  </td></tr>
</table>`
        })
    };
}

function buildContactConfirmationEmailPayload({ name, subjectText }) {
    const safeName = escapeHtml(name || 'Kunde');
    const safeSubject = escapeHtml(subjectText || 'deine Nachricht');
    return {
        subject: 'Wir haben Ihre Nachricht erhalten \u2713',
        html: renderBrandEmail({
            badge: 'Nachricht erhalten',
            title: `Danke, ${safeName}!`,
            introHtml: `Wir haben Ihre Nachricht zum Thema <strong style="color:#1a1a1a;">${safeSubject}</strong> erhalten und melden uns schnellstmoeglich bei Ihnen zurueck.`,
            iconHtml: '&#9993;'
        })
    };
}

function buildContactInternalEmailHtml({ name, email, subjectText, message, receivedAtText }) {
    const safeName = escapeHtml(name || '');
    const safeEmail = escapeHtml(email || '');
    const safeSubject = escapeHtml(subjectText || '');
    const safeMessage = escapeHtml(message || '');
    const safeDate = escapeHtml(receivedAtText || '');

    return `
                <div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:32px;background:#f9f9f9;border-radius:8px;">
                    <h2 style="font-size:20px;margin-bottom:8px;color:#1a1a1a;">Neue Kontaktanfrage</h2>
                    <p style="color:#666;font-size:13px;margin-bottom:24px;border-bottom:1px solid #eee;padding-bottom:16px;">
                        Eingegangen am ${safeDate}
                    </p>
                    <table style="width:100%;font-size:14px;color:#333;">
                        <tr><td style="padding:6px 0;font-weight:600;width:100px;">Name</td><td>${safeName}</td></tr>
                        <tr><td style="padding:6px 0;font-weight:600;">E-Mail</td><td><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
                        <tr><td style="padding:6px 0;font-weight:600;">Betreff</td><td>${safeSubject}</td></tr>
                    </table>
                    <div style="margin-top:20px;padding:16px;background:#fff;border-radius:6px;border:1px solid #eee;">
                        <p style="margin:0;font-size:14px;line-height:1.7;color:#444;white-space:pre-wrap;">${safeMessage}</p>
                    </div>
                </div>
            `;
}

function buildAdminEmailTemplatePreviews() {
    const sampleItems = [
        {
            description: 'No. L3 (50ml)',
            quantity: 2,
            amountText: '49,98',
            imageUrl: 'https://note-fragrances.de/logo.webp'
        }
    ];
    const sampleAddress = {
        line1: 'Dr.-Rosenthal-Weg 4',
        line2: '',
        postal_code: '77694',
        city: 'Kehl',
        country: 'DE'
    };
    const orderMail = buildOrderConfirmationEmailPayload({
        customerName: 'Max',
        items: sampleItems,
        shippingCostCents: 0,
        discountAmountCents: 0,
        couponCode: '',
        totalAmountCents: 7497,
        address: sampleAddress
    });
    const shippingMail = buildShippingEmailPayload({ customerName: 'Max', trackingUrl: '' });
    const pickupReadyMail = buildPickupReadyEmailPayload({ customerName: 'Max', amountCents: 8990 });
    const pickupOrderMail = buildPickupOrderConfirmationEmailPayload({
        customerName: 'Max',
        items: sampleItems,
        discountAmountCents: 0,
        couponCode: '',
        totalAmountCents: 7497
    });
    const newsletterConfirmMail = buildNewsletterConfirmationEmailPayload({ confirmUrl: 'https://note-fragrances.de/newsletter-confirmation.html' });
    const newsletterMail = buildNewsletterDiscountEmailPayload({ code: 'NOTE-M7K2X', discount: 5 });
    const contactConfirmMail = buildContactConfirmationEmailPayload({ name: 'Maria', subjectText: 'Frage zur Bestellung' });

    return {
        order: {
            subject: orderMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde',
            html: orderMail.html
        },
        shipping: {
            subject: shippingMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde',
            html: shippingMail.html
        },
        pickup: {
            subject: pickupReadyMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde (Abholung)',
            html: pickupReadyMail.html
        },
        'pickup-order': {
            subject: pickupOrderMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Kunde (Abhol-Kauf)',
            html: pickupOrderMail.html
        },
        'newsletter-confirm': {
            subject: newsletterConfirmMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Abonnent',
            html: newsletterConfirmMail.html
        },
        newsletter: {
            subject: newsletterMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Abonnent',
            html: newsletterMail.html
        },
        'contact-confirm': {
            subject: contactConfirmMail.subject,
            from: 'Von: NOTE. fragrances <info@note-fragrances.de>  \u2022  An: Absender',
            html: contactConfirmMail.html
        },
        'contact-internal': {
            subject: 'Kontaktanfrage: Frage zur Bestellung',
            from: 'Von: N&Oslash;TE. Kontakt <noreply@note-fragrances.de>  \u2022  An: info@note-fragrances.de',
            html: `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:40px 20px;background:#f0f0f0;font-family:Arial,sans-serif;">
${buildContactInternalEmailHtml({
                name: 'Maria Mueller',
                email: 'maria@beispiel.de',
                subjectText: 'Frage zur Bestellung',
                message: 'Hallo, ich wuerde gerne wissen wann meine Bestellung ankommt. Vielen Dank!',
                receivedAtText: new Date().toLocaleString('de-DE')
            })}
</body></html>`
        }
    };
}

async function sendNewsletterConfirmationEmail({ email, confirmUrl }) {
    const mail = buildNewsletterConfirmationEmailPayload({ confirmUrl });
    await resend.emails.send({
        from: 'NOTE. fragrances <info@note-fragrances.de>',
        to: email,
        subject: mail.subject,
        html: mail.html
    });
}

async function sendNewsletterDiscountEmail({ email, code, discount }) {
    const mail = buildNewsletterDiscountEmailPayload({ code, discount });
    await resend.emails.send({
        from: 'NOTE. fragrances <info@note-fragrances.de>',
        to: email,
        subject: mail.subject,
        html: mail.html
    });
}

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
        const decoded = jwt.verify(token, JWT_SECRET);
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

async function buildReviewPayload(productId, userId = null) {
    const reviews = await Review.find({ productId })
        .sort({ updatedAt: -1 })
        .lean();

    const count = reviews.length;
    const average = count
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / count
        : 0;

    return {
        summary: {
            average,
            count
        },
        reviews: reviews.map(review => ({
            id: String(review._id),
            authorName: review.authorName,
            rating: review.rating,
            title: review.title || '',
            comment: review.comment || '',
            verifiedPurchase: !!review.verifiedPurchase,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
            isOwnReview: !!userId && review.userId === userId
        }))
    };
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
async function refreshProductCache() {
    try {
        productCache = await Product.find({}, '-_id -__v').lean();
        console.log('[Cache] Produkt-Cache aktualisiert.');
    } catch (e) {
        console.error('[Cache] Fehler beim Cache-Update:', e);
    }
}

function isAdmin(req) {
    const cookies = parseCookies(req);
    const token = cookies[ADMIN_TOKEN_COOKIE];
    if (!token) return false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded && decoded.role === 'admin';
    } catch (err) {
        return false;
    }
}

// Helper to parse cookies
const parseCookies = (request) => {
    const list = {};
    const rc = request.headers.cookie;

    rc && rc.split(';').forEach(function (cookie) {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
}

function getBearerToken(req) {
    const raw = String((req && req.headers && req.headers.authorization) || '').trim();
    if (!raw) return '';
    const match = raw.match(/^Bearer\s+(.+)$/i);
    return match ? String(match[1] || '').trim() : '';
}

function getUserTokenFromRequest(req) {
    const cookieToken = String(parseCookies(req)[USER_TOKEN_COOKIE] || '').trim();
    if (cookieToken) return cookieToken;
    return getBearerToken(req);
}

function ensureCsrfCookie(req, res, next) {
    const cookies = parseCookies(req);
    let csrfToken = cookies[CSRF_TOKEN_COOKIE];

    if (!csrfToken) {
        csrfToken = generateCsrfToken();
        res.cookie(CSRF_TOKEN_COOKIE, csrfToken, getCsrfCookieOptions());
    }

    rememberCsrfToken(csrfToken);
    req.csrfToken = csrfToken;
    next();
}

function requireCsrfToken(req, res, next) {
    const cookies = parseCookies(req);
    const cookieToken = String(cookies[CSRF_TOKEN_COOKIE] || '').trim();
    const headerToken = String(req.headers['x-csrf-token'] || '').trim();

    if (!headerToken) {
        return res.status(403).json({ error: 'CSRF-Token ungültig.' });
    }

    // Standardfall: Double-Submit-Cookie
    if (cookieToken && cookieToken === headerToken) {
        rememberCsrfToken(headerToken);
        return next();
    }

    // Mobile/Safari-Fallback: Drittanbieter-Cookie ggf. blockiert.
    // Dann akzeptieren wir ein zuvor vom Server ausgegebenes Header-Token.
    if (!cookieToken && hasRememberedCsrfToken(headerToken)) {
        rememberCsrfToken(headerToken);
        return next();
    }

    return res.status(403).json({ error: 'CSRF-Token ungültig.' });
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
app.use(ensureCsrfCookie);
// Webhook-Route MUSS vor app.use(express.json()) definiert werden
app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    let event;

    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    console.log('[Webhook] Eingehend | Secret gesetzt:', !!endpointSecret, '| Sig vorhanden:', !!sig);

    if (!endpointSecret) {
        console.error('[Webhook] STRIPE_WEBHOOK_SECRET fehlt in den Umgebungsvariablen!');
        return response.status(400).send('Webhook secret not configured');
    }

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
        console.log('[Webhook] Signatur OK | Event:', event.type);
    } catch (err) {
        console.error(`[Webhook] Signatur FEHLER: ${err.message}`);
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    if (typeof event.livemode === 'boolean' && event.livemode !== EXPECTS_LIVE_STRIPE_MODE) {
        console.error('[Webhook] Livemode-Mismatch. Event passt nicht zum aktiven Stripe-Key.');
        return response.status(400).send('Webhook livemode mismatch');
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('Zahlung erfolgreich!');

            // Idempotenz: Stripe kann Webhooks mehrfach zustellen.
            const existingOrder = await Order.findOne({ stripeSessionId: session.id }).lean();
            if (existingOrder) {
                console.log('[Webhook] Session bereits verarbeitet:', session.id);
                return response.json({ received: true, duplicate: true });
            }

            // Line Items von Stripe abrufen + Produktbilder aus MongoDB
            let items = [];
            try {
                const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
                items = await Promise.all(lineItems.data.map(async item => {
                    // Produktname extrahieren (z.B. "Rose Oud (50ml)" → "Rose Oud")
                    const nameMatch = item.description ? item.description.match(/^(.+?)\s*\(\d+ml\)/) : null;
                    const baseName = nameMatch ? nameMatch[1].trim() : null;

                    let imageUrl = null;
                    if (baseName) {
                        try {
                            const dbProduct = await Product.findOne({ name: new RegExp(baseName, 'i') }, 'images');
                            if (dbProduct && dbProduct.images && dbProduct.images.length > 0) {
                                imageUrl = 'https://note-fragrances.de/' + dbProduct.images[0];
                            }
                        } catch (imgErr) {
                            console.error('Fehler beim Laden des Produktbildes:', imgErr);
                        }
                    }

                    return {
                        description: item.description,
                        quantity: item.quantity,
                        amount_total: item.amount_total / 100,
                        currency: item.currency,
                        imageUrl
                    };
                }));
            } catch (err) {
                console.error('Fehler beim Abrufen der Line Items:', err);
            }

            const addressData = session.customer_details ? session.customer_details.address : null;
            const couponCode = session.metadata && session.metadata.couponCode ? session.metadata.couponCode : '';
            const discountAmount = session.total_details && typeof session.total_details.amount_discount === 'number'
                ? session.total_details.amount_discount
                : (session.metadata && session.metadata.discountAmountCents ? parseInt(session.metadata.discountAmountCents, 10) || 0 : 0);

            const newOrder = {
                date: new Date().toISOString(),
                email: session.customer_details && session.customer_details.email,
                name: session.customer_details && session.customer_details.name,
                amount: session.amount_total,  // kept in cents; admin UI divides by 100
                discountAmount,
                couponCode,
                address: addressData,
                items: items,
                stripeSessionId: session.id,
                stripeEventId: event.id
            };

            // Save to MongoDB (primary)
            try {
                const order = new Order(newOrder);
                await order.save();
                if (couponCode) {
                    await Subscriber.updateOne({ code: couponCode, used: false }, { $set: { used: true } });
                }
                console.log('Bestellung in MongoDB gespeichert:', order._id);
            } catch (dbErr) {
                console.error('MongoDB Fehler beim Speichern der Webhook-Order:', dbErr);
                if (!IS_PRODUCTION) {
                    // Nur lokal als Fallback speichern, nie in Produktion.
                    const ordersFilePath = path.join(__dirname, 'orders.json');
                    let orders = [];
                    if (fs.existsSync(ordersFilePath)) {
                        try { orders = JSON.parse(fs.readFileSync(ordersFilePath, 'utf8')); } catch (e) { }
                    }
                    orders.push(newOrder);
                    try { fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8'); } catch (e) { }
                }
            }

            // Send order confirmation email to customer
            const customerEmail = session.customer_details && session.customer_details.email;
            const customerName = session.customer_details && session.customer_details.name || 'Kunde';
            if (customerEmail) {
                try {
                    const addr = session.shipping_details && session.shipping_details.address
                        ? session.shipping_details.address
                        : (session.customer_details && session.customer_details.address);
                    const emailItems = items.map((item) => ({
                        description: item.description,
                        quantity: item.quantity,
                        imageUrl: item.imageUrl,
                        amountText: Number.isFinite(Number(item.amount_total))
                            ? Number(item.amount_total).toFixed(2).replace('.', ',')
                            : '0,00'
                    }));
                    const mail = buildOrderConfirmationEmailPayload({
                        customerName,
                        items: emailItems,
                        shippingCostCents: session.shipping_cost && Number.isFinite(Number(session.shipping_cost.amount_total))
                            ? Number(session.shipping_cost.amount_total)
                            : null,
                        discountAmountCents: discountAmount,
                        couponCode,
                        totalAmountCents: newOrder.amount,
                        address: addr
                    });

                    await resend.emails.send({
                        from: 'NOTE. fragrances <info@note-fragrances.de>',
                        to: customerEmail,
                        subject: mail.subject,
                        html: mail.html
                    });

                    console.log('[Email] Bestellbestätigung gesendet an:', customerEmail);
                } catch (emailErr) {
                    console.error('[Email] Fehler beim Senden der Bestellbestätigung:', emailErr);
                }
            }
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
});

// Middleware for parsing JSON and URL-encoded data
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Einheitliche Antwort bei kaputtem JSON-Body statt HTML-Stacktrace
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, 'body')) {
        recentJsonParseErrorTimestamps.push(Date.now());
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
        version: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown',
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
        return res.status(200).json({
            status: 'ready',
            now: new Date().toISOString(),
            checks: {
                db: {
                    ok: true,
                    state: getMongoStateLabel(mongoReadyState)
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

app.get('/api/csrf-token', (req, res) => {
    rememberCsrfToken(req.csrfToken);
    res.json({ csrfToken: req.csrfToken });
});

// --- Contact Form ---
app.post('/api/contact', formLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich.' });
    }

    try {
        const normalizedName = String(name || '').trim();
        const safeEmail = sanitizeEmail(email);
        const normalizedSubject = String(subject || '').trim();
        const safeSubjectHeader = sanitizeHeaderText(subject);
        const normalizedMessage = String(message || '').trim();

        if (!safeEmail) {
            return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
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

// --- Newsletter Anmeldung ---
app.post('/api/newsletter', newsletterLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const { email } = req.body;
    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
    }

    try {
        const existing = await Subscriber.findOne({ email: normalizedEmail });
        const confirmToken = generateConfirmationToken();
        const confirmTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const confirmationUrl = `${buildBackendPublicUrl(req)}/api/newsletter/confirm?token=${confirmToken}`;

        if (existing && (existing.status === 'active' || (existing.code && !existing.status))) {
            return res.status(409).json({ error: 'Diese E-Mail ist bereits angemeldet.', alreadySubscribed: true });
        }

        let subscriber = existing;

        if (subscriber) {
            subscriber.confirmToken = confirmToken;
            subscriber.confirmTokenExpiresAt = confirmTokenExpiresAt;
            subscriber.status = 'pending';
            subscriber.confirmedAt = undefined;
            await subscriber.save();
        } else {
            subscriber = await new Subscriber({
                email: normalizedEmail,
                status: 'pending',
                confirmToken,
                confirmTokenExpiresAt
            }).save();
        }

        if (LOCAL_DEV_SAFE_MODE) {
            return res.json({
                success: true,
                safeMode: true,
                confirmUrl: confirmationUrl,
                message: 'Lokaler Testmodus: Kein E-Mail-Versand. Öffne den Bestätigungslink, um den Testcode zu erzeugen.'
            });
        }

        await sendNewsletterConfirmationEmail({
            email: normalizedEmail,
            confirmUrl: confirmationUrl
        });

        res.json({
            success: true,
            requiresConfirmation: true,
            message: 'Bitte bestätige deine Anmeldung über die E-Mail, die wir dir gerade gesendet haben.'
        });
    } catch (err) {
        console.error('Newsletter Fehler:', err);
        res.status(500).json({ error: 'Anmeldung fehlgeschlagen.' });
    }
});

app.get('/api/newsletter/confirm', async (req, res) => {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
        return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=invalid`);
    }

    try {
        const subscriber = await Subscriber.findOne({ confirmToken: token.trim() });

        if (!subscriber) {
            return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=invalid`);
        }

        if (subscriber.status === 'active' && subscriber.confirmedAt) {
            return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=already-confirmed`);
        }

        if (!subscriber.confirmTokenExpiresAt || subscriber.confirmTokenExpiresAt.getTime() < Date.now()) {
            subscriber.confirmToken = undefined;
            subscriber.confirmTokenExpiresAt = undefined;
            await subscriber.save();
            return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=expired`);
        }

        subscriber.status = 'active';
        subscriber.confirmedAt = new Date();
        subscriber.confirmToken = undefined;
        subscriber.confirmTokenExpiresAt = undefined;

        if (!subscriber.code) {
            subscriber.code = await generateNewsletterCode();
        }

        await subscriber.save();

        if (LOCAL_DEV_SAFE_MODE) {
            return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=success&code=${encodeURIComponent(subscriber.code)}`);
        }

        await sendNewsletterDiscountEmail({
            email: subscriber.email,
            code: subscriber.code,
            discount: subscriber.discount || 5
        });

        return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=success`);
    } catch (err) {
        console.error('Newsletter Bestaetigung Fehler:', err);
        return res.redirect(`${buildFrontendPublicUrl(req)}/newsletter-confirmation.html?status=error`);
    }
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

app.post('/api/register', authLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const normalizedEmail = email ? email.trim().toLowerCase() : '';
        const safeName = sanitizeText(name, 120);

        if (!normalizedEmail || !password) {
            return res.status(400).json({ error: 'Email und Passwort erforderlich' });
        }

        if (!JWT_SECRET) {
            return res.status(500).json({ error: 'Server-Konfiguration unvollständig' });
        }

        if (await User.findOne({ email: normalizedEmail })) {
            return res.status(400).json({ error: 'Email bereits registriert' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({ email: normalizedEmail, password: hashedPassword, name: safeName });
        await user.save();

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.cookie(USER_TOKEN_COOKIE, token, getUserCookieOptions());

        res.json({ success: true, message: 'Registrierung erfolgreich', authToken: token, user: { name: user.name, email: user.email } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(503).json({ error: 'Registrierung aktuell nicht verfügbar.' });
    }
});

app.post('/api/login', authLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email ? email.trim().toLowerCase() : '';

        if (!JWT_SECRET) {
            return res.status(500).json({ error: 'Server-Konfiguration unvollständig' });
        }

        const user = await User.findOne({ email: normalizedEmail });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Ungültige Email oder Passwort' });
        }

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

        res.cookie(USER_TOKEN_COOKIE, token, getUserCookieOptions());

        res.json({ success: true, authToken: token, user: { name: user.name, email: user.email } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(503).json({ error: 'Login aktuell nicht verfügbar.' });
    }
});

app.post('/api/logout', requireTrustedOrigin, requireCsrfToken, (req, res) => {
    res.clearCookie(USER_TOKEN_COOKIE, getUserCookieOptions());
    res.json({ success: true });
});

app.get('/api/user', async (req, res) => {
    const token = getUserTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

        res.json({
            user: {
                name: user.name,
                email: user.email,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                addresses: user.addresses || []
            }
        });
    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
});

app.put('/api/user/profile', requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const token = getUserTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

        const { firstName, lastName } = req.body;
        const safeFirstName = sanitizeText(firstName, 80);
        const safeLastName = sanitizeText(lastName, 80);

        if (firstName !== undefined) user.firstName = safeFirstName;
        if (lastName !== undefined) user.lastName = safeLastName;

        await user.save();

        res.json({ success: true });
    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
});

app.post('/api/user/address', requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const token = getUserTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

        const { firstName, lastName, label, street, city, zip, country } = req.body;

        if (!user.addresses) user.addresses = [];

        const newAddress = {
            id: uuidv4(),
            firstName: sanitizeText(firstName, 80),
            lastName: sanitizeText(lastName, 80),
            label: sanitizeText(label, 80),
            street: sanitizeText(street, 120),
            city: sanitizeText(city, 80),
            zip: sanitizeText(zip, 20),
            country: sanitizeText(country, 80)
        };

        user.addresses.push(newAddress);
        await user.save();

        res.json({ success: true, addresses: user.addresses });
    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
});

app.delete('/api/user/address/:id', requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    const token = getUserTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

        const addressId = req.params.id;
        if (user.addresses) {
            user.addresses = user.addresses.filter(a => a.id !== addressId);
            await user.save();
        }

        res.json({ success: true, addresses: user.addresses || [] });
    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
});

app.get('/api/user/orders', async (req, res) => {
    const token = getUserTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userEmail = decoded.email;


        const userOrders = await Order.find({ email: userEmail }).sort({ date: -1 });

        res.json({ orders: userOrders });

    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
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
                const decoded = jwt.verify(token, JWT_SECRET);
                userId = decoded.userId || null;
            }
        } catch (err) {
            userId = null;
        }

        const payload = await buildReviewPayload(productId, userId);
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

        const verifiedPurchase = await Order.exists({
            email: user.email,
            items: {
                $elemMatch: {
                    description: new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
                }
            }
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
                updatedAt: new Date()
            },
            {
                upsert: true,
                new: true,
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


// --- Live Viewer Tracking ---
const productViewers = {}; // {productId: [ {ip, timestamp} ] }

// Helper to clean up old viewers (> 60 seconds inactivity)
function cleanupViewers(productId) {
    if (!productViewers[productId]) return;
    const now = Date.now();
    productViewers[productId] = productViewers[productId].filter(v => now - v.timestamp < 60000);
    if (productViewers[productId].length === 0) {
        delete productViewers[productId];
    }
}

app.post('/api/view-product', viewLimiter, (req, res) => {
    const { productId } = req.body;
    if (!productId) {
        return res.status(400).json({ error: 'Missing productId' });
    }

    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!productViewers[productId]) {
        productViewers[productId] = [];
    }

    // Remove existing entry for this IP to update timestamp
    productViewers[productId] = productViewers[productId].filter(v => v.ip !== ip);

    // Add new entry
    productViewers[productId].push({ ip, timestamp: now });

    // Cleanup old entries
    cleanupViewers(productId);

    // Calculate simulated cart count based on viewers (approx 20-40% of viewers, min 2)
    const viewerCount = productViewers[productId].length;
    // Deterministic "random" cart count based on productId + viewerCount to keep it stable but dynamic
    // Just using a simple ratio for now to be "live-ish"
    let cartCount = Math.floor(viewerCount * 0.35);
    if (cartCount < 2) cartCount = 2;
    if (cartCount > viewerCount) cartCount = viewerCount; // Should not happen with 0.35 but safety check

    res.json({
        viewers: viewerCount,
        carts: cartCount
    });
});
// ----------------------------

app.post('/admin/login', (req, res) => {
    res.status(410).send('Legacy admin login disabled. Use /frontend/admin.html with the API login.');
});

// --- Brute-force protection for admin login ---
const loginAttempts = {}; // {ip: {count, lockedUntil} }
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown').split(',')[0].trim();
}

const securityMonitorState = {
    intervalMs: SECURITY_MONITOR_INTERVAL_MS,
    running: false,
    lastRunAt: null,
    nextRunAt: null,
    latest: null,
    history: []
};

const dependencyMonitorState = {
    intervalMs: DEPENDENCY_SCAN_INTERVAL_MS,
    running: false,
    lastRunAt: null,
    nextRunAt: null,
    latest: null,
    history: []
};

function pruneTimestamps(timestamps, windowMs) {
    const threshold = Date.now() - windowMs;
    while (timestamps.length > 0 && timestamps[0] < threshold) {
        timestamps.shift();
    }
}

function runExecFile(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function parseAuditSummary(output) {
    try {
        const parsed = JSON.parse(output || '{}');
        const viaMetadata = parsed && parsed.metadata && parsed.metadata.vulnerabilities;
        if (viaMetadata) {
            return {
                total: Number(viaMetadata.total) || 0,
                low: Number(viaMetadata.low) || 0,
                moderate: Number(viaMetadata.moderate) || 0,
                high: Number(viaMetadata.high) || 0,
                critical: Number(viaMetadata.critical) || 0
            };
        }
    } catch (err) {
        // fall through to default
    }

    return { total: 0, low: 0, moderate: 0, high: 0, critical: 0 };
}

function parseLockfilePackages(lockfilePath) {
    try {
        const raw = fs.readFileSync(lockfilePath, 'utf8');
        const lock = JSON.parse(raw);
        const seen = new Set();
        const packages = [];

        const addPackage = (name, version) => {
            if (!name || !version) return;
            const key = `${name}@${version}`;
            if (seen.has(key)) return;
            seen.add(key);
            packages.push({ name, version });
        };

        if (lock && lock.packages && typeof lock.packages === 'object') {
            for (const [pkgPath, meta] of Object.entries(lock.packages)) {
                if (!pkgPath || !meta || !meta.version) continue;
                let name = meta.name;
                if (!name) {
                    const segments = pkgPath.split('node_modules/').filter(Boolean);
                    name = segments.length ? segments[segments.length - 1] : '';
                }
                addPackage(name, String(meta.version));
            }
        }

        const walkDependencies = (deps) => {
            if (!deps || typeof deps !== 'object') return;
            for (const [depName, depMeta] of Object.entries(deps)) {
                if (!depMeta || typeof depMeta !== 'object') continue;
                if (depMeta.version) {
                    addPackage(depName, String(depMeta.version));
                }
                if (depMeta.dependencies) {
                    walkDependencies(depMeta.dependencies);
                }
            }
        };

        if (lock && lock.dependencies) {
            walkDependencies(lock.dependencies);
        }

        return packages;
    } catch (error) {
        return [];
    }
}

async function queryOsvBatch(packages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSV_SCAN_TIMEOUT_MS);
    try {
        const response = await fetch(OSV_BATCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                queries: packages.map(item => ({
                    package: { name: item.name, ecosystem: 'npm' },
                    version: item.version
                }))
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`OSV API HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function runOsvScanForPath(targetPath) {
    const start = Date.now();
    const lockPath = path.join(targetPath, 'package-lock.json');

    if (!fs.existsSync(lockPath)) {
        return {
            ok: false,
            durationMs: Date.now() - start,
            summary: {
                packagesScanned: 0,
                affectedPackages: 0,
                totalVulns: 0
            },
            sampleIds: [],
            error: 'Kein package-lock.json gefunden.'
        };
    }

    const packages = parseLockfilePackages(lockPath);
    if (!packages.length) {
        return {
            ok: true,
            durationMs: Date.now() - start,
            summary: {
                packagesScanned: 0,
                affectedPackages: 0,
                totalVulns: 0
            },
            sampleIds: [],
            error: ''
        };
    }

    let totalVulns = 0;
    let affectedPackages = 0;
    const sampleIds = [];
    const seenIds = new Set();

    try {
        for (let index = 0; index < packages.length; index += OSV_BATCH_SIZE) {
            const chunk = packages.slice(index, index + OSV_BATCH_SIZE);
            const payload = await queryOsvBatch(chunk);
            const results = Array.isArray(payload && payload.results) ? payload.results : [];

            for (let i = 0; i < results.length; i += 1) {
                const vulnerabilities = Array.isArray(results[i] && results[i].vulns) ? results[i].vulns : [];
                if (vulnerabilities.length) {
                    affectedPackages += 1;
                    totalVulns += vulnerabilities.length;
                    for (const vuln of vulnerabilities) {
                        if (vuln && vuln.id && !seenIds.has(vuln.id) && sampleIds.length < 12) {
                            seenIds.add(vuln.id);
                            sampleIds.push(vuln.id);
                        }
                    }
                }
            }
        }

        return {
            ok: true,
            durationMs: Date.now() - start,
            summary: {
                packagesScanned: packages.length,
                affectedPackages,
                totalVulns
            },
            sampleIds,
            error: ''
        };
    } catch (error) {
        return {
            ok: false,
            durationMs: Date.now() - start,
            summary: {
                packagesScanned: packages.length,
                affectedPackages: 0,
                totalVulns: 0
            },
            sampleIds: [],
            error: error && error.message ? error.message : 'OSV-Scan fehlgeschlagen'
        };
    }
}

async function runDependencyAuditForPath(targetPath) {
    const start = Date.now();
    try {
        const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
        const args = process.platform === 'win32'
            ? ['/d', '/s', '/c', 'npm audit --omit=dev --json']
            : ['audit', '--omit=dev', '--json'];
        const { stdout } = await runExecFile(command, args, {
            cwd: targetPath,
            timeout: DEPENDENCY_SCAN_TIMEOUT_MS,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 10
        });
        return {
            ok: true,
            durationMs: Date.now() - start,
            summary: parseAuditSummary(stdout),
            error: ''
        };
    } catch (error) {
        const output = (error && error.stdout) ? error.stdout : '';
        const summary = parseAuditSummary(output);
        const hasAuditData = summary.total > 0 || summary.high > 0 || summary.critical > 0 || summary.moderate > 0 || summary.low > 0;

        if (hasAuditData) {
            return {
                ok: true,
                durationMs: Date.now() - start,
                summary,
                error: ''
            };
        }

        return {
            ok: false,
            durationMs: Date.now() - start,
            summary: { total: 0, low: 0, moderate: 0, high: 0, critical: 0 },
            error: error && error.message ? error.message : 'npm audit fehlgeschlagen'
        };
    }
}

function resolveDependencyScanTargets() {
    const candidates = [
        { id: 'backend', path: __dirname },
        { id: 'cwd', path: process.cwd() },
        { id: 'root', path: path.join(__dirname, '..') },
        { id: 'frontend', path: path.join(__dirname, '..', 'frontend') }
    ];

    const seen = new Set();
    const targets = [];

    for (const candidate of candidates) {
        const resolvedPath = path.resolve(candidate.path);
        if (seen.has(resolvedPath)) continue;
        seen.add(resolvedPath);

        const packageLock = path.join(resolvedPath, 'package-lock.json');
        if (fs.existsSync(packageLock)) {
            targets.push({ id: candidate.id, path: resolvedPath });
        }
    }

    return targets;
}

async function runDependencyScan() {
    if (dependencyMonitorState.running) return dependencyMonitorState.latest;
    dependencyMonitorState.running = true;

    try {
        const targets = resolveDependencyScanTargets();
        const scans = [];
        if (targets.length === 0) {
            scans.push({
                id: 'auto-detect',
                ok: false,
                npmOk: false,
                osvOk: false,
                summary: { total: 0, low: 0, moderate: 0, high: 0, critical: 0 },
                osvSummary: { packagesScanned: 0, affectedPackages: 0, totalVulns: 0 },
                durationMs: 0,
                sampleIds: [],
                npmError: 'Kein package-lock.json im Projektpfad gefunden.',
                osvError: 'Kein package-lock.json im Projektpfad gefunden.',
                error: 'Kein package-lock.json im Projektpfad gefunden.'
            });
        }

        for (const target of targets) {
            const auditResult = await runDependencyAuditForPath(target.path);
            const osvResult = await runOsvScanForPath(target.path);
            scans.push({
                id: target.id,
                ok: auditResult.ok && osvResult.ok,
                npmOk: auditResult.ok,
                osvOk: osvResult.ok,
                summary: auditResult.summary,
                osvSummary: osvResult.summary,
                durationMs: auditResult.durationMs + osvResult.durationMs,
                sampleIds: osvResult.sampleIds,
                npmError: auditResult.error || '',
                osvError: osvResult.error || '',
                error: [auditResult.error, osvResult.error].filter(Boolean).join(' | ')
            });
        }

        const totals = scans.reduce((acc, scan) => {
            acc.total += scan.summary.total;
            acc.low += scan.summary.low;
            acc.moderate += scan.summary.moderate;
            acc.high += scan.summary.high;
            acc.critical += scan.summary.critical;
            acc.osvVulns += Number(scan.osvSummary && scan.osvSummary.totalVulns) || 0;
            acc.osvAffectedPackages += Number(scan.osvSummary && scan.osvSummary.affectedPackages) || 0;
            acc.osvPackagesScanned += Number(scan.osvSummary && scan.osvSummary.packagesScanned) || 0;
            return acc;
        }, { total: 0, low: 0, moderate: 0, high: 0, critical: 0, osvVulns: 0, osvAffectedPackages: 0, osvPackagesScanned: 0 });

        const nowIso = new Date().toISOString();
        const npmFailures = scans
            .filter(scan => !scan.npmOk)
            .map(scan => `${scan.id}: ${scan.npmError || 'Audit-Lauf fehlgeschlagen'}`);
        const osvFailures = scans
            .filter(scan => !scan.osvOk)
            .map(scan => `${scan.id}: ${scan.osvError || 'OSV-Lauf fehlgeschlagen'}`);
        const payload = {
            runAt: nowIso,
            scans,
            totals,
            ok: scans.every(scan => scan.ok),
            npmOk: scans.every(scan => scan.npmOk),
            osvOk: scans.every(scan => scan.osvOk),
            hasCritical: totals.critical > 0,
            hasHigh: totals.high > 0,
            hasModerate: totals.moderate > 0,
            hasOsvFindings: totals.osvVulns > 0,
            npmFailures,
            osvFailures
        };

        dependencyMonitorState.lastRunAt = nowIso;
        dependencyMonitorState.nextRunAt = new Date(Date.now() + dependencyMonitorState.intervalMs).toISOString();
        dependencyMonitorState.latest = payload;
        dependencyMonitorState.history.unshift({
            runAt: payload.runAt,
            totals: payload.totals,
            ok: payload.ok
        });
        if (dependencyMonitorState.history.length > SECURITY_MONITOR_HISTORY_LIMIT) {
            dependencyMonitorState.history.length = SECURITY_MONITOR_HISTORY_LIMIT;
        }

        return payload;
    } finally {
        dependencyMonitorState.running = false;
    }
}

function countActiveAdminLockouts() {
    const now = Date.now();
    return Object.values(loginAttempts).filter(record => record && record.lockedUntil > now).length;
}

function buildLocalProbeUrl(pathname) {
    return `http://127.0.0.1:${PORT}${pathname}`;
}

async function runHttpProbe({ id, label, severity = 'warning', method = 'GET', pathname, headers = {}, body = null, expectedStatuses = [200], timeoutMs = 5000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status = null;
    let ok = false;
    let errorMessage = '';

    try {
        const response = await fetch(buildLocalProbeUrl(pathname), {
            method,
            headers,
            body,
            signal: controller.signal
        });
        status = response.status;
        ok = expectedStatuses.includes(status);
    } catch (err) {
        errorMessage = err && err.message ? err.message : 'Probe fehlgeschlagen';
        ok = false;
    } finally {
        clearTimeout(timer);
    }

    const expectedLabel = expectedStatuses.join('/');
    const detail = errorMessage
        ? `Fehler: ${errorMessage}`
        : `HTTP ${status} (erwartet ${expectedLabel})`;

    return {
        id,
        label,
        ok,
        severity,
        detail
    };
}

async function runActiveSecurityProbes() {
    const jsonBody = JSON.stringify({ code: 'NOTE-HEALTH-CHECK' });
    const jsonHeaders = { 'Content-Type': 'application/json' };

    const probes = await Promise.all([
        runHttpProbe({
            id: 'probe-csrf-endpoint',
            label: 'Probe: CSRF-Token Endpoint erreichbar',
            severity: 'critical',
            method: 'GET',
            pathname: '/api/csrf-token',
            expectedStatuses: [200]
        }),
        runHttpProbe({
            id: 'probe-csrf-enforced',
            label: 'Probe: CSRF ohne Token blockiert',
            severity: 'critical',
            method: 'POST',
            pathname: '/api/validate-coupon',
            headers: { ...jsonHeaders, Origin: 'http://localhost:5500' },
            body: jsonBody,
            expectedStatuses: [403, 429]
        }),
        runHttpProbe({
            id: 'probe-origin-enforced',
            label: 'Probe: Fremde Origin blockiert',
            severity: 'critical',
            method: 'POST',
            pathname: '/api/validate-coupon',
            headers: { ...jsonHeaders, Origin: 'https://evil.example' },
            body: jsonBody,
            expectedStatuses: [403, 429]
        }),
        runHttpProbe({
            id: 'probe-admin-auth-gate',
            label: 'Probe: Admin-Endpoint ohne Login blockiert',
            severity: 'warning',
            method: 'GET',
            pathname: '/api/admin/check',
            expectedStatuses: [401]
        })
    ]);

    return probes;
}

function collectFilesRecursive(baseDir, extensions) {
    const results = [];
    const stack = [baseDir];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (err) {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                stack.push(fullPath);
                continue;
            }
            if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

function runStaticSecurityHeuristics() {
    const files = [
        ...collectFilesRecursive(path.join(__dirname), ['.js']),
        ...collectFilesRecursive(path.join(__dirname, '..', 'frontend'), ['.js', '.html'])
    ].filter(filePath => path.resolve(filePath) !== path.resolve(__filename));

    const patterns = [
        { id: 'static-no-eval', label: 'Heuristik: Kein eval(', regex: /\beval\s*\(/g, severity: 'critical' },
        { id: 'static-no-new-function', label: 'Heuristik: Kein new Function(', regex: /\bnew\s+Function\s*\(/g, severity: 'critical' },
        { id: 'static-no-document-write', label: 'Heuristik: Kein document.write(', regex: /\bdocument\.write\s*\(/g, severity: 'warning' },
        { id: 'static-no-dangerouslysetinnerhtml', label: 'Heuristik: Kein dangerouslySetInnerHTML', regex: /\bdangerouslySetInnerHTML\b/g, severity: 'critical' },
        { id: 'static-no-child-process-exec', label: 'Heuristik: Kein child_process.exec(', regex: /\bchild_process\.(exec|execSync)\s*\(/g, severity: 'critical' }
    ];

    const counts = Object.fromEntries(patterns.map(pattern => [pattern.id, 0]));
    for (const filePath of files) {
        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            continue;
        }
        for (const pattern of patterns) {
            const matches = content.match(pattern.regex);
            if (matches) counts[pattern.id] += matches.length;
        }
    }

    return patterns.map(pattern => {
        const count = counts[pattern.id] || 0;
        return {
            id: pattern.id,
            label: pattern.label,
            ok: count === 0,
            severity: pattern.severity,
            detail: count === 0 ? 'Keine Treffer gefunden.' : `${count} Treffer gefunden.`
        };
    });
}

async function runSecuritySelfTest() {
    if (securityMonitorState.running) return securityMonitorState.latest;

    securityMonitorState.running = true;
    const started = Date.now();

    try {
        pruneTimestamps(recentJsonParseErrorTimestamps, JSON_PARSE_ERROR_WINDOW_MS);
        const dependencyAgeMs = dependencyMonitorState.lastRunAt
            ? (Date.now() - new Date(dependencyMonitorState.lastRunAt).getTime())
            : Number.POSITIVE_INFINITY;
        let dependencyRun = dependencyMonitorState.latest;
        if (!dependencyRun || dependencyAgeMs > dependencyMonitorState.intervalMs) {
            dependencyRun = await runDependencyScan();
        }

        const dbConnected = mongoose.connection && mongoose.connection.readyState === 1;
        let dbPingMs = null;
        let dbPingOk = false;

        if (dbConnected && mongoose.connection.db) {
            const pingStart = Date.now();
            try {
                await mongoose.connection.db.admin().ping();
                dbPingMs = Date.now() - pingStart;
                dbPingOk = true;
            } catch (err) {
                dbPingMs = Date.now() - pingStart;
                dbPingOk = false;
            }
        }

        const parseErrors10m = recentJsonParseErrorTimestamps.length;
        const activeLockouts = countActiveAdminLockouts();
        const cacheReady = Array.isArray(productCache) && productCache.length > 0;

        const runtimeTests = [
            {
                id: 'runtime-db-connected',
                label: 'DB verbunden',
                ok: dbConnected,
                severity: 'critical',
                detail: dbConnected ? 'MongoDB-Verbindung ist aktiv.' : 'MongoDB-Verbindung fehlt.'
            },
            {
                id: 'runtime-db-ping',
                label: 'DB Ping',
                ok: dbConnected ? dbPingOk : false,
                severity: 'critical',
                detail: dbConnected
                    ? (dbPingOk ? `Ping erfolgreich (${dbPingMs} ms).` : 'Ping fehlgeschlagen.')
                    : 'Kein Ping ohne aktive DB-Verbindung.'
            },
            {
                id: 'runtime-json-parse-errors',
                label: 'JSON-Fehlerlast',
                ok: parseErrors10m <= 5,
                severity: parseErrors10m > 15 ? 'critical' : 'warning',
                detail: `${parseErrors10m} ungültige JSON-Requests in den letzten 10 Minuten.`
            },
            {
                id: 'runtime-admin-lockouts',
                label: 'Aktive Admin-Sperren',
                ok: activeLockouts <= 5,
                severity: activeLockouts > 20 ? 'critical' : 'warning',
                detail: `${activeLockouts} aktive Lockout(s) im Admin-Login.`
            },
            {
                id: 'runtime-product-cache',
                label: 'Produkt-Cache warm',
                ok: cacheReady,
                severity: 'warning',
                detail: cacheReady ? `Cache bereit (${productCache.length} Produkte).` : 'Produkt-Cache aktuell leer.'
            }
        ];

        const probeTests = await runActiveSecurityProbes();
        const staticTests = runStaticSecurityHeuristics();
        const dependencyRunAgeMs = dependencyRun && dependencyRun.runAt
            ? (Date.now() - new Date(dependencyRun.runAt).getTime())
            : Number.POSITIVE_INFINITY;
        const dependencyFreshThresholdMs = Math.max(
            Number(dependencyMonitorState.intervalMs) * 1.5,
            15 * 60 * 1000
        );

        const dependencyTests = dependencyRun ? [
            {
                id: 'deps-recency',
                label: 'Dependency-Scan zeitnah',
                ok: dependencyRunAgeMs <= dependencyFreshThresholdMs,
                severity: 'warning',
                detail: dependencyRun && dependencyRun.runAt
                    ? `Letzter Lauf vor ${Math.max(0, Math.round(dependencyRunAgeMs / 60000))} min.`
                    : 'Kein letzter Laufzeitpunkt vorhanden.'
            },
            {
                id: 'deps-audit-critical-high',
                label: 'Dependency-Scan: Keine High/Critical CVEs',
                ok: !dependencyRun.hasCritical && !dependencyRun.hasHigh,
                severity: 'critical',
                detail: `Critical: ${dependencyRun.totals.critical}, High: ${dependencyRun.totals.high}`
            },
            {
                id: 'deps-audit-moderate',
                label: 'Dependency-Scan: Moderate CVEs unter Kontrolle',
                ok: !dependencyRun.hasModerate,
                severity: 'warning',
                detail: `Moderate: ${dependencyRun.totals.moderate}, Low: ${dependencyRun.totals.low}`
            },
            {
                id: 'deps-audit-run-health',
                label: 'Dependency-Scan erfolgreich ausgeführt',
                ok: Boolean(dependencyRun.npmOk),
                severity: 'warning',
                detail: dependencyRun.npmOk
                    ? `Letzter Lauf: ${dependencyRun.runAt}`
                    : (Array.isArray(dependencyRun.npmFailures) && dependencyRun.npmFailures.length
                        ? dependencyRun.npmFailures.join(' | ')
                        : 'Mindestens ein Audit-Lauf konnte nicht ausgeführt werden.')
            },
            {
                id: 'deps-osv-findings',
                label: 'OSV-Scan: Keine weiteren Vulnerability-Hits',
                ok: !dependencyRun.hasOsvFindings,
                severity: 'warning',
                detail: `OSV Hits: ${Number(dependencyRun.totals && dependencyRun.totals.osvVulns) || 0}, betroffene Pakete: ${Number(dependencyRun.totals && dependencyRun.totals.osvAffectedPackages) || 0}`
            },
            {
                id: 'deps-osv-run-health',
                label: 'OSV-Scan erfolgreich ausgeführt',
                ok: Boolean(dependencyRun.osvOk),
                severity: 'warning',
                detail: dependencyRun.osvOk
                    ? `Pakete gescannt: ${Number(dependencyRun.totals && dependencyRun.totals.osvPackagesScanned) || 0}`
                    : (Array.isArray(dependencyRun.osvFailures) && dependencyRun.osvFailures.length
                        ? dependencyRun.osvFailures.join(' | ')
                        : 'Mindestens ein OSV-Scan konnte nicht ausgeführt werden.')
            }
        ] : [
            {
                id: 'deps-audit-run-health',
                label: 'Dependency-Scan erfolgreich ausgeführt',
                ok: false,
                severity: 'warning',
                detail: 'Noch kein Dependency-Scan vorhanden.'
            },
            {
                id: 'deps-osv-run-health',
                label: 'OSV-Scan erfolgreich ausgeführt',
                ok: false,
                severity: 'warning',
                detail: 'Noch kein OSV-Scan vorhanden.'
            }
        ];

        const tests = [...runtimeTests, ...probeTests, ...staticTests, ...dependencyTests];

        const failedTests = tests.filter(test => !test.ok);
        const score = Math.round((tests.filter(test => test.ok).length / tests.length) * 100);
        const nowIso = new Date().toISOString();

        const run = {
            startedAt: new Date(started).toISOString(),
            finishedAt: nowIso,
            durationMs: Date.now() - started,
            score,
            tests,
            dependency: dependencyRun || null,
            alerts: failedTests.map(test => ({
                id: test.id,
                severity: test.severity,
                message: `${test.label}: ${test.detail}`
            }))
        };

        securityMonitorState.lastRunAt = nowIso;
        securityMonitorState.nextRunAt = new Date(Date.now() + securityMonitorState.intervalMs).toISOString();
        securityMonitorState.latest = run;
        securityMonitorState.history.unshift(run);
        if (securityMonitorState.history.length > SECURITY_MONITOR_HISTORY_LIMIT) {
            securityMonitorState.history.length = SECURITY_MONITOR_HISTORY_LIMIT;
        }

        return run;
    } finally {
        securityMonitorState.running = false;
    }
}

function startSecurityMonitorLoop() {
    runDependencyScan().catch((err) => {
        console.error('Initial dependency scan failed:', err);
    });

    runSecuritySelfTest().catch((err) => {
        console.error('Initial security self-test failed:', err);
    });

    setInterval(() => {
        runSecuritySelfTest().catch((err) => {
            console.error('Scheduled security self-test failed:', err);
        });
    }, securityMonitorState.intervalMs);

    setInterval(() => {
        runDependencyScan().catch((err) => {
            console.error('Scheduled dependency scan failed:', err);
        });
    }, dependencyMonitorState.intervalMs);
}

// --- NEW API-based Admin Routes ---
app.post('/api/admin/login', adminAuthLimiter, requireTrustedOrigin, requireCsrfToken, (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const record = loginAttempts[ip] || { count: 0, lockedUntil: 0 };

    // Check if currently locked
    if (record.lockedUntil > now) {
        const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000);
        return res.status(429).json({
            error: `Zu viele Fehlversuche.Bitte ${minutesLeft} Minute(n) warten.`,
            lockedMinutes: minutesLeft
        });
    }

    const { password } = req.body;
    if (!JWT_SECRET || !ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'Admin login is not configured correctly.' });
    }

    if (password === ADMIN_PASSWORD) {
        // Success – clear attempts
        delete loginAttempts[ip];
        const adminToken = jwt.sign(
            { role: 'admin' },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        res.cookie(ADMIN_TOKEN_COOKIE, adminToken, getAdminCookieOptions());
        res.json({ success: true });
    } else {
        // Wrong password – increment counter
        record.count = (record.count || 0) + 1;
        const remaining = MAX_ATTEMPTS - record.count;

        if (record.count >= MAX_ATTEMPTS) {
            record.lockedUntil = now + LOCKOUT_MS;
            record.count = 0; // reset after lockout starts
            loginAttempts[ip] = record;
            console.warn(`Admin login: IP ${ip} gesperrt nach ${MAX_ATTEMPTS} Fehlversuchen`);
            return res.status(429).json({
                error: `Zu viele Fehlversuche.IP fuer 15 Minuten gesperrt.`,
                lockedMinutes: 15
            });
        }

        loginAttempts[ip] = record;
        return res.status(401).json({
            error: `Falsches Passwort.Noch ${remaining} Versuch(e) verbleibend.`,
            attemptsLeft: remaining
        });
    }
});

app.post('/api/admin/logout', requireTrustedOrigin, requireCsrfToken, (req, res) => {
    res.clearCookie(ADMIN_TOKEN_COOKIE, getAdminCookieOptions());
    res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
    if (isAdmin(req)) {
        res.json({ success: true });
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
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    const forceRefresh = String(req.query.refresh || '').toLowerCase() === '1'
        || String(req.query.refresh || '').toLowerCase() === 'true';
    if (forceRefresh) {
        await runDependencyScan();
    }

    const runtimeRun = await runSecuritySelfTest();

    const staticChecks = [
        {
            id: 'helmet',
            label: 'Sicherheits-Header aktiv (Helmet)',
            ok: true,
            detail: 'HTTP Security Header werden global gesetzt.'
        },
        {
            id: 'trusted-origins',
            label: 'Trusted Origins konfiguriert',
            ok: TRUSTED_BROWSER_ORIGINS.length > 0,
            detail: `${TRUSTED_BROWSER_ORIGINS.length} erlaubte Origin(s).`
        },
        {
            id: 'csrf',
            label: 'CSRF Schutz aktiv',
            ok: true,
            detail: 'Mutierende API-Routen erwarten Cookie + X-CSRF-Token.'
        },
        {
            id: 'rate-auth',
            label: 'Rate Limit für Auth aktiv',
            ok: true,
            detail: 'Login/Register und Admin-Login sind limitiert.'
        },
        {
            id: 'rate-coupon-review-view',
            label: 'Rate Limits für Coupon/Reviews/Views aktiv',
            ok: true,
            detail: 'Coupon, Reviews und Live-View Endpoint sind limitiert.'
        },
        {
            id: 'rate-admin-write',
            label: 'Rate Limit für Admin-Schreibaktionen aktiv',
            ok: true,
            detail: 'Produkt- und Bestellmutationen im Admin sind limitiert.'
        },
        {
            id: 'secrets',
            label: 'Kritische Secrets gesetzt',
            ok: Boolean(JWT_SECRET && ADMIN_PASSWORD && process.env.STRIPE_WEBHOOK_SECRET),
            detail: `JWT:${Boolean(JWT_SECRET)} ADMIN:${Boolean(ADMIN_PASSWORD)} WEBHOOK:${Boolean(process.env.STRIPE_WEBHOOK_SECRET)}`
        },
        {
            id: 'cookie-security',
            label: 'Cookie Sicherheitsmodus stimmig',
            ok: !IS_PRODUCTION || (getUserCookieOptions().secure && getAdminCookieOptions().secure),
            detail: IS_PRODUCTION
                ? 'In Produktion sind Secure-Cookies aktiv.'
                : 'Development-Modus: Secure-Cookies sind lokal deaktiviert.'
        },
        {
            id: 'input-validation',
            label: 'Serverseitige Input-Validierung aktiv',
            ok: true,
            detail: 'Sanitizer/Validatoren für User-, Coupon-, Review- und Produktdaten.'
        }
    ];

    const runtimeChecks = Array.isArray(runtimeRun && runtimeRun.tests)
        ? runtimeRun.tests.map(test => ({
            id: test.id,
            label: `${test.label} (Laufzeit-Test)`,
            ok: !!test.ok,
            detail: test.detail,
            severity: test.severity || 'warning'
        }))
        : [];

    const checks = [...staticChecks, ...runtimeChecks];
    const staticPassed = staticChecks.filter(check => check.ok).length;
    const staticTotal = staticChecks.length;
    const passed = checks.filter(check => check.ok).length;
    const score = Math.round((passed / checks.length) * 100);
    const dependencyAgeMs = dependencyMonitorState.lastRunAt
        ? (Date.now() - new Date(dependencyMonitorState.lastRunAt).getTime())
        : null;
    const dependencyStaleThresholdMs = Math.max(
        Number(dependencyMonitorState.intervalMs) * 1.5,
        15 * 60 * 1000
    );
    const dependencyIsStale = Number.isFinite(dependencyAgeMs)
        ? dependencyAgeMs > dependencyStaleThresholdMs
        : true;

    res.json({
        score,
        passed,
        total: checks.length,
        environment: IS_PRODUCTION ? 'production' : 'development',
        updatedAt: new Date().toISOString(),
        checks,
        monitor: {
            intervalMs: securityMonitorState.intervalMs,
            running: securityMonitorState.running,
            lastRunAt: securityMonitorState.lastRunAt,
            nextRunAt: securityMonitorState.nextRunAt,
            latestScore: runtimeRun ? runtimeRun.score : null,
            alerts: runtimeRun && Array.isArray(runtimeRun.alerts) ? runtimeRun.alerts : [],
            history: securityMonitorState.history.slice(0, 8).map(item => ({
                ...(function buildHistorySnapshot() {
                    const runtimeTotal = Array.isArray(item.tests) ? item.tests.length : 0;
                    const runtimeFailed = Array.isArray(item.tests) ? item.tests.filter(test => !test.ok).length : 0;
                    const runtimePassed = Math.max(0, runtimeTotal - runtimeFailed);
                    const combinedTotal = staticTotal + runtimeTotal;
                    const combinedPassed = staticPassed + runtimePassed;
                    return {
                        score: combinedTotal > 0 ? Math.round((combinedPassed / combinedTotal) * 100) : 0,
                        failedCount: Math.max(0, combinedTotal - combinedPassed),
                        runtimeScore: Number(item.score) || 0,
                        runtimeFailedCount: runtimeFailed
                    };
                })(),
                startedAt: item.startedAt,
                finishedAt: item.finishedAt,
                durationMs: item.durationMs
            }))
        },
        dependencyMonitor: {
            intervalMs: dependencyMonitorState.intervalMs,
            running: dependencyMonitorState.running,
            lastRunAt: dependencyMonitorState.lastRunAt,
            nextRunAt: dependencyMonitorState.nextRunAt,
            ageMs: dependencyAgeMs,
            staleThresholdMs: dependencyStaleThresholdMs,
            isStale: dependencyIsStale,
            latest: dependencyMonitorState.latest ? {
                runAt: dependencyMonitorState.latest.runAt,
                totals: dependencyMonitorState.latest.totals,
                ok: dependencyMonitorState.latest.ok,
                npmOk: dependencyMonitorState.latest.npmOk,
                osvOk: dependencyMonitorState.latest.osvOk,
                hasOsvFindings: dependencyMonitorState.latest.hasOsvFindings,
                npmFailures: dependencyMonitorState.latest.npmFailures || [],
                osvFailures: dependencyMonitorState.latest.osvFailures || [],
                scanCount: Array.isArray(dependencyMonitorState.latest.scans) ? dependencyMonitorState.latest.scans.length : 0,
                scans: Array.isArray(dependencyMonitorState.latest.scans)
                    ? dependencyMonitorState.latest.scans.map(scan => ({
                        id: scan.id,
                        npmOk: scan.npmOk,
                        osvOk: scan.osvOk,
                        npmError: scan.npmError || '',
                        osvError: scan.osvError || ''
                    }))
                    : []
            } : null,
            history: dependencyMonitorState.history.slice(0, 8)
        }
    });
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
        if (req.body.bestseller !== undefined) updateData.bestseller = req.body.bestseller;

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
            { new: true }
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
        const filter = (safeIds.length > 0) ? { id: { $in: safeIds } } : {};

        const result = await Product.updateMany(filter, { $set: updateData });
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
        const { id, name, category, inspiredBy, description, images, notes, variants } = req.body;

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
            variants: safeVariants
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
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    try {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

        // Auto-archive
        await Order.updateMany(
            { status: 'abgeschlossen', statusUpdatedAt: { $lte: threeDaysAgo } },
            { $set: { status: 'archiv', statusUpdatedAt: new Date() } }
        );

        const orders = await Order.find({}).sort({ date: -1 });
        res.json({ orders });
    } catch (err) {
        console.error('Fehler beim Laden der Bestellungen:', err);
        res.status(500).json({ error: 'Server Fehler' });
    }
});

app.put('/api/admin/orders/:id/status', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    try {
        const { status, trackingUrl } = req.body;
        const safeTrackingUrl = sanitizeTrackingUrl(trackingUrl);
        if (!['neu', 'in_bearbeitung', 'abgeschlossen', 'archiv'].includes(status)) {
            return res.status(400).json({ error: 'Ungültiger Status' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order nicht gefunden' });

        const previousStatus = order.status;
        order.status = status;
        order.statusUpdatedAt = new Date();
        await order.save();

        // Automatically send shipping notification when status changes to 'abgeschlossen'
        if (status === 'abgeschlossen' && previousStatus !== 'abgeschlossen' && order.email) {
            try {
                const isPickup = order.address && order.address.line1 &&
                    order.address.line1.toLowerCase().includes('selbstabholung');

                if (!isPickup) {
                    const shippingMail = buildShippingEmailPayload({
                        customerName: order.name || 'du',
                        trackingUrl: safeTrackingUrl
                    });

                    await resend.emails.send({
                        from: 'NOTE. fragrances <info@note-fragrances.de>',
                        to: order.email,
                        subject: shippingMail.subject,
                        html: shippingMail.html
                    });
                    console.log(`Versand-Email gesendet an ${order.email} für Bestellung ${order._id}`);
                }
            } catch (emailErr) {
                // Email fehler soll den Status-Update nicht blockieren
                console.error('Fehler beim Senden der Versand-Email:', emailErr);
            }
        }

        res.json({ success: true, order });
    } catch (err) {
        console.error('Fehler beim Update des Order Status:', err);
        res.status(500).json({ error: 'Server Fehler' });
    }
});

app.delete('/api/admin/orders/:id', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const deletedOrder = await Order.findByIdAndDelete(req.params.id);
        if (!deletedOrder) {
            return res.status(404).json({ error: 'Order nicht gefunden' });
        }

        res.json({
            success: true,
            deletedId: String(deletedOrder._id || req.params.id)
        });
    } catch (err) {
        console.error('Fehler beim Loeschen der Bestellung:', err);
        res.status(500).json({ error: 'Server Fehler' });
    }
});

app.post('/api/admin/orders/:id/notify-pickup', adminWriteLimiter, requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order nicht gefunden' });
        if (!order.email) return res.status(400).json({ error: 'Keine Email vorhanden' });

        // Update status to "in_bearbeitung" if it was "neu", 
        // but typically the admin might have packed it and wants to notify
        // Actually this is just sending the email, but we could also auto-advance the status if requested.

        const pickupReadyMail = buildPickupReadyEmailPayload({
            customerName: order.name || 'du',
            amountCents: order.amount
        });

        await resend.emails.send({
            from: 'NOTE. fragrances <info@note-fragrances.de>',
            to: order.email,
            subject: pickupReadyMail.subject,
            html: pickupReadyMail.html
        });

        order.pickupEmailSent = true;
        await order.save();

        res.json({ success: true, order });
    } catch (err) {
        console.error('Fehler beim Senden der Abhol-Email:', err);
        res.status(500).json({ error: 'Fehler beim Senden der Mail' });
    }
});

app.post('/admin/logout', (req, res) => {
    res.clearCookie(ADMIN_TOKEN_COOKIE, getAdminCookieOptions());
    res.status(410).send('Legacy admin route disabled.');
});

app.get('/admin', async (req, res) => {
    res.status(410).send('Legacy admin route disabled. Use /frontend/admin.html with the API login.');

    const ordersFilePath = path.join(__dirname, 'orders.json');

    if (!fs.existsSync(ordersFilePath)) {
        res.send(`
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8" />
        <title>Bestellungen</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #111; color: #f5f5f5; padding: 2rem; }
          h1 { margin-bottom: 1.5rem; }
          .no-orders { padding: 1rem; background-color: #222; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h1 style="margin-bottom: 0;">Bestellungen</h1>
            <form action="/admin/logout" method="POST">
                <button type="submit" style="background: #444; color: white; border: none; padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px;">Abmelden</button>
            </form>
        </div>
        <div class="no-orders">Keine Bestellungen vorhanden</div>
      </body>
      </html>
    `);
        return;
    }

    let orders = [];

    try {
        const data = fs.readFileSync(ordersFilePath, 'utf8');
        orders = data ? JSON.parse(data) : [];
    } catch (err) {
        console.error('Fehler beim Lesen von orders.json im /admin-Endpoint:', err);
        orders = [];
    }

    if (!orders.length) {
        res.send(`
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8" />
        <title>Bestellungen</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #111; color: #f5f5f5; padding: 2rem; }
          h1 { margin-bottom: 1.5rem; }
          .no-orders { padding: 1rem; background-color: #222; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h1 style="margin-bottom: 0;">Bestellungen</h1>
            <form action="/admin/logout" method="POST">
                <button type="submit" style="background: #444; color: white; border: none; padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px;">Abmelden</button>
            </form>
        </div>
        <div class="no-orders">Keine Bestellungen vorhanden</div>
      </body>
      </html>
    `);
        return;
    }

    const rows = orders
        .map(order => {
            const date = order.date ? new Date(order.date).toLocaleString('de-DE') : '';
            const name = order.name || '';
            const email = order.email || '';
            let address = 'Keine Adresse';

            if (order.address) {
                const street = order.address.line1 || '';
                const postalCode = order.address.postal_code || '';
                const city = order.address.city || '';
                const parts = [];

                if (street) {
                    parts.push(street);
                }

                const plzOrt = [postalCode, city].filter(Boolean).join(' ');
                if (plzOrt) {
                    parts.push(plzOrt);
                }

                if (parts.length) {
                    address = parts.join(', ');
                }
            }

            const amount = typeof order.amount === 'number' ? `${order.amount.toFixed(2)} €` : '';

            let productsHtml = '<em>Keine Produkte</em>';
            if (order.items && Array.isArray(order.items)) {
                productsHtml = order.items.map(item => {
                    return `<div>${item.quantity}x ${item.description}</div>`;
                }).join('');
            }

            return `
                <tr>
                    <td>${date}</td>
                    <td>${name}</td>
                    <td>${email}</td>
                    <td>${address}</td>
                    <td>${productsHtml}</td>
                    <td>${amount}</td>
                </tr>
                `;
        })
        .join('');

    const html = `
                <!DOCTYPE html>
                <html lang="de">
                    <head>
                        <meta charset="UTF-8" />
                        <title>Bestellungen</title>
                        <style>
                            body {font - family: Arial, sans-serif; background-color: #111; color: #f5f5f5; padding: 2rem; }
                            h1 {margin - bottom: 1.5rem; }
                            table {width: 100%; border-collapse: collapse; background-color: #1a1a1a; border-radius: 8px; overflow: hidden; }
                            thead {background - color: #333; }
                            th, td {padding: 0.75rem 1rem; text-align: left; font-size: 0.9rem; }
                            th {text - transform: uppercase; letter-spacing: 0.05em; font-size: 0.8rem; color: #ddd; }
                            tbody tr:nth-child(even) {background - color: #181818; }
                            tbody tr:nth-child(odd) {background - color: #141414; }
                            tbody tr:hover {background - color: #222; }
                        </style>
                    </head>
                    <body>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                            <h1 style="margin-bottom: 0;">Bestellungen</h1>
                            <form action="/admin/logout" method="POST">
                                <button type="submit" style="background: #444; color: white; border: none; padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px;">Abmelden</button>
                            </form>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th>Datum</th>
                                    <th>Kunde</th>
                                    <th>E-Mail</th>
                                    <th>Adresse</th>
                                    <th>Produkte</th>
                                    <th>Betrag</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows}
                            </tbody>
                        </table>
                    </body>
                </html>
                `;

    res.send(html);
});

app.post('/create-checkout-session', requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    try {
        const { items, customerEmail, couponCode } = req.body; // Expecting {items: [{id: "1-50", quantity: 2 }, ...], customerEmail: "...", couponCode: "NOTE-XXXXX" }
        const normalizedCustomerEmail = customerEmail ? sanitizeEmail(customerEmail) : '';

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Warenkorb ist leer oder ungültig' });
        }

        if (customerEmail && !normalizedCustomerEmail) {
            return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
        }

        const line_items = [];

        let subtotal = 0;

        for (const item of items) {
            const quantity = sanitizeQuantity(item.quantity);
            if (!quantity) {
                return res.status(400).json({ error: 'Ungültige Menge im Warenkorb.' });
            }

            // "G1-50" -> baseId "G1", size "50"
            const match = item.id.match(/^(.+?)-(\d+)$/);
            if (!match) return res.status(400).json({ error: 'Ungültige Produkt-ID: ' + item.id });
            const [, baseId, sizeStr] = match;
            const size = parseInt(sizeStr, 10);

            const product = await Product.findOne({ id: baseId });

            if (!product || !product.variants[size]) {
                return res.status(404).json({ error: `Produkt mit ID ${item.id} nicht gefunden` });
            }

            const priceInCents = Math.round(product.variants[size].price * 100);

            line_items.push({
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: product.name + ' (' + size + 'ml)',
                    },
                    unit_amount: priceInCents,
                },
                quantity,
            });

            subtotal += priceInCents * quantity;
        }

        let appliedCoupon = null;
        let discountAmountCents = 0;
        if (couponCode) {
            appliedCoupon = await findValidCoupon(couponCode);
            if (!appliedCoupon) {
                return res.status(400).json({ error: 'Gutscheincode ist ungültig oder bereits verbraucht.' });
            }

            discountAmountCents = Math.round(subtotal * (appliedCoupon.discount / 100));
        }

        // Kostenloser Versand ab 60€ (6000 Cents) oder wenn Coupon freien Versand erzwingt.
        const hasCouponFreeShipping = !!(appliedCoupon && appliedCoupon.freeShipping === true);
        const shippingRate = (subtotal >= 6000 || hasCouponFreeShipping) ? 0 : 699;
        const shippingDisplayName = (subtotal >= 6000 || hasCouponFreeShipping) ? 'Kostenloser Versand' : 'Standardversand';

        const sessionConfig = {
            // Kein payment_method_types → Stripe nutzt automatisch alle im Dashboard aktivierten
            // Zahlungsmethoden (Karte, PayPal, Klarna, SEPA etc.)
            line_items: line_items,
            mode: 'payment',
            shipping_address_collection: {
                allowed_countries: ['DE', 'AT', 'CH'],
            },
            phone_number_collection: {
                enabled: false,
            },
            tax_id_collection: {
                enabled: false,
            },
            shipping_options: [
                {
                    shipping_rate_data: {
                        type: 'fixed_amount',
                        fixed_amount: {
                            amount: shippingRate,
                            currency: 'eur',
                        },
                        display_name: shippingDisplayName,
                        delivery_estimate: {
                            minimum: {
                                unit: 'business_day',
                                value: 1,
                            },
                            maximum: {
                                unit: 'business_day',
                                value: 3,
                            },
                        },
                    },
                },
            ],
            cancel_url: buildFrontendPageUrl('cancel.html'),
            success_url: buildFrontendPageUrl('success.html'),
            metadata: {
                couponCode: appliedCoupon ? appliedCoupon.code : '',
                discountAmountCents: String(discountAmountCents),
                discountPercent: appliedCoupon ? String(appliedCoupon.discount) : '0',
                freeShippingCoupon: hasCouponFreeShipping ? '1' : '0'
            }
        };

        if (normalizedCustomerEmail) {
            sessionConfig.customer_email = normalizedCustomerEmail;
        }

        if (appliedCoupon && discountAmountCents > 0) {
            const stripeCoupon = await stripe.coupons.create({
                amount_off: discountAmountCents,
                currency: 'eur',
                duration: 'once',
                name: `${appliedCoupon.code} (${appliedCoupon.discount}% Rabatt)`
            });
            sessionConfig.discounts = [{ coupon: stripeCoupon.id }];
        }

        if (LOCAL_DEV_SAFE_MODE) {
            return res.json({
                safeMode: true,
                couponApplied: !!appliedCoupon,
                couponCode: appliedCoupon ? appliedCoupon.code : '',
                subtotalCents: subtotal,
                discountAmountCents,
                couponFreeShipping: hasCouponFreeShipping,
                shippingRateCents: shippingRate,
                totalCents: Math.max(0, subtotal - discountAmountCents + shippingRate),
                message: 'Lokaler Testmodus: Keine echte Stripe-Session erzeugt.'
            });
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/create-pickup-order', requireTrustedOrigin, requireCsrfToken, async (req, res) => {
    try {
        const { items, customerName, customerEmail, couponCode } = req.body;
        if (!items || !items.length) return res.status(400).json({ error: 'Warenkorb leer' });

        const safeCustomerName = sanitizeText(customerName, 120);
        const normalizedCustomerEmail = sanitizeEmail(customerEmail);
        if (!safeCustomerName || !normalizedCustomerEmail) {
            return res.status(400).json({ error: 'Name und gültige E-Mail sind erforderlich.' });
        }

        const line_items = [];
        let totalCents = 0;

        for (const item of items) {
            const quantity = sanitizeQuantity(item.quantity);
            if (!quantity) {
                return res.status(400).json({ error: 'Ungültige Menge im Warenkorb.' });
            }

            const match = item.id.match(/^(.+?)-(\d+)$/);
            if (!match) return res.status(400).json({ error: 'Ungültige Produkt-ID: ' + item.id });
            const [, baseId, sizeStr] = match;
            const size = parseInt(sizeStr, 10);
            const product = await Product.findOne({ id: baseId });
            if (!product || !product.variants[size]) {
                return res.status(404).json({ error: `Produkt mit ID ${item.id} nicht gefunden` });
            }

            const priceCents = Math.round(product.variants[size].price * 100);
            totalCents += priceCents * quantity;

            line_items.push({
                quantity,
                description: product.name + ' (' + size + 'ml) [BARZAHLUNG]',
                amount_total: priceCents * quantity,
                imageUrl: product.images && product.images.length > 0 ? product.images[0] : ''
            });
        }

        if (!line_items.length || totalCents <= 0) {
            return res.status(400).json({ error: 'Warenkorb ist leer oder ungültig.' });
        }

        let appliedCoupon = null;
        let discountAmountCents = 0;
        if (couponCode) {
            appliedCoupon = await findValidCoupon(couponCode);
            if (!appliedCoupon) {
                return res.status(400).json({ error: 'Gutscheincode ist ungültig oder bereits verbraucht.' });
            }

            discountAmountCents = Math.round(totalCents * (appliedCoupon.discount / 100));
            totalCents = Math.max(0, totalCents - discountAmountCents);
        }

        const newOrder = new Order({
            date: new Date().toISOString(),
            email: normalizedCustomerEmail,
            name: safeCustomerName,
            amount: totalCents,
            discountAmount: discountAmountCents,
            couponCode: appliedCoupon ? appliedCoupon.code : '',
            address: { line1: 'Selbstabholung (Zahlung vor Ort)', city: '', postal_code: '', country: '' },
            items: line_items
        });
        await newOrder.save();

        if (appliedCoupon) {
            appliedCoupon.used = true;
            await appliedCoupon.save();
        }

        if (normalizedCustomerEmail && !LOCAL_DEV_SAFE_MODE) {
            try {
                const emailItems = line_items.map((item) => ({
                    description: item.description,
                    quantity: item.quantity,
                    imageUrl: item.imageUrl,
                    amountText: Number.isFinite(Number(item.amount_total))
                        ? formatEuroFromCents(item.amount_total)
                        : '0,00'
                }));
                const pickupOrderMail = buildPickupOrderConfirmationEmailPayload({
                    customerName: safeCustomerName,
                    items: emailItems,
                    discountAmountCents,
                    couponCode: appliedCoupon ? appliedCoupon.code : '',
                    totalAmountCents: totalCents
                });

                await resend.emails.send({
                    from: 'NOTE. fragrances <info@note-fragrances.de>',
                    to: normalizedCustomerEmail,
                    subject: pickupOrderMail.subject,
                    html: pickupOrderMail.html
                });
                console.log('[Email] Pickup-Bestellbestaetigung gesendet an:', normalizedCustomerEmail);
            } catch (emailErr) {
                console.error('[Email] Fehler beim Senden Pickup-Bestellbestätigung:', emailErr);
            }
        } else if (LOCAL_DEV_SAFE_MODE) {
            console.log('[Safe Mode] Pickup-Bestellbestätigung wurde nicht versendet.');
        }

        res.json({ success: true, orderId: newOrder._id });
    } catch (e) {
        console.error('Pickup order error:', e);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    startSecurityMonitorLoop();
});

app.get('/api/products', async (req, res) => {
    try {
        if (!productCache) {
            console.log('[Cache] Cache leer, lade aus Datenbank...');
            await refreshProductCache();
        }
        const products = Array.isArray(productCache) ? productCache : [];
        const reviewSummaryMap = await buildReviewSummaryMap(products.map(product => product.id));
        const enrichedProducts = products.map(product => {
            const plainProduct = typeof product.toObject === 'function' ? product.toObject() : product;
            return {
                ...plainProduct,
                reviewSummary: reviewSummaryMap[plainProduct.id] || { average: 0, count: 0 }
            };
        });
        res.json(enrichedProducts);
    } catch (e) {
        console.error("Products error:", e);
        res.status(500).json({ error: e.message || 'Server error' });
    }
});

// Fallback Error-Handler: keine internen Details an den Client leaken
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Interner Serverfehler.' });
});
