import {validateSnapshot,mergeForMaster,romeDay} from './device-policy.js';
import {portable} from './approved-storage.js';
import {canonical} from './sync-model.js';
import {encodeMedia,decodeMedia,digest} from './approved-drive.js';
import {readStores} from './approved-engine.js';

const INTENT='sync-journal-intent';
const STATE='sync-approved-state';
export async function contentValue(value){
 if(value instanceof Blob)return {blobHash:await digest(value),size:value.size,type:value.type};
 if(Array.isArray(value)){const out=[];for(const x of value)out.push(await contentValue(x));return out;}
 if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value))if(k!=='_journalHash')out[k]=await contentValue(v);return out;}
 return value;
}
export async function encodeJournalStores(stores,cloud,previous={}){
 const out={};for(const[name,rows]of Object.entries(portable(stores))){const old=new Map((previous[name]||[]).map(r=>[r.id,r]));out[name]=[];
  for(const row of rows){const hash=await digest(new Blob([canonical(await contentValue(row))]));const match=old.get(row.id);
   out[name].push(match?._journalHash===hash?match:{...await encodeMedia(row,cloud),_journalHash:hash});
  }
 }return out;
}
function checkProposal(value,profile,names,master){
 if(value?.format!=='skooling-proposal'||value.profile!==profile.sub||typeof value.device!=='string'||!value.device||typeof value.requestId!=='string'||!value.requestId||typeof value.baseRevision!=='string')throw Error('Una proposta non è completa. Le copie precedenti sono conservate.');
 validateSnapshot({format:'skooling-approved',version:1,profile:value.profile,master,revision:value.baseRevision,stores:value.stores},profile.sub,names);return value;
}
// Shared book deletion needs a separate design for local PDFs and notes.
// Until then, stop the whole transfer instead of silently reviving a book or
// propagating only the deletion of its annotations.
function preserveSharedBooks(approved,stores){
 const incoming=new Set((stores.libri||[]).map(row=>row.id));
 if((approved.stores.libri||[]).some(row=>!incoming.has(row.id)))throw Error('La cancellazione condivisa dei libri non è ancora disponibile. Le copie e le prove restano conservate.');
}
async function commitIntent(db,cloud,intent,canApply,replaceId=null){
 const base=db.approved||db;
 const old=(await base.get('impostazioni',INTENT))?.valore;
 if(old&&canonical(old)!==canonical(intent)&&old.id!==replaceId)throw Error('C’è un invio da verificare prima di prepararne un altro. Il tuo lavoro resta qui.');
 if(!canApply())throw Error('Il lavoro è cambiato. Aspetto prima di inviarlo.');
 if(!old||canonical(old)!==canonical(intent))await base.put('impostazioni',{id:INTENT,valore:intent});
 const result=await cloud.appendImmutable(intent.kind,intent.value,intent.id);
 // A failed response leaves this exact logical operation available for retry.
 if(intent.kind!=='approved'){if(intent.kind==='proposal')await base.put('impostazioni',{id:'sync-journal-request',valore:intent.value.requestId});await base.delete('impostazioni',INTENT);}return result;
}
export async function transferJournal({db,cloud,profile,device,names,mode='auto',enroll=false,canApply=()=>true}){
 const base=db.approved||db;await db.session?.pin?.();
 const before=await readStores(base,names),saved=before.impostazioni.find(r=>r.id===STATE)?.valore;
 const validSaved=saved?.protocol==='journal1'?saved:null;
 const pending=before.impostazioni.find(r=>r.id===INTENT)?.valore;let resumed=null;
 if(pending){
  const value=pending.value;
  if(value.profile!==profile.sub||(pending.kind==='approved'?value.master:value.device)!==device)throw Error('L’invio da verificare appartiene a un altro dispositivo o account. Nessuna copia sostituita.');
  // A persisted intent from an earlier version must pass the same guard before
  // its first or repeated POST. Nothing pending is discarded on failure.
  const verified=await cloud.current({lastRevision:validSaved?.revision||null});
  if(verified){validateSnapshot(verified.value,profile.sub,names);
   if(pending.kind==='approved')validateSnapshot(value,profile.sub,names);else checkProposal(value,profile,names,verified.value.master);
   preserveSharedBooks(verified.value,value.stores);
  }else if(pending.kind!=='approved'||value.parentRevision!==null)throw Error('La copia precedente dell’iPad non è verificata. L’invio resta conservato: riprova più tardi.');
  await commitIntent(db,cloud,pending,canApply);resumed=pending;
 }
 let remote=await cloud.current({lastRevision:resumed?.kind==='approved'?resumed.value.revision:validSaved?.revision||null});
 if(remote)validateSnapshot(remote.value,profile.sub,names);
 if(!remote){
  if(!enroll)throw Error('Prima collega la 3.0 sull’iPad e scegli Questo è il mio iPad principale. Il lavoro locale resta al sicuro.');
  if(db.session?.temporary)throw Error('Le prove del computer non possono diventare l’archivio principale. Usa l’iPad che contiene il lavoro di Gabriel.');
  const revision=crypto.randomUUID(),stores=await encodeJournalStores(await readStores(db,names),cloud);
  const value={format:'skooling-approved',version:1,profile:profile.sub,master:device,revision,parentRevision:null,generation:0,at:new Date().toISOString(),appliedRequests:[],stores};
  await commitIntent(db,cloud,{kind:'approved',id:revision,value,localStores:stores},canApply);remote=await cloud.current({lastRevision:revision});
 }
 const principal=remote.value.master===device;
 if(enroll&&!principal)throw Error('Un altro iPad è già principale. Il suo lavoro resta conservato.');
 if(!principal&&!db.session?.temporary)throw Error('Questo iPad ha un archivio locale proprio. Prima scegli consapevolmente la modalità secondaria, senza cancellarlo.');
 if(resumed?.kind==='proposal')return {principal:false,queued:true,requestId:resumed.value.requestId,remote};
 if(mode==='publish'&&!principal){
  if(db.session?.baseRevision!==remote.value.revision)throw Error('L’iPad ha un lavoro più recente. Le tue prove restano qui: salva una copia e aggiorna prima di inviare.');
  const local=await readStores(db,names);preserveSharedBooks(remote.value,local);
  const requestId=crypto.randomUUID(),stores=await encodeJournalStores(local,cloud,remote.value.stores);
  const value={format:'skooling-proposal',profile:profile.sub,device,requestId,baseRevision:remote.value.revision,at:new Date().toISOString(),stores};
  await commitIntent(db,cloud,{kind:'proposal',id:requestId,value},canApply);
  return {principal:false,queued:true,requestId,remote};
 }
 let rejected=0,accepted=0;
 if(principal){
  const proposals=await cloud.listValues('proposal'),receipts=await cloud.listValues('receipt');
  for(const record of receipts){const v=record.value;if(v?.profile!==profile.sub||!['accepted','stale'].includes(v.status)||typeof v.requestId!=='string'||(record.event&&record.event.id!==v.requestId))throw Error('Una ricevuta non è valida. Nessuna proposta è stata applicata.');}
  const completed=new Set(receipts.map(r=>r.value.requestId));const applied=new Set(remote.value.appliedRequests||[]);
  const local=await encodeJournalStores(await readStores(db,names),cloud,remote.value.stores);
  let stores=resumed?.kind==='approved'&&resumed.localStores?mergeForMaster(resumed.localStores,local,remote.value.stores,canonical):local;
  preserveSharedBooks(remote.value,stores);
  let selected=null;
  for(const record of proposals){
   const proposal=checkProposal(record.value,profile,names,device);
   if(completed.has(proposal.requestId))continue;
   if(applied.has(proposal.requestId)){
    await cloud.appendImmutable('receipt',{requestId:proposal.requestId,status:'accepted',profile:profile.sub},proposal.requestId);continue;
   }
   if(proposal.baseRevision!==remote.value.revision||selected){
    await cloud.appendImmutable('receipt',{requestId:proposal.requestId,status:'stale',profile:profile.sub},proposal.requestId);rejected++;continue;
   }
   // The proposal's base is the actual verified current snapshot, never a clock.
   preserveSharedBooks(remote.value,proposal.stores);
   stores=mergeForMaster(remote.value.stores,stores,proposal.stores,canonical);selected=proposal;applied.add(proposal.requestId);accepted++;
  }
  if(canonical(stores)!==canonical(remote.value.stores)||selected){
   preserveSharedBooks(remote.value,stores);
   const revision=crypto.randomUUID();const value={...remote.value,revision,parentRevision:remote.value.revision,generation:remote.value.generation+1,at:new Date().toISOString(),appliedRequests:[...applied],stores};
   await commitIntent(db,cloud,{kind:'approved',id:revision,value,localStores:local},canApply,resumed?.id||null);remote=await cloud.current({lastRevision:revision});
  }
  if(selected)await cloud.appendImmutable('receipt',{requestId:selected.requestId,status:'accepted',profile:profile.sub},selected.requestId);
 }
 if(!canApply())throw Error('Il lavoro è cambiato durante il controllo. La copia online è conservata; riprova quando hai finito.');
 const data=await decodeMedia(remote.value.stores,cloud);
 const state={protocol:'journal1',revision:remote.value.revision,generation:remote.value.generation,master:remote.value.master,lastSync:new Date().toISOString()};
 // Only local sync metadata changed while holding the transfer lock. Re-read it
 // for the atomic DB comparison, and independently guard all personal content.
 const current=await readStores(base,names);
 if(canonical(await contentValue(portable(current)))!==canonical(await contentValue(portable(before))))throw Error('Il lavoro locale è cambiato. Nessuna pagina è stata sostituita.');
 await base.replaceApproved(current,data,state);await base.delete('impostazioni',INTENT);if(db.session?.temporary)db.session.reset(state.revision);
 const requestId=(await base.get('impostazioni','sync-journal-request'))?.valore;let proposalStatus=null;if(!principal&&requestId){const receipts=await cloud.listValues('receipt');proposalStatus=receipts.find(r=>r.value?.profile===profile.sub&&r.value.requestId===requestId)?.value.status||'waiting';}
 return {principal,remote,state,accepted,rejected,proposalStatus};
}
export async function journalDailyBackup({cloud,remote,device,profile,names,now=new Date()}){
 const snapshot=validateSnapshot(remote.value,profile.sub,names);if(snapshot.master!==device)throw Error('La copia giornaliera viene preparata dall’iPad principale.');
 const latest=await cloud.current({lastRevision:snapshot.revision});if(latest.value.revision!==snapshot.revision)throw Error('Il lavoro è cambiato. Riproverò il backup dopo l’aggiornamento.');
 const day=romeDay(now),backups=await cloud.listValues('daily-backup');
 if(backups.some(r=>r.value.day===day&&r.value.snapshot?.master===device&&r.value.snapshot?.revision===snapshot.revision))return false;
 await cloud.appendImmutable('daily-backup',{format:'skooling-daily-backup',version:1,day,snapshot},day+'-'+snapshot.revision);return true;
}
