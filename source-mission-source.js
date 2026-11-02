import {isTopicAvailable} from './topic-trash-model.js';
import {extractBookPages} from './tutor-source.js';

const MAX_TEXT=18000;
const validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=256;
const archived=value=>value?.archived===true||value?.archiviato===true;
const title=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,180):fallback;
const initialPage=value=>Number.isSafeInteger(value)&&value>0?value:1;

function materialText(material){
 if(typeof material?.testo==='string'&&material.testo.trim())return material.testo;
 // Saved tutor lessons have their actual explanation here. No summary, OCR,
 // URL, caption or audio is invented when no readable text was saved.
 if(material?.tipo==='lezione'&&typeof material.lezione?.spiegazione==='string'&&material.lezione.spiegazione.trim())return material.lezione.spiegazione;
 return null;
}
function readableText(value){
 if(typeof value!=='string'||!value.trim())throw Error('La fonte non contiene testo leggibile. Per una scansione serve il testo OCR già disponibile oppure una trascrizione salvata.');
 if(value.length>MAX_TEXT)throw Error('Il testo è troppo lungo: usa un estratto di massimo 18000 caratteri.');
 return value.trim();
}
async function resolveTopic(db,topic){
 if(!validId(topic?.id))throw Error('Scegli un argomento valido prima di leggere una fonte.');
 if(topic.id.startsWith('book:')){
  if(!validId(topic.libro)||topic.id!=='book:'+topic.libro)throw Error('La fonte non appartiene al libro di questo argomento.');
  return {id:topic.id,libro:topic.libro,pagina:initialPage(topic.pagina),synthetic:true};
 }
 const current=await db.get('argomenti',topic.id);
 if(!current||current.id!==topic.id||!isTopicAvailable(current))throw Error('L’argomento è cambiato, è stato archiviato o non è più disponibile. Riaprilo prima di scegliere la fonte.');
 return current;
}
function bookDescriptor(topic,book){
 const name=title(book?.titolo,'Libro collegato'),page=initialPage(topic.pagina);
 return {kind:'book',id:topic.libro,title:name,label:`${name} · Pagina PDF ${page}`,topicId:topic.id,page};
}
function materialDescriptor(topic,material){
 const name=title(material.titolo,'Materiale salvato');
 return {kind:'material',id:material.id,title:name,label:`${name} · Testo salvato`,topicId:topic.id,...(typeof material.tipo==='string'?{type:material.tipo}:{})};
}
async function fingerprint(identity,text){
 const bytes=new TextEncoder().encode(JSON.stringify([identity.kind,identity.id,identity.topicId,identity.page??null,text]));
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

// Descriptors carry identity and location only. The caller receives neither
// book bytes nor material text until it explicitly loads one selected source.
export async function listMissionSources(db,topic){
 const current=await resolveTopic(db,topic),sources=[];
 if(validId(current.libro)){
  const book=await db.get('libri',current.libro);
  if(!book||(!archived(book)&&book.id===current.libro))sources.push(bookDescriptor(current,book));
 }
 if(!current.synthetic){
  for(const material of await db.getAll('materiali')){
   if(validId(material?.id)&&material.argomento===current.id&&!archived(material)&&materialText(material)!==null)sources.push(materialDescriptor(current,material));
  }
 }
 return sources;
}

export async function loadMissionSource(db,descriptor,{page=descriptor?.page,extract=extractBookPages}={}){
 if(!['book','material'].includes(descriptor?.kind)||!validId(descriptor.id)||!validId(descriptor.topicId))throw Error('La fonte selezionata non è valida. Riapri l’argomento.');
 const topic=await resolveTopic(db,{id:descriptor.topicId,libro:descriptor.kind==='book'?descriptor.id:undefined});
 let source,text;
 if(descriptor.kind==='book'){
  if(topic.libro!==descriptor.id)throw Error('Il collegamento del libro nell’argomento è cambiato. Riapri la fonte.');
  if(!Number.isSafeInteger(page)||page<1)throw Error('Scegli una pagina PDF intera, a partire da 1.');
  const book=await db.get('libri',descriptor.id);
  if(!book||book.id!==descriptor.id||archived(book)||!(book.blob instanceof Blob)||!book.blob.size)throw Error('Collega prima il PDF di questo libro sul dispositivo. La fonte salvata resta conservata.');
  if(typeof extract!=='function')throw Error('La lettura della pagina PDF non è disponibile.');
  // Deliberately omit indicelibri: its historical size/date fingerprint cannot
  // attest that indexed text belongs to the currently connected PDF bytes.
  const extracted=await extract(book,page,page,undefined);
  text=readableText(extracted?.text);
  const markers=[...text.matchAll(/\[Pagina PDF (\d+)\]/g)];
  if(markers.length!==1||markers[0][1]!==String(page)||!text.startsWith(`[Pagina PDF ${page}]\n`)||!text.slice(markers[0][0].length).trim())throw Error('Il testo non attesta una sola pagina PDF leggibile con il numero scelto.');
  const name=title(book.titolo,'Libro collegato');source={kind:'book',id:book.id,title:name,label:`${name} · Pagina PDF ${page}`,page};
 }else{
  if(topic.synthetic)throw Error('Una fonte materiale richiede il proprio argomento salvato.');
  const material=await db.get('materiali',descriptor.id);
  if(!material||material.id!==descriptor.id||archived(material))throw Error('La fonte materiale non è più disponibile oppure è stata archiviata.');
  if(material.argomento!==topic.id)throw Error('Questa fonte appartiene a un altro argomento. Riapri il materiale corretto.');
  text=readableText(materialText(material));
  const name=title(material.titolo,'Materiale salvato');source={kind:'material',id:material.id,title:name,label:`${name} · Testo salvato`};
 }
 return {...source,text,fingerprint:await fingerprint({...source,topicId:topic.id},text)};
}
