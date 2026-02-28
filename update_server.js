const fs = require('fs');

let s = fs.readFileSync('server.js', 'utf8');

// Add dotenv and mongoose imports at the top
s = s.replace("const express = require('express');", "require('dotenv').config();\nconst express = require('express');\nconst mongoose = require('mongoose');\nconst User = require('./models/User');\nconst Order = require('./models/Order');");

// Connect to MongoDB
const mongoConnect = `
mongoose.connect(process.env.MONGO_URI, {\n  useNewUrlParser: true,\n  useUnifiedTopology: true\n}).then(() => console.log('MongoDB connected')).catch(err => console.log('MongoDB connection error:', err));
`;
s = s.replace("const app = express();", "const app = express();\n" + mongoConnect);

// Update environment variables
s = s.replace(/const JWT_SECRET = 'your-secret-key-change-this-in-production'; \/\/ TODO: Move to env/, "const JWT_SECRET = process.env.JWT_SECRET;");
s = s.replace(/const ADMIN_PASSWORD = "admin"; \/\/ Einfaches Passwort, bitte ändern!/, "const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;");

// Update stripe initialization
s = s.replace(/const stripe = require\('stripe'\)\('.*?'\);/, "const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);");

// Remove local JSON user handling
s = s.replace(/\/\/ Users laden[\s\S]*?\/\/ Helper to save users\nconst saveUsers = \(\) => \{[\s\S]*?\};\n/, "");

// Stripe webhook endpointSecret from env
s = s.replace(/const endpointSecret = 'whsec_22c1e2b0088de836f2584326e5b9f33f4769b7f8cdb40269aa0e33dab902719c';/, "const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;");

// Update Webhook saving logic
s = s.replace(/const ordersFilePath = path\.join\(__dirname, 'orders\.json'\);[\s\S]*?console\.log\('Bestellung in orders\.json gespeichert!'\);\n[ ]{6}\} catch \(err\) \{\n[ ]{8}console\.error\('Fehler beim Schreiben in orders\.json:', err\);\n[ ]{6}\}/, `
      try {
        const order = new Order(newOrder);
        await order.save();
        console.log('Bestellung in MongoDB gespeichert!');
      } catch (err) {
        console.error('Fehler beim Speichern der Order:', err);
      }
`);

// Authentication routes updates
s = s.replace(/if \(users\.find\(u => u\.email === email\)\) \{/, "if (await User.findOne({ email })) {");
s = s.replace(/const newUser = \{[\s\S]*?\};\n\n[ ]{4}users\.push\(newUser\);\n[ ]{4}saveUsers\(\);/, `
    const user = new User({ email, password: hashedPassword, name: name || '' });
    await user.save();
`);

s = s.replace(/const user = users\.find\(u => u\.email === email\);/, "const user = await User.findOne({ email });");

s = s.replace(/const user = users\.find\(u => u\.id === decoded\.userId\);/g, "const user = await User.findOne({ id: decoded.userId });");
s = s.replace(/saveUsers\(\);/g, "await user.save();");

// Update get orders endpoint logic
s = s.replace(/\/\/ Orders laden \(jedes Mal neu lesen, um aktuell zu bleiben\)[\s\S]*?const userOrders = allOrders\.filter\(o => o\.email === userEmail\);/, `
        const userOrders = await Order.find({ email: userEmail }).sort({ date: -1 });
`);

// Make /api/user, /api/profile, /api/address, /api/orders handlers async
s = s.replace(/app\.get\('\/api\/user', \(req, res\) => \{/, "app.get('/api/user', async (req, res) => {");
s = s.replace(/app\.put\('\/api\/user\/profile', \(req, res\) => \{/, "app.put('/api/user/profile', async (req, res) => {");
s = s.replace(/app\.post\('\/api\/user\/address', \(req, res\) => \{/, "app.post('/api/user/address', async (req, res) => {");
s = s.replace(/app\.delete\('\/api\/user\/address\/:id', \(req, res\) => \{/, "app.delete('/api/user/address/:id', async (req, res) => {");
s = s.replace(/app\.get\('\/api\/user\/orders', \(req, res\) => \{/, "app.get('/api/user/orders', async (req, res) => {");
s = s.replace(/app\.get\('\/admin', \(req, res\) => \{/, "app.get('/admin', async (req, res) => {");

// Update /admin get orders logic
s = s.replace(/const ordersFilePath = path\.join\(__dirname, 'orders\.json'\);\n\n[ ]{2}if \(!fs\.existsSync\(ordersFilePath\)\) \{[\s\S]*?\} catch \(err\) \{\n[ ]{4}console\.error\('Fehler beim Lesen von orders\.json im \/admin-Endpoint:', err\);\n[ ]{4}orders = \[\];\n[ ]{2}\}/, `
  let orders = [];
  try {
    orders = await Order.find().sort({ date: -1 });
  } catch (err) {
    console.error('Fehler beim Abrufen der Bestellungen:', err);
  }
`);


fs.writeFileSync('server.js', s);
console.log('server.js successfully refactored to use MongoDB and env vars!');
