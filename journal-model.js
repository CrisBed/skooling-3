import {canonical} from './sync-model.js';

function metadata(value){
 if(!value||value.format!=='skooling-approved'||value.version!==1||typeof value.profile!=='string'||!value.profile||typeof value.master!=='string'||!value.master||typeof value.revision!=='string'||!value.revision||!Number.isSafeInteger(value.generation)||value.generation<0||(value.parentRevision!==null&&(typeof value.parentRevision!=='string'||!value.parentRevision)))throw Error('Cronologia approvata non valida.');
 if((value.generation===0)!==(value.parentRevision===null))throw Error('Generazione della radice non valida.');
 return value;
}

// A complete, single-parent, single-author chain is required. Never choose a
// winner by timestamp or file ordering: a fork needs an explicit recovery.
export function selectHead(events,lastRevision=null){
 const revisions=new Map();
 for(const event of events){const value=metadata(event.value),previous=revisions.get(value.revision);
  if(previous&&canonical(previous.value)!==canonical(value))throw Error('Due contenuti diversi hanno lo stesso identificatore di revisione.');
  if(!previous)revisions.set(value.revision,event);
 }
 if(!revisions.size){if(lastRevision)throw Error('Cronologia incompleta: la revisione precedente verificata non è visibile.');return null;}
 const roots=[...revisions.values()].filter(event=>event.value.parentRevision===null);
 if(roots.length!==1)throw Error('Trovate più radici o una cronologia incompleta. Nessuna copia viene sostituita.');
 const root=roots[0].value,parents=new Set();
 for(const event of revisions.values()){
  const value=event.value;
  if(value.master!==root.master||value.profile!==root.profile)throw Error('Il dispositivo principale o l’account cambiano nella cronologia.');
  if(value.parentRevision!==null){const parent=revisions.get(value.parentRevision)?.value;
   if(!parent)throw Error('Cronologia incompleta: manca una revisione precedente.');
   if(value.generation!==parent.generation+1)throw Error('Generazione della cronologia non consecutiva.');
   parents.add(value.parentRevision);
  }
 }
 const heads=[...revisions.values()].filter(event=>!parents.has(event.value.revision));
 if(heads.length!==1)throw Error('Trovati rami divergenti su Drive. Tutte le copie restano conservate.');
 const head=heads[0];let current=head,visited=0,includesPrevious=!lastRevision;
 while(current){visited++;if(current.value.revision===lastRevision)includesPrevious=true;current=current.value.parentRevision===null?null:revisions.get(current.value.parentRevision);}
 if(visited!==revisions.size)throw Error('Cronologia incompleta o divergente.');
 if(!includesPrevious)throw Error('Cronologia incompleta: la revisione precedente verificata non è visibile. Aggiornamento rinviato.');
 return head;
}

// Files are retained physically; only this logical selection advances.
export function selectDailyBackup(events,options={}){
 const day=typeof options==='string'?options:options.day;
 const selected=[];let identity;
 for(const event of events){const value=event.value;
  if(value?.format!=='skooling-daily-backup'||value.version!==1||typeof value.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.day))throw Error('Backup giornaliero non valido.');
  const snapshot=metadata(value.snapshot),key=JSON.stringify([snapshot.profile,snapshot.master]);
  if(identity&&identity!==key)throw Error('Copie di backup appartenenti a dispositivi principali diversi.');identity=key;
  if(!day||value.day===day)selected.push(event);
 }
 if(!selected.length)return null;
 const latestDay=day||selected.map(event=>event.value.day).sort().at(-1),sameDay=selected.filter(event=>event.value.day===latestDay),generations=new Map();
 for(const event of sameDay){const snapshot=event.value.snapshot,previous=generations.get(snapshot.generation);
  if(previous&&canonical(previous.value.snapshot)!==canonical(snapshot))throw Error('Copie diverse del backup con la stessa generazione.');
  if(!previous)generations.set(snapshot.generation,event);
 }
 return [...generations.values()].sort((a,b)=>b.value.snapshot.generation-a.value.snapshot.generation)[0];
}
