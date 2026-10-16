const test=require('node:test');
const assert=require('node:assert/strict');
const {planInsert,validateCatalogue}=require('../scripts/import-catalogue-completion-2026');
const products=require('../catalog/catalogue-completion-2026.json');
test('nine additions have valid prices, unique names and reviewed supplier mappings', async()=>{
 await validateCatalogue();
 assert.equal(products.length,9);
 assert.deepEqual(products.map(p=>p.id),Array.from({length:9},(_,i)=>'G'+(362+i)));
 const names=require('../publicProductNames.json');
 assert.equal(new Set(products.map(p=>names[p.id])).size,9);
 for(const p of products) assert.equal(p.newArrival,true);
 for(const id of ['G362','G363']) assert.deepEqual(products.find(p=>p.id===id).notes,{head:'',heart:'',base:''});
});
test('completion import preserves existing products, is idempotent and aborts collisions',()=>{
 const legacy={id:'G1',name:'No. G1',inspiredBy:'4711 Echt Kölnisch Wasser',category:'men',variants:{30:{price:34.99}}};
 const snapshot=JSON.stringify(legacy);
 assert.equal(planInsert([legacy]).length,9);
 assert.equal(JSON.stringify(legacy),snapshot);
 assert.deepEqual(planInsert([legacy,...products]),[]);
 assert.throws(()=>planInsert([{...products[0],inspiredBy:'Another scent'}]),/ID-Konflikt/);
 assert.throws(()=>planInsert([{...products[0],images:['images_parfume/parfume_mann.png']}]),/ID-Konflikt/);
});
