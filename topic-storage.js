import {canonical} from './sync-model.js';

// Prepara tutte le righe prima di aprire la transazione o cambiare la prova RAM.
export function prepareTopicWithPhotos(topic,photos,expectedTopic){
 if(!topic||typeof topic.id!=='string'||!topic.id||typeof topic.materia!=='string'||!topic.materia||typeof topic.titolo!=='string'||!topic.titolo.trim()||topic.titolo.length>120||typeof expectedTopic!=='string'||!Array.isArray(photos)||photos.length>10)throw Error('Controlla argomento e fotografie prima di salvare.');
 const prepared=structuredClone({topic,photos}),ids=new Set();let bytes=0;
 for(const photo of prepared.photos){
  if(!photo||typeof photo.id!=='string'||!photo.id||ids.has(photo.id)||photo.argomento!==topic.id||photo.materia!==topic.materia||photo.tipo!=='foto'||photo.archivioLezione!==1||!(photo.file instanceof Blob)||!photo.file.size||!/^image\/(?:jpeg|png|webp|gif|bmp|avif|heic(?:-sequence)?|heif(?:-sequence)?|tiff)$/i.test(photo.file.type))throw Error('Una foto non è valida o appartiene a un altro argomento.');
  ids.add(photo.id);bytes+=photo.file.size;photo._editId=crypto.randomUUID();
 }
 if(bytes>100*1024*1024)throw Error('Le foto superano100MB. Scegli un gruppo più piccolo.');
 prepared.topic._editId=crypto.randomUUID();return prepared;
}

export function savePreparedTopicWithPhotos(database,prepared,expectedTopic){
 return new Promise((resolve,reject)=>{
  const tx=database.transaction(['argomenti','materiali'],'readwrite'),topics=tx.objectStore('argomenti'),materials=tx.objectStore('materiali');let failure;
  tx.oncomplete=()=>resolve(prepared);
  tx.onerror=tx.onabort=()=>reject(failure||Error(tx.error?.name==='ConstraintError'?'Una foto con questo identificativo esiste già. Nessun dato è stato modificato.':'Argomento e foto non salvati. I dati precedenti sono conservati.'));
  const read=topics.get(prepared.topic.id);
  read.onsuccess=()=>{
   try{
    if(canonical(read.result||null)!==expectedTopic)throw Error('L’argomento è cambiato in un’altra finestra. Riaprilo prima di salvare.');
    // add rifiuta una collisione: non sostituisce mai fotografie esistenti.
    for(const photo of prepared.photos)materials.add(photo);
    topics.put(prepared.topic);
   }catch(error){failure=error;tx.abort();}
  };
 });
}
export function saveTopicWithPhotos(database,topic,photos,expectedTopic){
 return savePreparedTopicWithPhotos(database,prepareTopicWithPhotos(topic,photos,expectedTopic),expectedTopic);
}
