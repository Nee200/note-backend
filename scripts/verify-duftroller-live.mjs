// Only GET requests: no checkout sessions, payments, mail or database changes.
import fs from 'node:fs/promises';
const args=process.argv.slice(2);
const value=key=>args[args.indexOf(key)+1];
const base=new URL(args.includes('--base')?value('--base'):'https://www.note-fragrances.de');
if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Eine HTTPS-Origin ohne Pfad, Query oder Zugangsdaten angeben.');
const before=args.includes('--before-import');
const report={checkedAt:new Date().toISOString(),base:base.origin,mode:before?'before-import':'after-release',readOnly:true,checks:[],paymentVerified:false};
async function check(name,run){try{report.checks.push({name,ok:true,...await run()});}catch(error){report.checks.push({name,ok:false,error:error.message});}}
async function get(path){const url=new URL(path,base);url.searchParams.set('releaseCheck',String(Date.now()));const response=await fetch(url,{signal:AbortSignal.timeout(20000),cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!response.ok)throw Error(`HTTP ${response.status}`);return response;}
await check('catalog',async()=>{
 const rows=await(await get('/api/products')).json();
 if(!Array.isArray(rows)||!rows.some(p=>p.id==='G1'))throw Error('Kein gültiger Shopkatalog.');
 const roller=rows.find(p=>p.id==='DUFTROLLER');
 if(!roller){if(before)return {present:false,releaseBlocker:'DUFTROLLER fehlt im Live-Katalog'};throw Error('DUFTROLLER fehlt im Live-Katalog');}
 if(roller.category!=='duftroller')throw Error('Falsche Produktkategorie.');
 if(JSON.stringify(Object.keys(roller.variants||{}).sort())!==JSON.stringify(['6','10','14'].sort()))throw Error('Unerwartete Größenauswahl.');
 for(const [size,price]of Object.entries({6:12.5,10:16,14:19.5}))if(roller.variants?.[size]?.price!==price)throw Error(`Preis für ${size} ml stimmt nicht.`);
 for(const size of [6,10,14])if(!roller.images?.includes(`images_website/duftroller/note-duftroller-${size}-closed-v3.webp`))throw Error(`Katalogbild für ${size} ml stimmt nicht.`);
 return {present:true,variants:roller.variants};
});
if(!before){
 await check('page',async()=>{const html=await(await get('/duftroller.html')).text();if(!html.includes('roller-main-image')||!html.includes('konfigurator-roller'))throw Error('Duftrollerseite fehlt oder ist unerwartet.');return {};});
 for(const size of [6,10,14])await check(`image-${size}`,async()=>{const response=await get(`/images_website/duftroller/note-duftroller-${size}-closed-v3.webp`);if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('Antwort ist kein Bild.');return {bytes:(await response.arrayBuffer()).byteLength};});
}
report.ok=report.checks.every(c=>c.ok)&&!report.checks.some(c=>c.releaseBlocker);
if(args.includes('--out'))await fs.writeFile(value('--out'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
