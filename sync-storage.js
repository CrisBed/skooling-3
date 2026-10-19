import { SYNC_STORES, project, canonical, fingerprints, projectedRow, recordKey, preserveBinary } from './sync-model.js';

// Reads and comparison happen in the same transaction as writes. Network work
// never holds an IndexedDB transaction open.
export function syncSnapshot(database) {
 return new Promise((resolve,reject)=>{
  const tx=database.transaction(SYNC_STORES), stores={};
  for(const name of SYNC_STORES){const req=tx.objectStore(name).getAll();req.onsuccess=()=>{stores[name]=req.result;};}
  tx.oncomplete=()=>resolve({stores,records:project(stores)});
  tx.onerror=tx.onabort=()=>reject(tx.error||Error('Lettura dei dati non riuscita.'));
 });
}
export function applySync(database, expected, merged, profile, device, canApply=()=>true) {
 return new Promise((resolve,reject)=>{
  const tx=database.transaction(SYNC_STORES,'readwrite'), stores={};let pending=SYNC_STORES.length, error;
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('Sincronizzazione interrotta.'));
  for(const name of SYNC_STORES){const req=tx.objectStore(name).getAll();req.onsuccess=()=>{stores[name]=req.result;if(--pending)return;
   try{
    if(!canApply())throw Error('Operazione rinviata: chiudi il libro o il quaderno prima di sincronizzare.');
    const current=project(stores), owner=stores.impostazioni.find(r=>r.id==='sync-owner')?.valore;
    if(owner?.sub!==profile)throw Error('Account cambiato: sincronizzazione interrotta.');
    if(canonical(current)!==canonical(expected))throw Error('Hai modificato dei dati durante la sincronizzazione. Riprova: il tuo lavoro è salvo.');
    const target={...merged.records}, conflicts=new Set(merged.conflicts.map(c=>c.key));
    for(const key of conflicts)if(current[key])target[key]=current[key];
    // Only a record present in cloud history can cause deletion. Records
    // excluded by projection (media and device settings) are untouched.
    for(const name of SYNC_STORES){const store=tx.objectStore(name), locals=new Map(stores[name].map(r=>[r.id,r]));
     for(const row of stores[name]){const key=recordKey(name,row.id);if(projectedRow(name,row)&&merged.heads[key]&&!target[key]&&!conflicts.has(key))store.delete(row.id);}
     for(const[key,row]of Object.entries(target)){const[table,id]=JSON.parse(key);if(table!==name)continue;if(canonical(current[key])!==canonical(row))store.put(preserveBinary(locals.get(id),row));}
    }
    tx.objectStore('impostazioni').put({id:'sync-state',valore:{values:fingerprints(target),heads:merged.heads,conflicts:merged.conflicts,device,lastSync:new Date().toISOString()}});
   }catch(e){error=e;tx.abort();}
  };}
 });
}
