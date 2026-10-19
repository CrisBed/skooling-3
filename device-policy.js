export function isIPad(nav=globalThis.navigator){return /iPad/.test(nav?.userAgent||'')||(/Macintosh/.test(nav?.userAgent||'')&&nav?.maxTouchPoints>1);}
export function deviceIdentity(namespace,storage=globalThis.localStorage){const key=namespace+'-device';let id=storage.getItem(key);if(!id){id=crypto.randomUUID();storage.setItem(key,id);}return id;}
export function validateSnapshot(value,profile,stores){
 if(value?.format!=='skooling-approved'||value.version!==1||value.profile!==profile||typeof value.master!=='string'||!value.master||typeof value.revision!=='string'||!value.revision||!value.stores||typeof value.stores!=='object')throw Error('Archivio approvato non valido o di un altro account.');
 for(const name of stores){if(!Array.isArray(value.stores[name]))throw Error('Archivio approvato incompleto.');const ids=new Set();for(const row of value.stores[name]){if(!row||typeof row.id!=='string'||ids.has(row.id))throw Error('Record duplicato o non valido.');ids.add(row.id);}}
 if(Object.keys(value.stores).some(n=>!stores.includes(n)))throw Error('Archivio con tabelle non previste.');
 return value;
}
export function assertPublish({master,device,base,remote,explicit}){
 if(device!==master&&!explicit)throw Error('Le prove restano locali. Premi Invia agli altri dispositivi.');
 if(base!==remote)throw Error('L’iPad o un altro dispositivo ha aggiornato l’archivio. Invio fermato: le tue prove sono ancora qui. Aggiorna dalla versione approvata prima di riprovare.');
}
export function romeDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function schoolQuiet(date=new Date()){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);return p>='08:30'&&p<'13:30';}
// Three-way record merge: only actual iPad changes win conflicts. Unchanged
// iPad records accept explicitly published work from another device.
export function mergeForMaster(baseline,local,remote,compare){
 const output={};for(const name of Object.keys(local)){const old=new Map((baseline[name]||[]).map(r=>[r.id,r])),ours=new Map(local[name].map(r=>[r.id,r])),theirs=new Map((remote[name]||[]).map(r=>[r.id,r]));const rows=[];
 for(const id of new Set([...old.keys(),...ours.keys(),...theirs.keys()])){const a=ours.get(id),b=old.get(id),chosen=compare(a??null)!==compare(b??null)?a:theirs.get(id);if(chosen)rows.push(chosen);}output[name]=rows;
 }return output;
}
