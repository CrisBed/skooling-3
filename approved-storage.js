import {canonical} from './sync-model.js';
export const localOnly=id=>id.startsWith('sync-')||id==='backup-libri-esclusi'||id==='disegna-dito';
export function portable(stores){return Object.fromEntries(Object.entries(stores).map(([name,rows])=>[name,name==='impostazioni'?rows.filter(r=>!localOnly(r.id)):name==='libri'?rows.map(({file,pdf,contenuto,dati,...row})=>Object.fromEntries(Object.entries(row).filter(([,v])=>!(v instanceof Blob)))):rows]));}
export function comparable(value){if(value instanceof Blob)return {blob:true,size:value.size,type:value.type};if(Array.isArray(value))return value.map(comparable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,comparable(v)]));return value;}
export function replaceApproved(database,names,expected,incoming,state){return new Promise((resolve,reject)=>{const tx=database.transaction([...names,'recuperosync'],'readwrite'),current={};let remaining=names.length,error;
 tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('Aggiornamento interrotto.'));
 for(const name of names){const req=tx.objectStore(name).getAll();req.onsuccess=()=>{current[name]=req.result;if(--remaining)return;try{
  if(canonical(comparable(current))!==canonical(comparable(expected)))throw Error('Il lavoro locale è cambiato durante il trasferimento. Riprova.');
  // Preserve the previous personal archive once, atomically with the first pull.
  if(!current.impostazioni.some(r=>r.id==='sync-approved-state'))tx.objectStore('recuperosync').put({id:'prima-sincronizzazione',data:new Date().toISOString(),stores:portable(current)});
  for(const name of names){const store=tx.objectStore(name),locals=new Map(current[name].map(r=>[r.id,r]));
   if(name==='libri'){for(const row of incoming[name]){const local=locals.get(row.id);store.put({...row,...Object.fromEntries(Object.entries(local||{}).filter(([,v])=>v instanceof Blob))});}continue;}
   if(name==='impostazioni'){for(const row of current[name])if(!localOnly(row.id))store.delete(row.id);for(const row of incoming[name])if(!localOnly(row.id))store.put(row);store.put({id:'sync-approved-state',valore:state});continue;}
   store.clear();for(const row of incoming[name])store.put(row);
  }
 }catch(e){error=e;tx.abort();}};}
 });}
