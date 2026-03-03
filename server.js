require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();

mongoose.connect(process.env.MONGO_URI, {
}).then(() => console.log('MongoDB connected')).catch(err => console.log('MongoDB connection error:', err));

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAdmin(req) {
    const cookies = parseCookies(req);
    return cookies.api_admin_auth === 'true' || req.headers.authorization === 'Bearer true';
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


const cors = require('cors');

// Enable CORS for frontend
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500', 'http://localhost:5500', 'https://keen-mooncake-5c73e2.netlify.app', 'https://note-fragrances.de', 'https://www.note-fragrances.de'], // Allow common local UI ports, netlify and custom domain
    credentials: true
}));
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

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('Zahlung erfolgreich!');

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

            console.log('Versanddetails:', session.shipping_details);
            console.log('Kundendetails:', session.customer_details);

            const addressData = session.customer_details ? session.customer_details.address : null;

            const newOrder = {
                date: new Date().toISOString(),
                email: session.customer_details && session.customer_details.email,
                name: session.customer_details && session.customer_details.name,
                amount: session.amount_total,  // kept in cents; admin UI divides by 100
                address: addressData,
                items: items
            };

            // Save to MongoDB (primary)
            try {
                const order = new Order(newOrder);
                await order.save();
                console.log('Bestellung in MongoDB gespeichert:', order._id);
            } catch (dbErr) {
                console.error('MongoDB Fehler, Fallback auf orders.json:', dbErr);
                // Fallback: write to orders.json
                const ordersFilePath = path.join(__dirname, 'orders.json');
                let orders = [];
                if (fs.existsSync(ordersFilePath)) {
                    try { orders = JSON.parse(fs.readFileSync(ordersFilePath, 'utf8')); } catch (e) { }
                }
                orders.push(newOrder);
                try { fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8'); } catch (e) { }
            }

            // Send order confirmation email to customer
            const customerEmail = session.customer_details && session.customer_details.email;
            const customerName = session.customer_details && session.customer_details.name || 'Kunde';
            if (customerEmail) {
                try {
                    const itemsHtml = items.length > 0
                        ? items.map(i => {
                            const imgTag = i.imageUrl
                                ? `<img src="${i.imageUrl}" width="60" height="60" alt="${i.description}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #e6e6e6;background:#fff;display:block;">`
                                : `<div style="width:60px;height:60px;background:#f0ede8;border-radius:4px;border:1px solid #e6e6e6;display:inline-block;"></div>`;
                            return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e6e6e6;">
                              <tr>
                                <td style="width:70px;vertical-align:middle;">${imgTag}</td>
                                <td style="padding-left:14px;vertical-align:middle;font-family:'Inter',Arial,sans-serif;">
                                  <p style="margin:0;font-size:14px;color:#1a1a1a;font-weight:500;">${i.description}</p>
                                  <p style="margin:3px 0 0;font-size:12px;color:#999999;">Menge: ${i.quantity}</p>
                                </td>
                                <td style="text-align:right;vertical-align:middle;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#1a1a1a;font-weight:500;white-space:nowrap;">${i.amount_total.toFixed(2).replace('.', ',')} €</td>
                              </tr>
                            </table>`;
                        }).join('')
                        : '<p style="color:#999;font-size:13px;">–</p>';

                    const totalFormatted = (newOrder.amount / 100).toFixed(2).replace('.', ',');

                    // Lieferadresse des Kunden aufbereiten
                    const addr = session.shipping_details && session.shipping_details.address
                        ? session.shipping_details.address
                        : (session.customer_details && session.customer_details.address);
                    const addrHtml = addr
                        ? `${addr.line1 || ''}${addr.line2 ? '<br>' + addr.line2 : ''}<br>${addr.postal_code || ''} ${addr.city || ''}<br>${addr.country || ''}`
                        : '–';

                    await resend.emails.send({
                        from: 'NOTE. fragrances <info@note-fragrances.de>',
                        to: customerEmail,
                        subject: `Deine Bestellung bei NOTE. fragrances \u2713`,
                        html: `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#e2dfd8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e2dfd8;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

      <tr><td style="height:8px;background:#000000;"></td></tr>

      <tr><td style="background:#f5f3ee;padding:26px 48px 18px;text-align:center;">
        <p style="margin:0 0 5px;font-family:Georgia,serif;color:#000000;font-size:30px;letter-spacing:0.12em;font-weight:400;">N\u00d8TE.</p>
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
        <div style="display:inline-block;width:62px;height:62px;border-radius:50%;border:1.5px solid #d4af37;line-height:60px;font-size:22px;color:#d4af37;margin-bottom:22px;">\u2713</div>
        <p style="margin:0 0 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#d4af37;font-weight:700;">Bestellbest\u00e4tigung</p>
        <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:28px;color:#1a1a1a;font-weight:400;">Vielen Dank, ${customerName}!</h1>
        <p style="margin:0 auto;font-size:13px;color:#666;line-height:1.8;max-width:380px;">Deine Bestellung ist bei uns eingegangen und wird schnellstm\u00f6glich bearbeitet. Wir melden uns, sobald dein Paket auf dem Weg ist.</p>
      </td></tr>

      <tr><td style="background:#f5f3ee;padding:0 40px;"><div style="border-top:1px solid #dedad3;"></div></td></tr>

      <tr><td style="background:#f5f3ee;padding:28px 40px 0;">
        <p style="margin:0 0 18px;font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#aaaaaa;font-weight:600;">Deine Bestellung</p>
        ${itemsHtml}
      </td></tr>

      <tr><td style="background:#f5f3ee;padding:0 40px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 16px;">
          <tr>
            <td style="font-size:13px;color:#999;">Versand</td>
            <td style="text-align:right;font-size:13px;color:#999;">${session.shipping_cost ? (session.shipping_cost.amount_total / 100).toFixed(2).replace('.', ',') + ' \u20ac' : 'Kostenlos'}</td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #d4af37;padding-top:14px;margin-top:4px;">
          <tr>
            <td style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.15em;vertical-align:bottom;">Gesamtbetrag</td>
            <td style="text-align:right;font-family:Georgia,serif;font-size:26px;color:#1a1a1a;font-weight:400;vertical-align:bottom;">${totalFormatted} \u20ac</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="background:#f5f3ee;padding:0 40px;"><div style="border-top:1px solid #dedad3;"></div></td></tr>

      <tr><td style="background:#f5f3ee;padding:32px 48px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-size:13px;color:#888;">Fragen zu deiner Bestellung?</p>
        <a href="mailto:info@note-fragrances.de" style="font-size:14px;color:#000;font-weight:700;text-decoration:none;">info@note-fragrances.de</a>
      </td></tr>

      <tr><td style="height:2px;background:#d4af37;"></td></tr>
      <tr><td style="background:#000;padding:28px 48px 24px;text-align:center;">
        <p style="margin:0 0 6px;font-family:Georgia,serif;color:#fff;font-size:17px;letter-spacing:0.22em;">N\u00d8TE. fragrances</p>
        <p style="margin:0 0 16px;font-size:11px;color:#555;">Warnitzer Str. 20 \u00b7 13057 Berlin \u00b7 Deutschland</p>
        <p style="margin:0;font-size:11px;">
          <a href="https://note-fragrances.de/datenschutz.html" style="color:#555;text-decoration:none;">Datenschutz</a>
          <span style="color:#333;">&nbsp;\u00b7&nbsp;</span>
          <a href="https://note-fragrances.de/impressum.html" style="color:#555;text-decoration:none;">Impressum</a>
          <span style="color:#333;">&nbsp;\u00b7&nbsp;</span>
          <a href="https://note-fragrances.de/widerrufsrecht.html" style="color:#555;text-decoration:none;">Widerruf</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



// --- User Auth Routes ---

app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }

    if (await User.findOne({ email })) {
        return res.status(400).json({ error: 'Email bereits registriert' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({ email, password: hashedPassword, name: name || '' });
    await user.save();


    res.json({ success: true, message: 'Registrierung erfolgreich' });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Ungültige Email oder Passwort' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    // Set HTTP-only cookie
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ success: true, user: { name: user.name, email: user.email } });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

app.get('/api/user', async (req, res) => {
    const token = parseCookies(req).auth_token;
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

app.put('/api/user/profile', async (req, res) => {
    const token = parseCookies(req).auth_token;
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

        const { firstName, lastName } = req.body;

        if (firstName !== undefined) user.firstName = firstName;
        if (lastName !== undefined) user.lastName = lastName;

        await user.save();

        res.json({ success: true });
    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
});

app.post('/api/user/address', async (req, res) => {
    const token = parseCookies(req).auth_token;
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.userId });
        if (!user) return res.status(404).json({ error: 'User nicht gefunden' });

        const { firstName, lastName, label, street, city, zip, country } = req.body;

        if (!user.addresses) user.addresses = [];

        const newAddress = {
            id: uuidv4(),
            firstName,
            lastName,
            label,
            street,
            city,
            zip,
            country
        };

        user.addresses.push(newAddress);
        await user.save();

        res.json({ success: true, addresses: user.addresses });
    } catch (err) {
        res.status(401).json({ error: 'Ungültiger Token' });
    }
});

app.delete('/api/user/address/:id', async (req, res) => {
    const token = parseCookies(req).auth_token;
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
    const token = parseCookies(req).auth_token;
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


// Produkte laden
const productsFilePath = path.join(__dirname, 'products.json');
let products = [];
try {
    const data = fs.readFileSync(productsFilePath, 'utf8');
    products = JSON.parse(data);
} catch (err) {
    console.error('Fehler beim Laden von products.json:', err);
}

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

app.post('/api/view-product', (req, res) => {
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
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.setHeader('Set-Cookie', 'admin_auth=true; HttpOnly; Path=/; Max-Age=3600');
        res.redirect('/admin');
    } else {
        res.send(`
    < script > alert('Falsches Passwort'); window.location.href = '/admin';</script >
        `);
    }
});

// --- Brute-force protection for admin login ---
const loginAttempts = {}; // {ip: {count, lockedUntil} }
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown').split(',')[0].trim();
}

// --- NEW API-based Admin Routes ---
app.post('/api/admin/login', (req, res) => {
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
    if (password === ADMIN_PASSWORD) {
        // Success – clear attempts
        delete loginAttempts[ip];
        res.cookie('api_admin_auth', 'true', {
            httpOnly: false,
            secure: true,        // Required for SameSite=None
            sameSite: 'None',    // Allow cross-origin requests to send this cookie
            maxAge: 3600 * 1000  // 1 hour
        });
        res.json({ success: true, token: 'true' });
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

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('api_admin_auth', {
        httpOnly: false,
        secure: true,
        sameSite: 'None',
        path: '/'
    });
    res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
    if (isAdmin(req)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Not authorized' });
    }
});

app.delete('/api/admin/products/:id', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const deletedProduct = await Product.findOneAndDelete({ id: req.params.id });
        if (!deletedProduct) {
            return res.status(404).json({ error: 'Produkt nicht gefunden' });
        }
        res.json({ success: true, message: 'Produkt gelöscht' });
    } catch (err) {
        console.error('Fehler beim Löschen:', err);
        res.status(500).json({ error: 'Server Fehler beim Löschen' });
    }
});

app.put('/api/admin/products/:id', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const { name, inspiredBy, description, category, price30, price50, originalPrice30, originalPrice50 } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (inspiredBy !== undefined) updateData.inspiredBy = inspiredBy;
        if (description !== undefined) updateData.description = description;
        if (category !== undefined) updateData.category = category;
        if (req.body.bestseller !== undefined) updateData.bestseller = req.body.bestseller;

        // Variants
        if (price30 !== undefined) updateData['variants.30.price'] = parseFloat(price30);
        if (price50 !== undefined) updateData['variants.50.price'] = parseFloat(price50);
        if (originalPrice30 !== undefined) updateData['variants.30.originalPrice'] = parseFloat(originalPrice30) || null;
        if (originalPrice50 !== undefined) updateData['variants.50.originalPrice'] = parseFloat(originalPrice50) || null;

        const updated = await Product.findOneAndUpdate(
            { id: req.params.id },
            { $set: updateData },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ error: 'Produkt nicht gefunden' });
        }
        res.json({ success: true, product: updated });
    } catch (err) {
        console.error('Fehler beim Aktualisieren:', err);
        res.status(500).json({ error: 'Server Fehler beim Aktualisieren' });
    }
});

// Bulk price update – updates any subset of products (or ALL if ids array is empty/missing)
app.put('/api/admin/products-bulk', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const { ids, price30, price50, originalPrice30, originalPrice50 } = req.body;

        const updateData = {};
        if (price30 !== undefined && price30 !== '') updateData['variants.30.price'] = parseFloat(price30);
        if (price50 !== undefined && price50 !== '') updateData['variants.50.price'] = parseFloat(price50);
        if (originalPrice30 !== undefined) updateData['variants.30.originalPrice'] = originalPrice30 !== '' ? parseFloat(originalPrice30) : null;
        if (originalPrice50 !== undefined) updateData['variants.50.originalPrice'] = originalPrice50 !== '' ? parseFloat(originalPrice50) : null;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'Keine Preisfelder angegeben' });
        }

        // If ids provided → only update those, else update ALL
        const filter = (ids && ids.length > 0) ? { id: { $in: ids } } : {};

        const result = await Product.updateMany(filter, { $set: updateData });
        res.json({ success: true, updated: result.modifiedCount });
    } catch (err) {
        console.error('Bulk update Fehler:', err);
        res.status(500).json({ error: 'Server Fehler beim Massenupdate' });
    }
});

// Bulk bestseller update – set/unset bestseller for a list of product IDs
app.put('/api/admin/products-bestseller', async (req, res) => {
    const cookies = parseCookies(req);
    if (cookies.api_admin_auth !== 'true') {
        return res.status(401).json({ error: 'Not authorized' });
    }
    try {
        const { ids, bestseller } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ error: 'ids array required' });
        }
        const result = await Product.updateMany(
            { id: { $in: ids } },
            { $set: { bestseller: !!bestseller } }
        );
        res.json({ success: true, updated: result.modifiedCount });
    } catch (err) {
        console.error('Bestseller bulk update Fehler:', err);
        res.status(500).json({ error: 'Server Fehler' });
    }
});

// Create new product
app.post('/api/admin/products', async (req, res) => {
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        const { id, name, category, inspiredBy, description, images, notes, variants } = req.body;

        if (!id || !name) {
            return res.status(400).json({ error: 'ID und Name sind Pflichtfelder' });
        }

        // Check for duplicate ID
        const existing = await Product.findOne({ id: id.toUpperCase() });
        if (existing) {
            return res.status(409).json({ error: 'Produkt-ID existiert bereits: ' + id });
        }

        const newProduct = new Product({
            id: id.toUpperCase(),
            name,
            category: category || 'unisex',
            inspiredBy: inspiredBy || '',
            description: description || '',
            images: images || [],
            notes: notes || {},
            variants: variants || {}
        });

        await newProduct.save();
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
        const orders = await Order.find({}).sort({ date: -1 });
        res.json({ orders });
    } catch (err) {
        console.error('Fehler beim Laden der Bestellungen:', err);
        res.status(500).json({ error: 'Server Fehler' });
    }
});

app.post('/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'admin_auth=; HttpOnly; Path=/; Max-Age=0');
    res.redirect('/admin');
});

app.get('/admin', async (req, res) => {
    const cookies = parseCookies(req);
    if (cookies.admin_auth !== 'true') {
        res.send(`
    < !DOCTYPE html >
        <html lang="de">
            <head>
                <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Admin Login</title>
                        <style>
                            body {font - family: sans-serif; background-color: #f9f8f4; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; color: #1a1a1a; }
                            .login-container {background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; width: 100%; max-width: 400px; }
                            input {padding: 0.8rem; margin-bottom: 1.5rem; border: 1px solid #e6e6e6; border-radius: 6px; width: 100%; box-sizing: border-box; font-size: 1rem; }
                            button {background - color: #000; color: white; padding: 0.8rem 1.5rem; border: none; border-radius: 6px; cursor: pointer; width: 100%; font-size: 1rem; font-weight: 500; transition: background 0.3s; }
                            button:hover {background - color: #333; }
                            h1 {margin - top: 0; margin-bottom: 1.5rem; font-weight: 600; }
                        </style>
                    </head>
                    <body>
                        <div class="login-container">
                            <h1>Admin Login</h1>
                            <form action="/admin/login" method="POST">
                                <input type="password" name="password" placeholder="Passwort eingeben" required>
                                    <button type="submit">Anmelden</button>
                            </form>
                        </div>
                    </body>
                </html>
                `);
        return;
    }

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

app.post('/create-checkout-session', async (req, res) => {
    try {
        const { items, customerEmail } = req.body; // Expecting {items: [{id: "1-50", quantity: 2 }, ...], customerEmail: "..." }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Warenkorb ist leer oder ungültig' });
        }

        const line_items = [];

        let subtotal = 0;

        for (const item of items) {
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
                quantity: item.quantity,
            });

            subtotal += priceInCents * item.quantity;
        }

        // Kostenloser Versand ab 50€ (5000 Cents)
        const shippingRate = subtotal >= 5000 ? 0 : 499;
        const shippingDisplayName = subtotal >= 5000 ? 'Kostenloser Versand' : 'Standardversand';

        const sessionConfig = {
            payment_method_types: ['card', 'paypal', 'klarna'],
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
                                value: 3,
                            },
                            maximum: {
                                unit: 'business_day',
                                value: 5,
                            },
                        },
                    },
                },
            ],
            success_url: 'https://note-fragrances.de/success.html',
            cancel_url: 'https://note-fragrances.de/cancel.html',
        };

        if (customerEmail) {
            sessionConfig.customer_email = customerEmail;
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/create-pickup-order', async (req, res) => {
    try {
        const { items, customerName, customerEmail } = req.body;
        if (!items || !items.length) return res.status(400).json({ error: 'Warenkorb leer' });

        const line_items = [];
        let totalCents = 0;

        for (const item of items) {
            const match = item.id.match(/^(.+?)-(\d+)$/);
            if (!match) continue;
            const [, baseId, sizeStr] = match;
            const size = parseInt(sizeStr, 10);
            const product = await Product.findOne({ id: baseId });
            if (!product || !product.variants[size]) continue;

            const priceCents = Math.round(product.variants[size].price * 100);
            totalCents += priceCents * item.quantity;

            line_items.push({
                quantity: item.quantity,
                description: product.name + ' (' + size + 'ml) [BARZAHLUNG]',
                amount_total: priceCents * item.quantity
            });
        }

        const newOrder = new Order({
            date: new Date().toISOString(),
            email: customerEmail,
            name: customerName,
            amount: totalCents,
            address: { line1: 'Selbstabholung (Zahlung vor Ort)', city: '', postal_code: '', country: '' },
            items: line_items
        });
        await newOrder.save();

        res.json({ success: true, orderId: newOrder._id });
    } catch (e) {
        console.error('Pickup order error:', e);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

const PORT = 4242;
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});

app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find({}, '-_id -__v');
        res.json(products);
    } catch (e) {
        console.error("Products error:", e);
        res.status(500).json({ error: e.message || 'Server error' });
    }
});


