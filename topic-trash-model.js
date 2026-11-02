import {canonical} from './sync-model.js';

const marker='cestinoArgomento';
const validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=256;
const same=(a,b)=>canonical(a)===canonical(b);
const withoutEditId=value=>{const{_editId,...rest}=value;return rest;};

// An unknown marker also stays hidden. It requires a compatible reader before
// recovery, never a guessed reset of the child's saved state.
export function isTopicTrashed(topic){return Boolean(topic&&typeof topic==='object'&&Object.hasOwn(topic,marker));}
export function isTopicAvailable(topic){return Boolean(topic&&typeof topic==='object'&&validId(topic.id)&&!isTopicTrashed(topic)&&topic.archiviato!==true&&topic.archived!==true);}

function checkTopic(topic){
 if(!topic||!validId(topic.id)||!validId(topic.materia)||typeof topic.titolo!=='string'||!topic.titolo.trim())throw Error('Riapri l’argomento prima di usare il cestino.');
}
function checkTime(now){if(!Number.isSafeInteger(now)||now<0)throw Error('Il momento del cestino non è valido. Riprova.');}
function recovery(topic){
 const value=topic[marker];
 if(!value||value.versione!==1||!Number.isSafeInteger(value.spostatoIl)||value.spostatoIl<0||!value.precedenteArchiviato||typeof value.precedenteArchiviato.presente!=='boolean')throw Error('Questa versione del cestino non è leggibile. L’argomento è conservato senza modificarlo.');
 return value;
}
async function currentTopic(db,topic){
 checkTopic(topic);
 const expected=structuredClone(topic),current=await db.get('argomenti',expected.id);
 if(!current||!same(current,expected))throw Error('L’argomento è cambiato in un’altra finestra. Riaprilo prima di continuare.');
 return current;
}
async function save(db,current,next){
 await db.putIfUnchanged('argomenti',next,canonical(current));
 const saved=await db.get('argomenti',current.id);
 if(!saved||!same(withoutEditId(saved),withoutEditId(next)))throw Error('L’argomento è cambiato durante la verifica. Riapri il cestino per controllare lo stato.');
 return saved;
}

export async function trashTopic(db,topic,{now=Date.now()}={}){
 checkTime(now);const current=await currentTopic(db,topic);
 if(isTopicTrashed(current)){recovery(current);return current;}
 const next={...current,archiviato:true,aggiornatoIl:now,[marker]:{versione:1,spostatoIl:now,precedenteArchiviato:{presente:Object.hasOwn(current,'archiviato'),...(current.archiviato!==undefined?{valore:structuredClone(current.archiviato)}:{})}}};
 return save(db,current,next);
}

export async function restoreTopic(db,topic,{now=Date.now()}={}){
 checkTime(now);const current=await currentTopic(db,topic);
 if(!isTopicTrashed(current)){
  if(current.archiviato===true||current.archived===true)throw Error('Questo argomento è archiviato fuori dal cestino. Nessun dato è stato modificato.');
  return current;
 }
 const previous=recovery(current).precedenteArchiviato,next={...current,aggiornatoIl:now};
 delete next[marker];
 if(previous.presente)next.archiviato=structuredClone(previous.valore);else delete next.archiviato;
 return save(db,current,next);
}
