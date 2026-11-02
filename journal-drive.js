import {ApprovedDrive} from './approved-drive.js';
import {canonical} from './sync-model.js';
import {validateSnapshot} from './device-policy.js';
import {selectHead} from './journal-model.js';

const ROOT='https://www.googleapis.com/drive/v3/files';
const LIMIT=40*1024*1024;
const utf8=new TextEncoder();
const validKind=kind=>typeof kind==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(kind);
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=256&&!/[\u0000-\u001f\u007f]/.test(id);
function jsonText(value){
 const stack=[{value,depth:0}];
 while(stack.length){const item=stack.pop(),v=item.value;
  if(item.depth>100)throw Error('Contenuto JSON troppo profondo.');
  if(v===null||typeof v==='string'||typeof v==='boolean')continue;
  if(typeof v==='number'&&Number.isFinite(v))continue;
  if(!v||typeof v!=='object'||v instanceof Blob||(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))))throw Error('Contenuto JSON non valido o con file binari non codificati.');
  for(const child of Array.isArray(v)?v:Object.values(v))stack.push({value:child,depth:item.depth+1});
 }
 let serialized;try{serialized=JSON.stringify(value);}catch{throw Error('Contenuto immutabile non valido.');}
 if(typeof serialized!=='string'||utf8.encode(serialized).byteLength>LIMIT)throw Error('Archivio testuale troppo grande o non valido.');
 const restored=JSON.parse(serialized);
 if(canonical(restored)!==canonical(value))throw Error('Il contenuto immutabile deve essere JSON completo, senza file binari.');
 return serialized;
}
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',utf8.encode(canonical(value)));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function different(){return Error('Due contenuti diversi hanno lo stesso identificatore immutabile. Tutte le copie restano conservate.');}

// This transport deliberately never uses the mutable-file API inherited from
// the previous protocol. Only immutable create/read and media are permitted.
export class JournalDrive extends ApprovedDrive{
 constructor(api,namespace,profile,names){
  super(api,namespace);
  this.profile=typeof profile==='string'?profile:profile?.sub;this.names=names;this.pending=new Map();
  if(typeof namespace!=='string'||!/^[\w-]+-journal1$/.test(namespace)||typeof this.profile!=='string'||!this.profile||!Array.isArray(names))throw Error('Configurazione del nuovo archivio non valida.');
 }
 async readImmutable(file){
  const id=typeof file==='string'?file:file?.id||file?.fileId;
  if(typeof id!=='string'||!/^[\w-]{1,256}$/.test(id))throw Error('Riferimento del file immutabile non valido.');
  const response=await this.api.request(`${ROOT}/${encodeURIComponent(id)}?alt=media`);
  const declared=Number(response.headers?.get?.('content-length'));
  if(declared>LIMIT)throw Error('Archivio testuale troppo grande.');
  const text=await response.text();if(text.length>LIMIT||utf8.encode(text).byteLength>LIMIT)throw Error('Archivio testuale troppo grande.');
  let event;try{event=JSON.parse(text);}catch{throw Error('File immutabile non leggibile.');}
  if(event?.format!=='skooling-journal-entry'||event.version!==1||event.namespace!==this.namespace||event.profile!==this.profile||!validKind(event.kind)||!validId(event.id)||typeof event.hash!=='string'||!/^[a-f0-9]{64}$/.test(event.hash)||!Object.hasOwn(event,'value'))throw Error('File immutabile di un altro archivio o account, oppure non valido.');
  jsonText(event.value);
  if(await hash(event.value)!==event.hash)throw Error('Verifica di integrità fallita: il file immutabile è danneggiato.');
  return {id,fileId:id,value:event.value,event};
 }
 async listValues(kind){
  if(!validKind(kind))throw Error('Tipo di evento immutabile non valido.');
  const records=[],logical=new Map();
  for(const file of await this.find(kind)){
   const record=await this.readImmutable(file);
   if(record.event.kind!==kind)throw Error('Il tipo di evento non corrisponde al file elencato.');
   const previous=logical.get(record.event.id);
   if(previous&&(previous.event.hash!==record.event.hash||canonical(previous.value)!==canonical(record.value)))throw different();
   if(!previous){logical.set(record.event.id,record);records.push(record);}
  }
  return records;
 }
 async current({lastRevision=null}={}){
  const events=await this.listValues('approved');
  for(const event of events)validateSnapshot(event.value,this.profile,this.names);
  return selectHead(events,lastRevision);
 }
 async appendImmutable(kind,value,logicalId){
  if(!validKind(kind)||!validId(logicalId))throw Error('Tipo o identificatore immutabile non valido.');
  // No random or clock fields are added here: reconstructing the same caller
  // intent after a reload creates the exact same logical event.
  const restored=JSON.parse(jsonText(value)),contentHash=await hash(restored),key=JSON.stringify([kind,logicalId]);
  const event={format:'skooling-journal-entry',version:1,namespace:this.namespace,profile:this.profile,kind,id:logicalId,hash:contentHash,value:restored};jsonText(event);
  const previous=this.pending.get(key);if(previous&&canonical(previous)!==canonical(event))throw different();
  this.pending.set(key,event);
  const lookup=async()=>{const found=(await this.listValues(kind)).find(record=>record.event.id===logicalId);if(found&&(found.event.hash!==contentHash||canonical(found.value)!==canonical(restored)))throw different();return found;};
  const existing=await lookup();if(existing)return existing;
  let created;
  try{created=await this.create(kind,event);}
  catch(error){
   try{const recovered=await lookup();if(recovered)return recovered;}catch(recoveryError){if(recoveryError.message.includes('diversi'))throw recoveryError;}
   throw Error('Esito dell’invio incerto: nessuna scrittura ritentata. Le copie restano conservate; verifica di nuovo lo stesso invio.');
  }
  try{
   if(!created?.id)throw Error('Identificatore Drive assente.');
   const verified=await this.readImmutable(created);
   if(canonical(verified.event)!==canonical(event))throw different();
   return verified;
  }catch(error){
   if(error.message.includes('diversi'))throw error;
   throw Error('Invio non ancora verificato. Nessuna scrittura ritentata: conserva lo stesso identificatore e riprova la verifica.');
  }
 }
 // Guard against accidental calls from integrations left on the old protocol.
 async replace(){throw Error('Il nuovo archivio ammette solo copie immutabili.');}
 async remove(){throw Error('Il nuovo archivio conserva tutte le copie.');}
 async verifyConcurrency(){throw Error('Usa la verifica immutabile del nuovo archivio.');}
}
