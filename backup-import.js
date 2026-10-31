import {readBackup} from './backup-reader.js';
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('Importazione interrotta.'));});}
function result(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
// Conserva i PDF locali esclusi dal backup essenziale. L'identità è sempre
// l'ID del libro; due titoli uguali non vengono mai collegati fra loro.
export function preserveEssentialBooks(imported, local, metadata = {}) {
  const rows = {...imported};
  if (!['essenziale','giornaliero'].includes(metadata.tipoBackup)) return rows;
  const existing = new Map((local.libri || []).map(book => [book.id, book]));
  const present = new Set((imported.libri || []).map(book => book.id));
  rows.libri = (imported.libri || []).map(book => {
    const before = existing.get(book.id);if (!before) return book;
    const merged = {...before, ...book};
    for (const [key, value] of Object.entries(before)) if (value instanceof Blob && !(book[key] instanceof Blob)) merged[key] = value;
    return merged;
  });
  for (const book of local.libri || []) if (!present.has(book.id)) rows.libri.push(book);
  const preserved = new Set((local.libri || []).filter(book => !present.has(book.id)).map(book => book.id));
  for (const name of ['annotazioni','segnalibri']) {
    rows[name] = [...(imported[name] || [])];const ids = new Set(rows[name].map(row => row.id));
    for (const row of local[name] || []) if (preserved.has(row.idLibro) && !ids.has(row.id)) rows[name].push(row);
  }
  // Questi metadati appartengono ai libri non ripristinati dal file.
  rows.letture = [...(imported.letture || [])];
  const readingIds = new Set(rows.letture.map(row => row.id));
  for (const row of local.letture || []) if (preserved.has(row.id) && !readingIds.has(row.id)) rows.letture.push(row);
  rows.impostazioni = [...(imported.impostazioni || [])];
  const settingIds = new Set(rows.impostazioni.map(row => row.id));
  for (const row of local.impostazioni || []) if (row.id.startsWith('book-numbering-') && preserved.has(row.id.slice('book-numbering-'.length)) && !settingIds.has(row.id)) rows.impostazioni.push(row);
  const available = new Set(rows.libri.map(book => book.id));
  const importedExcluded = rows.impostazioni.find(row => row.id === 'backup-libri-esclusi')?.valore;
  const localExcluded = (local.impostazioni || []).find(row => row.id === 'backup-libri-esclusi')?.valore;
  const excluded = [...new Map([...(Array.isArray(localExcluded) ? localExcluded : []), ...(Array.isArray(metadata.libriEsclusi) ? metadata.libriEsclusi : []), ...(Array.isArray(importedExcluded) ? importedExcluded : [])].filter(book => !available.has(book.id)).map(book => [book.id, book])).values()];
  rows.impostazioni = rows.impostazioni.filter(row => row.id !== 'backup-libri-esclusi');
  if (excluded.length) rows.impostazioni.push({id:'backup-libri-esclusi', valore:excluded});
  return rows;
}
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
    let finalError;
    const local={}, readNames=names.filter(name=>['libri','impostazioni','letture','annotazioni','segnalibri'].includes(name));let remaining=readNames.length;
    const commit=()=>{try{
      const restored=preserveEssentialBooks(rows,local,metadata);
      restored.impostazioni=(restored.impostazioni||[]).filter(row=>!['sync-owner','sync-client-id'].includes(row.id));
      for(const row of local.impostazioni||[])if(['sync-owner','sync-client-id'].includes(row.id))restored.impostazioni.push(row);
      for(const name of names){const store=tx.objectStore(name);store.clear();for(const row of restored[name]||[])store.put(row);}
    }catch(error){finalError=error;tx.abort();}};
    for(const name of readNames){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{local[name]=request.result;if(!--remaining)commit();};}
    if(!remaining)commit();
    try{await completion;}catch(error){throw finalError||error;}onProgress(1);return metadata;
  }catch(error){
    if(error?.name==='QuotaExceededError')throw Error('Spazio insufficiente per preparare il backup. L’archivio precedente non è stato sostituito. Libera spazio sull’iPad e riprova.');
    if(error?.name==='ConstraintError')throw Error('Il backup contiene voci duplicate e non è stato importato. I dati precedenti restano intatti.');
    throw error;
  }finally{stage?.close();indexedDB.deleteDatabase(stageName);}
}
