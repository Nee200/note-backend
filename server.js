require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500', 'http://localhost:5500', 'https://keen-mooncake-5c73e2.netlify.app'], // Allow common local UI ports and netlify
    credentials: true
}));
// Webhook-Route MUSS vor app.use(express.json()) definiert werden
app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    let event;

    // Use the secret provided by the user
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('Zahlung erfolgreich!');

            // Line Items von Stripe abrufen
            let items = [];
            try {
                const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
                items = lineItems.data.map(item => ({
                    description: item.description,
                    quantity: item.quantity,
                    amount_total: item.amount_total / 100,
                    currency: item.currency
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
                amount: session.amount_total ? session.amount_total / 100 : null,
                address: addressData,
                items: items // Produkte hinzufügen
            };

            const ordersFilePath = path.join(__dirname, 'orders.json');
            let orders = [];

            if (fs.existsSync(ordersFilePath)) {
                try {
                    const data = fs.readFileSync(ordersFilePath, 'utf8');
                    orders = data ? JSON.parse(data) : [];
                } catch (err) {
                    console.error('Fehler beim Lesen von orders.json:', err);
                    orders = [];
                }
            }

            orders.push(newOrder);

            try {
                fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8');
                console.log('Bestellung in orders.json gespeichert!');
            } catch (err) {
                console.error('Fehler beim Schreiben in orders.json:', err);
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
const productViewers = {}; // { productId: [ { ip, timestamp } ] }

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
            <script>alert('Falsches Passwort'); window.location.href='/admin';</script>
        `);
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
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Login</title>
            <style>
                body { font-family: sans-serif; background-color: #f9f8f4; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; color: #1a1a1a; }
                .login-container { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; width: 100%; max-width: 400px; }
                input { padding: 0.8rem; margin-bottom: 1.5rem; border: 1px solid #e6e6e6; border-radius: 6px; width: 100%; box-sizing: border-box; font-size: 1rem; }
                button { background-color: #000; color: white; padding: 0.8rem 1.5rem; border: none; border-radius: 6px; cursor: pointer; width: 100%; font-size: 1rem; font-weight: 500; transition: background 0.3s; }
                button:hover { background-color: #333; }
                h1 { margin-top: 0; margin-bottom: 1.5rem; font-weight: 600; }
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
        body { font-family: Arial, sans-serif; background-color: #111; color: #f5f5f5; padding: 2rem; }
        h1 { margin-bottom: 1.5rem; }
        table { width: 100%; border-collapse: collapse; background-color: #1a1a1a; border-radius: 8px; overflow: hidden; }
        thead { background-color: #333; }
        th, td { padding: 0.75rem 1rem; text-align: left; font-size: 0.9rem; }
        th { text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.8rem; color: #ddd; }
        tbody tr:nth-child(even) { background-color: #181818; }
        tbody tr:nth-child(odd) { background-color: #141414; }
        tbody tr:hover { background-color: #222; }
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
        const { items, customerEmail } = req.body; // Expecting { items: [{ id: "1-50", quantity: 2 }, ...], customerEmail: "..." }

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
            success_url: 'https://keen-mooncake-5c73e2.netlify.app/success.html',
            cancel_url: 'https://keen-mooncake-5c73e2.netlify.app/cancel.html',
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
