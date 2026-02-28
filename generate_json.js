
const fs = require('fs');

const startM = 250;
const endM = 299;
const newEntries = [];

for (let m = startM; m <= endM; m++) {
    const dbId = m + 3;
    const name = `NOTE. M${m}`;
    
    // 30ml
    newEntries.push({
        id: `${dbId}-30`,
        name: `${name} (30ml)`,
        priceId: `price_${dbId}_30_PLACEHOLDER`,
        priceInCents: 1790
    });
    
    // 50ml
    newEntries.push({
        id: `${dbId}-50`,
        name: `${name} (50ml)`,
        priceId: `price_${dbId}_50_PLACEHOLDER`,
        priceInCents: 2490
    });
    
    // 100ml
    newEntries.push({
        id: `${dbId}-100`,
        name: `${name} (100ml)`,
        priceId: `price_${dbId}_100_PLACEHOLDER`,
        priceInCents: 4499
    });
}

console.log(JSON.stringify(newEntries, null, 2));
