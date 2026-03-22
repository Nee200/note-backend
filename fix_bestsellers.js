require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

// Diese IDs und Namen waren als Bestseller im Shop aktiv.
// Ich setze alle Produkte als Bestseller, die typische Top-Düfte sind.
// Basierend auf den inspiredBy-Werten der bekanntesten Düfte.
const bestsellerKeywords = [
    'Creed Aventus',
    'Baccarat Rouge 540',
    'Dior Sauvage',
    'Chanel Bleu',
    'Tom Ford Black Orchid',
    'Tom Ford Tobacco Vanille',
    'Tom Ford Oud Wood',
    'Tom Ford Lost Cherry',
    'Armani Acqua di Gio',
    'Armani Stronger with You',
    'Armani Code',
    'YSL La Nuit de L\'Homme',
    'YSL Black Opium',
    'YSL Libre',
    'Paco Rabanne 1 Million',
    'Paco Rabanne Invictus',
    'Paco Rabanne Olympea',
    'Lancome La Vie Est Belle',
    'Lancôme La Vie est Belle',
    'Good Girl',
    'Parfums de Marly Layton',
    'Parfums de Marly Pegasus',
    'Parfums de Marly Delina',
    'Initio Oud for Greatness',
    'Kilian Angels Share',
    'Kilian Love Don\'t Be Shy',
    'Xerjoff Erba Pura',
    'Xerjoff Naxos',
    'Maison Margiela Replica',
    'Valentino Voce Viva',
    'Hugo Boss Bottled',
    'Boss The Scent',
    'Versace Eros',
    'Givenchy Gentleman',
    'Viktor & Rolf Spicebomb',
    'Narciso Rodriguez For Her',
    'Chloe Nomade',
    'Burberry Her',
    'Gucci Guilty',
    'Gucci Bloom',
    'Dior Miss Dior',
    'Dior J\'adore',
    'Dior Hypnotic Poison',
    'Dior Poison',
    'Chanel Coco Mademoiselle',
    'Chanel Chance',
    'Jean Paul Gaultier Le Male',
    'Jean Paul Gaultier Ultra Male',
    'Jean Paul Gaultier Scandal',
    'Amouage Interlude',
    'Amouage Reflection',
    'Le Labo Santal 33',
    'Byredo Gypsy Water',
    'Byredo Blanche',
];

mongoose.connect(process.env.MONGO_URI).then(async () => {
    console.log('Connected...');

    let totalUpdated = 0;

    for (const keyword of bestsellerKeywords) {
        const result = await Product.updateMany(
            { inspiredBy: { $regex: keyword, $options: 'i' } },
            { $set: { bestseller: true } }
        );
        if (result.modifiedCount > 0) {
            console.log(`✓ ${keyword}: ${result.modifiedCount} Produkt(e)`);
            totalUpdated += result.modifiedCount;
        }
    }

    console.log(`\nFertig! ${totalUpdated} Produkte als Bestseller markiert.`);
    mongoose.disconnect();
}).catch(err => console.error(err));
