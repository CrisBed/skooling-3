export const SYNC_STORES=['libri','annotazioni','segnalibri','letture','quaderni','paginequaderno','compiti','impostazioni','argomenti','materiali','risultati'];
export const localSetting=id=>id.startsWith('sync-')||['backup-libri-esclusi','disegna-dito'].includes(id);
export const recordKey=(store,id)=>JSON.stringify([store,id]);
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export function hasBinary(value){return value instanceof Blob||Boolean(value&&typeof value==='object'&&Object.values(value).some(hasBinary));}
function strip(value){if(value instanceof Blob)return undefined;if(Array.isArray(value))return value.map(v=>strip(v)??null);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>!(v instanceof Blob)).map(([k,v])=>[k,strip(v)]));return value;}
export function projectedRow(store,row){
 if(store==='impostazioni'&&localSetting(row.id))return null;
 if(store==='materiali'&&hasBinary(row))return null;
 if(store==='libri')return Object.fromEntries(['id','titolo','materia','data','ultimaPagina','numeroPagine'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
 return strip(row);
}
export function project(stores){const records={};for(const name of SYNC_STORES)for(const row of stores[name]||[]){const value=projectedRow(name,row);if(value)records[recordKey(name,row.id)]=value;}return records;}
export function fingerprints(records){return Object.fromEntries(Object.entries(records).map(([key,value])=>[key,canonical(value)]));}
export function delta(records,baseline,makeId,device){const now=fingerprints(records),ops=[];for(const key of new Set([...Object.keys(now),...Object.keys(baseline.values||{})])){if(now[key]===baseline.values?.[key])continue;const [store,id]=JSON.parse(key);ops.push({id:makeId(),store,key:id,value:records[key]??null,parents:baseline.heads?.[key]||[],device,at:new Date().toISOString()});}return ops;}
export function validateOperations(envelope,profile){
 if(!envelope||envelope.formato!=='skooling3-sync'||envelope.versione!==1||envelope.profile!==profile||!Array.isArray(envelope.ops))throw Error('Archivio Drive non valido o appartenente a un altro account.');
 for(const op of envelope.ops){if(!op||typeof op.id!=='string'||!op.id||!SYNC_STORES.includes(op.store)||typeof op.key!=='string'||!op.key||!Array.isArray(op.parents)||op.parents.some(p=>typeof p!=='string')||typeof op.device!=='string'||typeof op.at!=='string'||(op.value!==null&&(!op.value||typeof op.value!=='object'||Array.isArray(op.value)||op.value.id!==op.key||hasBinary(op.value))))throw Error('Una modifica su Drive non è valida.');if(op.store==='impostazioni'&&localSetting(op.key))throw Error('Il cloud contiene impostazioni riservate al dispositivo.');if(op.value&&canonical(op.value)!==canonical(projectedRow(op.store,op.value)))throw Error('Il cloud contiene file non previsti dalla sincronizzazione.');}
 return envelope.ops;
}
export function mergeOperations(operations){
 const all=new Map();for(const op of operations){if(all.has(op.id)&&canonical(all.get(op.id))!==canonical(op))throw Error('Due modifiche diverse hanno lo stesso identificatore.');all.set(op.id,op);}
 // Topological validation avoids recursion limits on years of handwriting.
 const degree=new Map(),children=new Map();
 for(const op of all.values()){
  degree.set(op.id,op.parents.length);
  for(const id of op.parents){const parent=all.get(id);if(!parent||recordKey(parent.store,parent.key)!==recordKey(op.store,op.key))throw Error('Cronologia Drive incompleta.');if(!children.has(id))children.set(id,[]);children.get(id).push(op.id);}
 }
 const queue=[...all.keys()].filter(id=>degree.get(id)===0);let visited=0;
 for(let i=0;i<queue.length;i++){const id=queue[i];visited++;for(const child of children.get(id)||[]){degree.set(child,degree.get(child)-1);if(degree.get(child)===0)queue.push(child);}}
 if(visited!==all.size)throw Error('Cronologia Drive non valida.');
 const parents=new Set([...all.values()].flatMap(op=>op.parents)),groups=new Map();for(const op of all.values()){if(parents.has(op.id))continue;const key=recordKey(op.store,op.key);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(op);}
 const records={},heads={},conflicts=[];for(const[key,ops]of groups){ops.sort((a,b)=>a.id.localeCompare(b.id));heads[key]=ops.map(op=>op.id);const versions=new Map(ops.map(op=>[canonical(op.value),op]));if(versions.size>1){conflicts.push({key,versions:[...versions.values()]});continue;}if(ops[0].value!==null)records[key]=ops[0].value;}
 return {records,heads,conflicts};
}
export function preserveBinary(local,remote){if(local instanceof Blob)return local;if(Array.isArray(remote))return remote.map((item,i)=>preserveBinary(local?.[i],item));if(remote&&typeof remote==='object'){const result={...remote};for(const[k,v]of Object.entries(local||{})){if(v instanceof Blob)result[k]=v;else if(remote[k]&&typeof remote[k]==='object')result[k]=preserveBinary(v,remote[k]);}return result;}return remote;}

export function otherDeviceResolutions(conflicts,localDevice){
 if(!localDevice||!conflicts.length)return [];
 const remoteDevices=new Set(conflicts.flatMap(c=>c.versions.filter(v=>v.device!==localDevice).map(v=>v.device)));
 if(remoteDevices.size!==1)return [];
 const result=[];
 for(const c of conflicts){const remote=c.versions.filter(v=>v.device!==localDevice);if(remote.length!==1||!c.versions.some(v=>v.device===localDevice))return [];result.push({key:c.key,id:remote[0].id});}
 return result;
}
