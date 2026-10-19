import {assertPublish,validateSnapshot,romeDay,mergeForMaster} from './device-policy.js';
import {portable,comparable} from './approved-storage.js';
import {canonical} from './sync-model.js';
import {encodeMedia,decodeMedia} from './approved-drive.js';
export async function readStores(db,names){const result={};for(const name of names)result[name]=await db.getAll(name);return result;}
async function encodeStores(stores,cloud,previous={}){const output={};for(const[name,rows]of Object.entries(stores)){const old=new Map((previous[name]||[]).map(r=>[r.id,r]));output[name]=[];for(const row of rows){const match=old.get(row.id);output[name].push(row._editId&&row._editId===match?._editId?match:await encodeMedia({...row,_editId:row._editId||crypto.randomUUID()},cloud));}}return output;}
async function decodeStores(stores,cloud,previous={}){const output={};for(const[name,rows]of Object.entries(stores)){const old=new Map((previous[name]||[]).map(r=>[r.id,r]));output[name]=[];for(const row of rows){const match=old.get(row.id);output[name].push(row._editId&&row._editId===match?._editId?match:await decodeMedia(row,cloud));}}return output;}
export async function transferApproved({db,cloud,profile,device,names,mode='pull',enroll=false,canApply=()=>true}){
 await db.session?.pin?.();
 const approved=db.approved||db;const before=await readStores(approved,names),saved=before.impostazioni.find(r=>r.id==='sync-approved-state')?.valore;
 const localFingerprint=canonical(comparable(portable(before)));let created=false;
 let remote=await cloud.current();if(remote)validateSnapshot(remote.value,profile.sub,names);
 if(!remote){if(!enroll)throw Error('Apri prima Skooling sull’iPad e premi Imposta questo iPad come principale. Le copie locali precedenti sono conservate.');
  await cloud.verifyConcurrency?.();
  const snapshot={format:'skooling-approved',version:1,profile:profile.sub,master:device,revision:crypto.randomUUID(),at:new Date().toISOString(),stores:await encodeStores(portable(await readStores(db,names)),cloud)};
  if(!canApply())throw Error('Operazione rinviata.');await cloud.create('approved',snapshot);created=true;remote=await cloud.current();if(remote?.value.revision!==snapshot.revision)throw Error('Configurazione contemporanea: nessun archivio locale sostituito.');
 }
 const principal=remote.value.master===device;
 if(!principal&&!db.session?.temporary)throw Error('Questo iPad non è quello principale. Attiva la modalità iPad secondario prima di ricevere il lavoro approvato. La sua copia locale è conservata.');
 if(enroll&&!principal)throw Error('Un altro iPad è già registrato come principale. Nessun cambio automatico.');
 if(mode==='auto'&&!enroll&&saved?.revision===remote.value.revision&&saved?.fingerprint===localFingerprint)return {principal,state:saved,remote,unchanged:true};
 let publicationStores=null,effectiveBase=db.session?.temporary?db.session.baseRevision:saved?.revision;
 if(enroll&&principal&&!saved&&!created){mode='publish';effectiveBase=remote.value.revision;}
 if(mode==='auto') {
  if(principal&&!created){
   if(saved?.revision!==remote.value.revision&&saved?.fingerprint!==localFingerprint){
    if(!saved?.fingerprint)throw Error('Questo iPad non ha ancora una base verificata. Non sostituisco il suo lavoro: completa la configurazione prima di riprovare.');
    const incoming=await decodeStores(remote.value.stores,cloud,portable(before));
    publicationStores=mergeForMaster(JSON.parse(saved.fingerprint),portable(before),incoming,row=>canonical(comparable(row)));
    effectiveBase=remote.value.revision;mode='publish';
   }else mode=saved?.revision===remote.value.revision?'publish':'pull';
  }
  else mode='pull';
 }
 if(mode==='publish'){
  await cloud.verifyConcurrency?.();
  assertPublish({master:remote.value.master,device,base:effectiveBase,remote:remote.value.revision,explicit:!principal});
  // Secondary RAM drafts never participate in automatic transfers/backups.
  const local=await readStores(db,names),stores=await encodeStores(publicationStores||portable(local),cloud,remote.value.stores);
  if(!canApply())throw Error('Il lavoro è cambiato: invio rinviato.');
  if(canonical(stores)!==canonical(remote.value.stores)){const next={...remote.value,revision:crypto.randomUUID(),at:new Date().toISOString(),stores};await cloud.replace(remote,next);remote=await cloud.current();if(remote?.value.revision!==next.revision)throw Error('Revisione cambiata dopo l’invio. Ricollega per verificare.');}
 }
 if(!canApply())throw Error('Chiudi il libro o l’operazione aperta prima di aggiornare.');
 const data=await decodeStores(remote.value.stores,cloud,portable(before));const state={revision:remote.value.revision,master:remote.value.master,lastSync:new Date().toISOString(),fingerprint:canonical(comparable(portable(data)))};
 await approved.replaceApproved(before,data,state);if(db.session?.temporary)db.session.reset(state.revision);
 return {principal,state,remote};
}
export async function dailyBackup({cloud,remote,device,names,profile,now=new Date()}){
 const value=validateSnapshot(remote.value,profile.sub,names);if(value.master!==device)throw Error('Il backup automatico viene creato solo dall’iPad principale.');
 const previous=await cloud.current('daily-backup'),day=romeDay(now);if(previous?.value.day===day)return false;
 // Re-read authority after synchronization; a stale snapshot is never backed up.
 const latest=await cloud.current();if(latest?.value.revision!==value.revision)throw Error('Archivio cambiato: backup rinviato.');
 const backup={format:'skooling-daily-backup',version:1,day,snapshot:value};
 await cloud.verifyConcurrency?.();
 const stagingKind='backup-check-'+crypto.randomUUID();await cloud.create(stagingKind,backup);
 const staged=await cloud.current(stagingKind);if(canonical(staged?.value)!==canonical(backup))throw Error('Nuovo backup non verificato: la copia precedente resta conservata.');
 // Only replace the previous daily copy AFTER a separate candidate is verified.
 // Keep that verified candidate if the final write/read fails.
 if(previous)await cloud.replace(previous,backup);else await cloud.create('daily-backup',backup);
 const verified=await cloud.current('daily-backup');if(canonical(verified?.value)!==canonical(backup))throw Error('Backup finale non verificato. La nuova copia verificata è conservata separatamente su Drive.');
 if(cloud.remove)await cloud.remove(staged);return true;
}
