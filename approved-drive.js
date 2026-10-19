// Independent namespace: legacy clients cannot overwrite approved snapshots.
const ROOT='https://www.googleapis.com/drive/v3/files';
export class ApprovedDrive {
 constructor(api,namespace){this.api=api;this.namespace=namespace;this.assets=null;}
 async find(kind){const q=new URLSearchParams({spaces:'appDataFolder',q:`trashed = false and appProperties has { key='skooling' and value='${this.namespace}-${kind}' }`,fields:'nextPageToken,files(id,name,size)',pageSize:'1000'});let page,files=[];do{if(page)q.set('pageToken',page);const data=await(await this.api.request(`${ROOT}?${q}`)).json();files.push(...(data.files||[]));page=data.nextPageToken;}while(page);return files;}
 async current(kind='approved'){
  const files=await this.find(kind);if(files.length>1)throw Error('Trovate più copie principali su Drive. Nessuna è stata sostituita: serve confrontarle.');if(!files.length)return null;
  const r=await this.api.request(`${ROOT}/${files[0].id}?alt=media`);const text=await r.text();if(text.length>40*1024*1024)throw Error('Archivio testuale troppo grande.');const etag=r.headers.get('ETag');
  return {id:files[0].id,etag,value:JSON.parse(text)};
 }
 async create(kind,value){const boundary='skooling_'+crypto.randomUUID();const metadata={name:`${this.namespace}-${kind}.json`,parents:['appDataFolder'],appProperties:{skooling:`${this.namespace}-${kind}`}};const body=new Blob([`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,JSON.stringify(value),`\r\n--${boundary}--`]);return(await this.api.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body})).json();}
 async replace(file,value){if(!file?.etag||file.etag.startsWith('W/'))throw Error('Drive non fornisce una revisione verificabile. Invio sospeso per proteggere il lavoro: nessuna copia è stata sovrascritta.');
  const r=await this.api.request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':file.etag},body:JSON.stringify(value)});return r.json();
 }
 async verifyConcurrency(){
  if(this.concurrencyVerified)return;
  const kind='revision-check-'+crypto.randomUUID();let file;
  try{await this.create(kind,{test:1});file=await this.current(kind);if(!file)throw Error('Verifica Drive non completata.');
   await this.replace(file,{test:2});
   let refused=false;try{await this.replace(file,{test:3});}catch(error){if(error.status===412)refused=true;else throw error;}
   if(!refused)throw Error('Drive non ha bloccato una revisione vecchia nella prova di sicurezza. Invio sospeso: serve un servizio che garantisca questo controllo. Nessun lavoro è stato sostituito.');
   this.concurrencyVerified=true;
  }finally{if(file)await this.remove(file).catch(()=>{});}
 }
 async remove(file){await this.api.request(`${ROOT}/${encodeURIComponent(file.id)}`,{method:'DELETE'});}
 async uploadChunk(blob,hash){if(!this.assets)this.assets=new Map((await this.find('media')).map(f=>[f.name,f]));if(this.assets.has(hash))return this.assets.get(hash).id;
  const boundary='skooling_'+crypto.randomUUID(),metadata={name:hash,parents:['appDataFolder'],appProperties:{skooling:`${this.namespace}-media`}};
  const body=new Blob([`--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,blob,`\r\n--${boundary}--`]);const file=await(await this.api.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body})).json();
  // Verify the bytes before referencing a new media object in approved data.
  const got=await this.chunk(file.id,hash);if(got.size!==blob.size)throw Error('Verifica del file non riuscita.');this.assets.set(hash,file);return file.id;
 }
 async chunk(id,hash){if(!/^[\w-]+$/.test(id)||!/^[a-f0-9]{64}$/.test(hash))throw Error('Riferimento media non valido.');const blob=await(await this.api.request(`${ROOT}/${id}?alt=media`)).blob();if(blob.size>4*1024*1024)throw Error('Porzione media troppo grande.');if(await digest(blob)!==hash)throw Error('File incompleto o danneggiato su Drive.');return blob;}
}
export async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function encodeMedia(value,drive){if(value instanceof Blob){const chunks=[];for(let n=0;n<value.size;n+=4*1024*1024){const part=value.slice(n,n+4*1024*1024),hash=await digest(part);chunks.push({id:await drive.uploadChunk(part,hash),hash});}return {__skoolingMedia:1,type:value.type,size:value.size,chunks};}if(Array.isArray(value)){const out=[];for(const v of value)out.push(await encodeMedia(v,drive));return out;}if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value)){if(v!==undefined)out[k]=await encodeMedia(v,drive);}return out;}return value;}
export async function decodeMedia(value,drive){if(value?.__skoolingMedia===1){if(!Number.isSafeInteger(value.size)||value.size<0||!Array.isArray(value.chunks)||value.chunks.length>100||value.size>400*1024*1024)throw Error('Media non valido.');const parts=[];for(const part of value.chunks)parts.push(await drive.chunk(part.id,part.hash));const blob=new Blob(parts,{type:value.type});if(blob.size!==value.size)throw Error('Media incompleto.');return blob;}if(Array.isArray(value)){const out=[];for(const v of value)out.push(await decodeMedia(v,drive));return out;}if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value))out[k]=await decodeMedia(v,drive);return out;}return value;}
