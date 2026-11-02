import {canonical} from './sync-model.js';

export const ARENA_PROFILE_KEY='study-arena-profile-v1';

// Uses the app DB facade: computer drafts remain in RAM, primary iPad writes
// follow the same atomic replacement and synchronization rules as school work.
export function createArenaProfileStore(db,{createProfile,validateProfile,isCurrent=()=>true}){
 const session=db.session;
 let pending=null,tail=Promise.resolve(),busy=false;
 const clone=value=>structuredClone(value);
 const check=()=>{if(db.session!==session||!isCurrent())throw Error('Il profilo o la sessione è cambiato. Chiudi e riapri il gioco.');};
 function decode(row){
  if(!row)return validateProfile(createProfile());
  if(row.id!==ARENA_PROFILE_KEY||!Array.isArray(row.arenaOperations)||row.arenaOperations.some(id=>typeof id!=='string'))throw Error('Il profilo del gioco non è leggibile. I dati restano conservati.');
  return validateProfile(row.valore);
 }
 async function read(){check();await session?.pin?.();check();const row=await db.get('impostazioni',ARENA_PROFILE_KEY);check();return row;}
 async function execute(operation){
  const before=await read(),profile=decode(before);
  if(before?.arenaOperations.includes(operation.id))return clone(profile);
  let next;
  try{next=validateProfile(operation.mutate(clone(profile)));}
  catch(error){throw Object.assign(new Error(error?.message||String(error)),{arenaNoWrite:true});}
  const record={id:ARENA_PROFILE_KEY,valore:next,arenaOperations:[...(before?.arenaOperations||[]),operation.id]};
  check();
  try{await db.putIfUnchanged('impostazioni',record,canonical(before||null));}
  catch(error){
   // A lost acknowledgement may happen after the write. The receipt prevents
   // a retry from buying or rewarding twice, including after a readback error.
   try{const saved=await read();if(saved?.arenaOperations.includes(operation.id))return decode(saved);}catch{}
   throw error;
  }
  const saved=await read();
  if(!saved?.arenaOperations.includes(operation.id)||canonical(decode(saved))!==canonical(next))throw Error('Non riesco a verificare il salvataggio. Premi Riprova prima di continuare.');
  return decode(saved);
 }
 function enqueue(operation,retrying=false){
  const task=tail.then(async()=>{
   check();if(pending&&!retrying)throw Error('Completa il salvataggio: premi Riprova prima di fare un’altra azione.');
   busy=true;
   try{const result=await execute(operation);if(pending?.id===operation.id)pending=null;return result;}
   catch(error){if(error.arenaNoWrite){if(pending?.id===operation.id)pending=null;}else pending=operation;throw error;}
   finally{busy=false;}
  });
  tail=task.catch(()=>{});return task;
 }
 return{
  async load(){return decode(await read());},
  commit(mutate,{operationId=globalThis.crypto.randomUUID()}={}){
   if(typeof mutate!=='function'||typeof operationId!=='string'||!operationId||operationId.length>180)return Promise.reject(Error('Operazione del gioco non valida.'));
   return enqueue({id:operationId,mutate});
  },
  retry(){if(!pending)return Promise.reject(Error('Non ci sono salvataggi da riprovare.'));return enqueue(pending,true);},
  get hasPending(){return Boolean(pending);},get busy(){return busy;},
 };
}
