// Inserts only this reviewed release. Existing products are never overwritten.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const products = require('../catalog/october-2026.json');
const names = require('../publicProductNames.json');
const { findBestSupplierMatchByInspiredBy } = require('../supplierCatalogMap');
const { publicProduct } = require('../services/publicProduct');
const expectedIds = ['G355','G356','G357','G358','G359','G360','G361','L216','L217','L218','L219'];

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
 const expectedSuppliers=['M355','M356','M357','M358','M360','M361','M362','W216','W217','W218','W219'];
 for(const [index,product] of products.entries()) {
  await new Product(product).validate();
  if(!names[product.id]) throw new Error('Öffentlicher Name fehlt: '+product.id);
  const match=findBestSupplierMatchByInspiredBy(product.inspiredBy,product.category==='men'?'M':'W');
  if(match?.supplierId!==expectedSuppliers[index] || match.confidence!==1) throw new Error('Lieferantenzuordnung unklar: '+product.id);
 }
}
async function verifyImages() {
 for(const product of products) {
  const url=new URL(product.images[0],'https://www.note-fragrances.de/');
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok || !String(response.headers.get('content-type')).startsWith('image/')) throw new Error('Bild noch nicht veröffentlicht: '+product.id);
  if((await response.arrayBuffer()).byteLength<10000) throw new Error('Bilddatei unvollständig: '+product.id);
 }
}
async function run() {
 const maintenance=require('./maintenance').prepare({task:'import-october-2026.js',localOnly:false});
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
