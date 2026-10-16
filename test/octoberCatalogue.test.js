const test=require('node:test');
const assert=require('node:assert/strict');
const {planInsert,validateCatalogue}=require('../scripts/import-october-2026');
const products=require('../catalog/october-2026.json');
const {findBestSupplierMatchByInspiredBy}=require('../supplierCatalogMap');

test('October release validates schema and exact supplier mappings',async()=>{
 await validateCatalogue();
 assert.equal(products.length,11);
 assert.equal(products.some(p=>/Orange Cream/i.test(p.inspiredBy)),false);
 assert.equal(findBestSupplierMatchByInspiredBy('Marc Gebauer Orange Flamingo','M').supplierId,'M359');
 assert.equal(findBestSupplierMatchByInspiredBy('Mery Perfume Orange Cream','M').supplierId,'M351');
});
test('import is insert-only, idempotent and refuses conflicting existing IDs',()=>{
 const legacy={id:'G351',name:'No. G351',inspiredBy:'Marc Gebauer Orange Flamingo',category:'men',variants:{30:{price:34.99}}};
 const snapshot=JSON.stringify(legacy);
 assert.equal(planInsert([legacy]).length,11);
 assert.equal(JSON.stringify(legacy),snapshot);
 assert.deepEqual(planInsert([legacy,...products]),[]);
 assert.throws(()=>planInsert([{...products[0],inspiredBy:'Existing different fragrance'}]),/ID-Konflikt/);
 assert.throws(()=>planInsert([{...products[0],images:['images_parfume/parfume_mann.png']}]),/ID-Konflikt/);
});
