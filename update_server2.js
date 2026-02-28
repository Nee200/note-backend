const fs = require('fs');

let s = fs.readFileSync('server.js', 'utf8');

// Replace checkout logic
s = s.replace(/app\.post\('\/create-checkout-session', async \(req, res\) => \{[\s\S]*?subtotal \+= product\.priceInCents \* item\.quantity;\n        \}/, `app.post('/create-checkout-session', async (req, res) => {
    try {
        const { items, customerEmail } = req.body; // Expecting { items: [{ id: "1-50", quantity: 2 }, ...], customerEmail: "..." }

        if (!items || !Array.isArray(items) || items.length === 0) {
             return res.status(400).json({ error: 'Warenkorb ist leer oder ungültig' });
        }

        const line_items = [];

        let subtotal = 0;

        for (const item of items) {
            // "G1-50" -> baseId "G1", size "50"
            const match = item.id.match(/^(.+?)-(\\d+)$/);
            if (!match) return res.status(400).json({ error: 'Ungültige Produkt-ID: ' + item.id });
            const [ , baseId, sizeStr ] = match;
            const size = parseInt(sizeStr, 10);

            const product = await Product.findOne({ id: baseId });

            if (!product || !product.variants[size]) {
                return res.status(404).json({ error: \`Produkt mit ID \${item.id} nicht gefunden\` });
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
        }`);

// Replace API products mock string if any, else add block
s += `\napp.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find({}, '-_id -__v');
        res.json(products);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});\n`;

// require Product at the top
s = s.replace(/const User = require\('\.\/models\/User'\);/, "const User = require('./models/User');\nconst Product = require('./models/Product');");

fs.writeFileSync('server.js', s);
console.log('Update successful');
