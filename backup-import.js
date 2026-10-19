import {readBackup} from './backup-reader.js';
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('Importazione interrotta.'));});}
function result(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function importBackupStaged(file,database,names,required,onProgress=()=>{}){
  const stageName='skooling3-import-'+(globalThis.crypto?.randomUUID?.()||Date.now());let stage;
  try{
    const request=indexedDB.open(stageName,1);request.onupgradeneeded=()=>{for(const name of names)request.result.createObjectStore(name,{keyPath:'id'});};stage=await result(request);
    const metadata=await readBackup(file,{requiredStores:required,onProgress:n=>onProgress(n*.85),onRow:async(name,row)=>{
      if(!names.includes(name)||(name==='impostazioni'&&row.id.startsWith('sync-')))return;
      const tx=stage.transaction(name,'readwrite'),completion=done(tx);tx.objectStore(name).add(row);await completion;
    }});
    // I Blob riletti da IndexedDB sono riferimenti binari: non ricreiamo la
    // gigantesca stringa base64. Preparare le richieste prima della transazione
    // finale consente di sostituire tutti gli archivi in modo atomico.
    const rows={};for(let i=0;i<names.length;i++){const name=names[i];rows[name]=await result(stage.transaction(name).objectStore(name).getAll());onProgress(.85+.1*(i+1)/names.length);}
    const tx=database.transaction(names,'readwrite'),completion=done(tx);
    try{
      // Preserve the account binding and OAuth configuration of THIS device.
      // Reset the baseline so restored work is uploaded as fresh edits.
      const settings=tx.objectStore('impostazioni'), old=settings.getAll();
      old.onsuccess=()=>{for(const row of old.result)if(['sync-owner','sync-client-id'].includes(row.id))settings.put(row);};
      for(const name of names){const store=tx.objectStore(name);store.clear();for(const row of rows[name])store.put(row);}}catch(error){tx.abort();await completion.catch(()=>{});throw error;}
    await completion;onProgress(1);return metadata;
  }catch(error){
    if(error?.name==='QuotaExceededError')throw Error('Spazio insufficiente per preparare il backup. I dati della 2.0 non sono stati sostituiti. Libera spazio sull’iPad e riprova.');
    if(error?.name==='ConstraintError')throw Error('Il backup contiene voci duplicate e non è stato importato. I dati precedenti restano intatti.');
    throw error;
  }finally{stage?.close();indexedDB.deleteDatabase(stageName);}
}
