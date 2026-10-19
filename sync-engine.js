import { canonical, delta, mergeOperations, validateOperations, recordKey } from './sync-model.js';

export async function synchronize(db,api,profile,makeId, resolutions=[], canApply=()=>true) {
 const snapshot=await db.syncSnapshot();
 const setting=id=>snapshot.stores.impostazioni.find(r=>r.id===id)?.valore;
 if(setting('sync-owner')?.sub!==profile.sub)throw Error('Questo archivio è collegato a un altro account.');
 const baseline=setting('sync-state')||{values:{},heads:{},conflicts:[]};
 const device=baseline.device||makeId();
 const files=await api.list(), cloud=[];
 for(const file of files)cloud.push(...validateOperations(await api.read(file),profile.sub));
 // Validate the entire history before uploading or writing anything.
 const before=mergeOperations(cloud), conflictKeys=new Set([...(baseline.conflicts||[]).map(c=>c.key),...before.conflicts.map(c=>c.key)]);
 const local=delta(snapshot.records,baseline,makeId,device).filter(op=>!conflictKeys.has(recordKey(op.store,op.key)));
 for(const resolution of resolutions){const conflict=before.conflicts.find(c=>c.key===resolution.key);if(!conflict)throw Error('Il conflitto è cambiato. Ricarica la sincronizzazione.');const choice=conflict.versions.find(v=>v.id===resolution.id);if(!choice)throw Error('Versione non disponibile.');const[store,key]=JSON.parse(conflict.key);local.push({id:makeId(),store,key,value:choice.value,parents:before.heads[conflict.key],device,at:new Date().toISOString()});}
 const merged=mergeOperations([...cloud,...local]);
 // Split large initial archives without ever sending PDFs. Preflight all
 // individual records before uploading the first batch.
 const batches=[];let batch=[],size=0;
 for(const op of local){const bytes=new Blob([JSON.stringify(op)]).size;if(bytes>8*1024*1024)throw Error('Una singola pagina supera 8 MB. I dati locali sono conservati; riduci questa pagina prima di sincronizzare.');if(size+bytes>8*1024*1024){batches.push(batch);batch=[];size=0;}batch.push(op);size+=bytes;}
 if(batch.length)batches.push(batch);
 for(const ops of batches)await api.append({formato:'skooling3-sync',versione:1,profile:profile.sub,ops});
 // A save or backup restore during network requests aborts the local apply.
 if(!canApply())throw Error('Hai aperto un libro o un’operazione. Le modifiche sono su Drive; riprova dopo aver chiuso.');
 await db.applySync(snapshot.records,merged,profile.sub,device,canApply);
 return {conflicts:merged.conflicts,uploaded:local.length,files:files.length};
}
