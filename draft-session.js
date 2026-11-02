import {prepareAnnotations} from './annotation-storage.js';
import {preserveEssentialBooks} from './backup-import.js';
// Computer experiments are RAM-only: closing/reloading the page drops them,
// even when the browser crashes. Existing persistent archives are never erased.
export function installDraftSession(db, {enabled, stores, snapshot, importFile,lockName,deferTracking=false}) {
 const approved={};for(const[k,value]of Object.entries(db))approved[k]=typeof value==='function'?function(...args){return value.apply(approved,args);}:value;
 const changes=new Map();let generation=0, blocked=false,baseReady=false,baseRevision=null,tracking=!deferTracking,userChanges=false;
 const rows=name=>{if(!changes.has(name))changes.set(name,new Map());return changes.get(name);};
 const clone=value=>structuredClone(value);
 const changed=()=>{generation++;if(tracking)userChanges=true;};
 const check=()=>{if(blocked)throw Error('Aggiornamento in corso. Attendi un momento e riprova.');};
 db.approved=approved;
 const pin=async()=>{if(!baseReady){baseRevision=(await approved.get('impostazioni','sync-approved-state'))?.valore?.revision||null;baseReady=true;}return baseRevision;};
 db.session={temporary:enabled,pin,get baseRevision(){return baseRevision;},startTracking(){tracking=true;},get dirty(){return userChanges&&[...changes.values()].some(m=>m.size);},get generation(){return generation;},get busy(){return blocked;},freeze(value){blocked=value;},reset(revision){changes.clear();userChanges=false;generation++;baseRevision=revision??null;baseReady=revision!==undefined;},exportChanges(){return clone(changes);}};
 if(!enabled){
  for(const method of ['replaceAnnotations','put','putMany','delete','deleteWhere','putIfUnchanged','saveMindMap','importBackup']){
   if(!approved[method])continue;
   db[method]=async(...args)=>{check();const execute=async()=>{check();generation++;return approved[method](...args);};
    if(globalThis.navigator?.locks&&lockName)return navigator.locks.request(lockName,{mode:'shared'},execute);return execute();};
  }return;
 }
 db.get=async(name,id)=>{await pin();if(rows(name).has(id))return clone(rows(name).get(id));return approved.get(name,id);};
 db.getAll=async name=>{await pin();const result=new Map((await approved.getAll(name)).map(r=>[r.id,r]));for(const[id,row]of rows(name)){if(row===null)result.delete(id);else result.set(id,clone(row));}return [...result.values()];};
 db.put=async(name,value)=>{await pin();check();rows(name).set(value.id,clone({...value,_editId:crypto.randomUUID()}));changed();return value;};
 db.putMany=async(name,values)=>{await pin();check();for(const value of values)rows(name).set(value.id,clone({...value,_editId:crypto.randomUUID()}));changed();return values;};
 let annotationTail=Promise.resolve();
 db.replaceAnnotations=(bookId,page,elements)=>{
  let prepared;try{prepared=prepareAnnotations(bookId,page,elements);}catch(error){return Promise.reject(error);}
  const operation=annotationTail.catch(()=>{}).then(async()=>{
   const before=generation,current=await db.getAll('annotazioni');check();
   if(before!==generation)throw Error('Le annotazioni sono cambiate. Riprova il salvataggio.');
   const ids=new Set(prepared.map(row=>row.id));if(current.some(row=>ids.has(row.id)&&(row.idLibro!==bookId||row.pagina!==page)))throw Error('Un tratto appartiene a un’altra pagina.');
   const next=new Map(rows('annotazioni'));for(const row of current)if(row.idLibro===bookId&&row.pagina===page)next.set(row.id,null);for(const row of prepared)next.set(row.id,row);
   changes.set('annotazioni',next);changed();return prepared;
  });annotationTail=operation;return operation;
 };

 db.delete=async(name,id)=>{await pin();check();rows(name).set(id,null);changed();};
 db.deleteWhere=async(name,predicate)=>{const values=await db.getAll(name);check();for(const v of values)if(predicate(v))rows(name).set(v.id,null);changed();};
 // The generation check also covers an await between reading and committing.
 db.putIfUnchanged=async(name,value,expected)=>{const before=generation,current=await db.get(name,value.id);if(before!==generation||snapshot(current||null)!==expected)throw Error('Il materiale è cambiato. Riaprilo prima di salvare.');check();rows(name).set(value.id,clone({...value,_editId:crypto.randomUUID()}));changed();return value;};
 db.saveMindMap=(value,expected)=>db.putIfUnchanged('materiali',value,expected);
 db.syncSnapshot=async()=>{const data={};for(const name of stores)data[name]=await db.getAll(name);return {stores:data};};
 db.applySync=()=>{throw Error('La sincronizzazione precedente è disattivata per le prove locali.');};
 db.importBackup=async(file,onProgress)=>{
  await pin();const before=generation,parsed=await importFile(file,onProgress),staged=new Map(),local={};
  for(const name of stores)local[name]=await db.getAll(name);const imported=preserveEssentialBooks(parsed,local,parsed.backupMetadata||{});
  for(const name of stores){const map=new Map();for(const row of await approved.getAll(name))map.set(row.id,null);for(const row of imported[name]||[])map.set(row.id,clone({...row,_editId:crypto.randomUUID()}));staged.set(name,map);}
  check();if(before!==generation)throw Error('Hai modificato il lavoro durante l’importazione. Nessuna prova è stata sostituita.');
  changes.clear();for(const[name,map]of staged)changes.set(name,map);changed();
 };
}
