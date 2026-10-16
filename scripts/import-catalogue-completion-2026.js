// Inserts only this reviewed release. Existing products are never overwritten.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const products = require('../catalog/catalogue-completion-2026.json');
const names = require('../publicProductNames.json');
const { lookupProductMapping } = require('../services/productSupplierMapping');
const { publicProduct } = require('../services/publicProduct');
const expectedIds = ['G362', 'G363', 'G364', 'G365', 'G366', 'G367', 'G368', 'G369', 'G370'];

function comparable(product) {
 const value = publicProduct(product);
 delete value.reviewSummary;
 return JSON.stringify(value);
}
function planInsert(existing) {
 const byId = new Map(existing.map(p=>[p.id,p]));
 const insert=[];
 for(const product of products) {
  const current=byId.get(product.id);
  if(current && comparable(current)!==comparable(product)) throw new Error('ID-Konflikt, keine Änderung: '+product.id);
  if(!current) insert.push(product);
 }
 return insert;
}
async function validateCatalogue() {
 if(JSON.stringify(products.map(p=>p.id))!==JSON.stringify(expectedIds)) throw new Error('Unerwarteter Importumfang.');
 const expectedSuppliers=['M1','M11','M16','M23','M25','M53','M58','M126','M168'];
 for(const [index,product] of products.entries()) {
  await new Product(product).validate();
  if(!names[product.id]) throw new Error('Öffentlicher Name fehlt: '+product.id);
  const match=lookupProductMapping(product);
  if(match?.supplierId!==expectedSuppliers[index] || match.confirmed!==true) throw new Error('Lieferantenzuordnung unklar: '+product.id);
 }
}
async function verifyImages() {
 for(const product of products) {
  const url=new URL(product.images[0],'https://www.note-fragrances.de/');
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok || !String(response.headers.get('content-type')).startsWith('image/')) throw new Error('Bild noch nicht veröffentlicht: '+product.id);
  const bytes=Buffer.from(await response.arrayBuffer());
  const expected=require('../catalog/catalogue-completion-2026-images.json')[product.id];
  if(bytes.length<10000 || require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==expected) throw new Error('Bilddatei stimmt nicht mit der geprüften Freigabe überein: '+product.id);
 }
}
async function run() {
 const maintenance=require('./maintenance').prepare({task:'import-catalogue-completion-2026.js',localOnly:false});
 await validateCatalogue();
 if(!process.env.MONGO_URI) {
  console.log(JSON.stringify({mode:'dry-run',database:'not-connected',ids:expectedIds})); return;
 }
 await mongoose.connect(process.env.MONGO_URI,{autoCreate:false,autoIndex:false,serverSelectionTimeoutMS:10000});
 const existing=await Product.find({}).lean();
 const insert=planInsert(existing);
 const report={mode:maintenance.apply?'apply':'dry-run',database:mongoose.connection.name,existingCount:existing.length,insertIds:insert.map(p=>p.id),unchangedIds:expectedIds.filter(id=>!insert.some(p=>p.id===id))};
 if(!maintenance.apply || insert.length===0) {console.log(JSON.stringify(report));return;}
 const backup=maintenance.argument('backup');
 if(!backup || !path.isAbsolute(backup)) throw new Error('--backup mit absolutem Dateipfad erforderlich.');
 await verifyImages();
 fs.writeFileSync(backup,JSON.stringify({createdAt:new Date().toISOString(),database:mongoose.connection.name,releaseIds:expectedIds,products:existing},null,2),{flag:'wx'});
 const session=await mongoose.startSession();
 try {
  await session.withTransaction(async()=>{
   const latest=await Product.find({id:{$in:expectedIds}}).session(session).lean();
   const pending=planInsert(latest);
   if(pending.length) await Product.insertMany(pending,{session,ordered:true});
  });
 } finally {await session.endSession();}
 const saved=await Product.find({id:{$in:expectedIds}}).lean();
 if(planInsert(saved).length) throw new Error('Import nicht vollständig verifiziert.');
 console.log(JSON.stringify({...report,verifiedCount:saved.length,backup}));
}
if(require.main===module) run().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>mongoose.disconnect().catch(()=>{}));
module.exports={planInsert,validateCatalogue};
