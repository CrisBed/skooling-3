import {cleanMaterial} from './lesson-materials-model.js';
import {romeDay} from './device-policy.js';

export const PHOTO_LIMIT=10;
export const PHOTO_BYTES_LIMIT=100*1024*1024;

const MIME_BY_EXTENSION={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',avif:'image/avif',gif:'image/gif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff'};
const PHOTO_TYPES=new Set([...Object.values(MIME_BY_EXTENSION),'image/heic-sequence','image/heif-sequence']);
const ALIASES={'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg','image/x-png':'image/png','image/x-ms-bmp':'image/bmp'};
const validId=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=256;

// Solo metadata e riferimenti ai byte originali: nessun DB, ridimensionamento,
// OCR o invio di fotografie. Il chiamante salva argomento e righe insieme.
export function preparaFotoArgomento(files,topic,{now=Date.now(),createId=prefix=>`${prefix}-${crypto.randomUUID()}`}={}){
 if(!validId(topic?.id)||!validId(topic?.materia)||typeof topic?.titolo!=='string'||!topic.titolo.trim()||topic.titolo.trim().length>120)throw Error('Controlla materia, titolo e argomento prima di conservare le foto.');
 const time=now instanceof Date?now.getTime():now;
 if(typeof time!=='number'||!Number.isFinite(time)||!Number.isFinite(new Date(time).getTime()))throw Error('Il momento di salvataggio non contiene una data valida.');
 if(files==null)files=[];
 if(typeof files[Symbol.iterator]!=='function')throw Error('Scegli le fotografie da caricare.');
 const list=Array.from(files);
 if(list.length>PHOTO_LIMIT)throw Error('Puoi caricare fino a 10 foto alla volta.');
 let total=0;
 const prepared=list.map((file,index)=>{
  if(!(file instanceof Blob)||!Number.isFinite(file.size)||file.size<=0)throw Error('Scegli una fotografia non vuota.');
  total+=file.size;
  if(total>PHOTO_BYTES_LIMIT)throw Error('Le foto superano 100 MB complessivi. Scegli meno foto.');
  const name=typeof file.name==='string'&&file.name.trim()?file.name:`appunti-${index+1}.jpg`;
  const declared=file.type.toLowerCase(),extension=name.split('.').at(-1).toLowerCase();
  const mime=ALIASES[declared]||((!declared||declared==='application/octet-stream')?MIME_BY_EXTENSION[extension]:declared);
  if(!PHOTO_TYPES.has(mime))throw Error('Scegli fotografie JPG, PNG, HEIC o un altro formato immagine supportato.');
  return{file:file.type===mime?file:file.slice(0,file.size,mime),name};
 });
 const date=romeDay(new Date(time)),ids=new Set();
 return prepared.map(({file,name},index)=>{
  const id=createId('lezione');
  if(!validId(id)||ids.has(id))throw Error('Non riesco a creare identificativi diversi per le foto. Riprova.');
  ids.add(id);
  const row=cleanMaterial({title:`Appunti ${index+1} · ${topic.titolo.trim()}`.slice(0,120),date,section:'Appunti',url:'',text:'',topic:topic.id,subject:topic.materia,kind:'foto'});
  return{...row,id,file,nomeFile:name,archivioLezione:1,creatoIl:time,aggiornatoIl:time};
 });
}
