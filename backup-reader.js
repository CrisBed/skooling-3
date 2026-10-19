// Lettura incrementale del formato storico: mai file.text() sull'intero backup.
class Reader {
  constructor(file, progress) { this.file=file;this.progress=progress;this.offset=0;this.buffer='';this.at=0;this.decoder=new TextDecoder('utf-8',{fatal:true}); }
  async fill() {
    if(this.at<this.buffer.length)return true;
    if(this.offset>=this.file.size)return false;
    const end=Math.min(this.offset+131072,this.file.size);
    const bytes=await this.file.slice(this.offset,end).arrayBuffer();this.offset=end;
    this.buffer=this.decoder.decode(bytes,{stream:end<this.file.size});this.at=0;
    this.progress(this.offset/this.file.size);
    return this.buffer.length ? true : this.fill();
  }
  async peek() { return await this.fill()?this.buffer[this.at]:''; }
  async space() { while(await this.fill()){const match=/\S/.exec(this.buffer.slice(this.at));if(match){this.at+=match.index;return;}this.at=this.buffer.length;} }
  async expect(char) {await this.space();if(await this.peek()!==char)throw Error('Il backup contiene dati incompleti o non leggibili.');this.at++;}
  async *stringParts() {
    await this.expect('"');let escaped=false;
    while(await this.fill()){
      const start=this.at;
      while(this.at<this.buffer.length){const char=this.buffer[this.at++];if(!escaped&&char==='"'){yield this.buffer.slice(start,this.at-1);return;}if(!escaped&&char==='\\')escaped=true;else escaped=false;}
      yield this.buffer.slice(start,this.at);
    }
    throw Error('Il backup è troncato: manca la fine di un testo.');
  }
  async string() {let raw='';for await(const part of this.stringParts()){raw+=part;if(raw.length>33554432)throw Error('Un testo nel backup è troppo grande.');}return JSON.parse('"'+raw+'"');}
  async blob() {
    let header='',pending='',mime='',started=false,padded=false;const parts=[];
    for await(let part of this.stringParts()){
      if(!started){header+=part;const comma=header.indexOf(',');if(comma<0){if(header.length>1024)throw Error('File nel backup non valido.');continue;}
        const match=/^data:([^;,]*);base64$/.exec(header.slice(0,comma));if(!match)throw Error('Formato file nel backup non supportato.');mime=match[1]||'application/octet-stream';part=header.slice(comma+1);header='';started=true;}
      if(!part)continue;
      if(padded||!/^[A-Za-z0-9+/]*={0,2}$/.test(part))throw Error('File nel backup danneggiato.');
      pending+=part;const count=pending.length-pending.length%4;
      if(count){const block=pending.slice(0,count);padded=block.includes('=');const binary=atob(block),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);parts.push(new Blob([bytes]));pending=pending.slice(count);}
    }
    if(!started||pending.length)throw Error('File nel backup incompleto.');
    return new Blob(parts,{type:mime});
  }
  async value(depth=0) {
    if(depth>64)throw Error('Struttura del backup non valida.');await this.space();const char=await this.peek();
    if(char==='"')return this.string();
    if(char==='['){this.at++;const result=[];await this.space();if(await this.peek()===']'){this.at++;return result;}while(true){result.push(await this.value(depth+1));await this.space();const end=await this.peek();this.at++;if(end===']')return result;if(end!==',')throw Error('Lista del backup non valida.');}}
    if(char==='{'){this.at++;const result={};let blob;let keys=0;await this.space();if(await this.peek()==='}'){this.at++;return result;}
      while(true){const key=await this.string();await this.expect(':');keys++;const value=key==='__skoolingBlob'?await this.blob():await this.value(depth+1);if(key==='__skoolingBlob')blob=value;Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});await this.space();const end=await this.peek();this.at++;if(end==='}'){if(blob&&keys!==1)throw Error('Contenitore file non valido.');return blob||result;}if(end!==',')throw Error('Oggetto del backup non valido.');}}
    let token='';while(await this.fill()){const rest=this.buffer.slice(this.at),end=rest.search(/[\s,\]}]/);if(end>=0){token+=rest.slice(0,end);this.at+=end;break;}token+=rest;this.at=this.buffer.length;if(token.length>100)throw Error('Valore del backup non valido.');}
    if(!token)throw Error('Il backup è incompleto.');return JSON.parse(token);
  }
}
export async function readBackup(file,{onRow=async()=>{},onProgress=()=>{},requiredStores=[]}={}) {
  const reader=new Reader(file,onProgress),meta={},counts={};let storesSeen=false;
  await reader.expect('{');
  while(true){const key=await reader.string();await reader.expect(':');
    if(key==='stores'){
      if(storesSeen)throw Error('Archivi duplicati nel backup.');storesSeen=true;await reader.expect('{');await reader.space();
      if(await reader.peek()!=='}')while(true){const name=await reader.string();if(Object.hasOwn(counts,name))throw Error('Archivio duplicato nel backup.');counts[name]=0;await reader.expect(':');await reader.expect('[');await reader.space();
        if(await reader.peek()!==']')while(true){const row=await reader.value();if(!row||typeof row!=='object'||Array.isArray(row)||row instanceof Blob||typeof row.id!=='string')throw Error('Una voce del backup non è valida.');await onRow(name,row);counts[name]++;await reader.space();const end=await reader.peek();if(end===']')break;await reader.expect(',');}
        await reader.expect(']');await reader.space();if(await reader.peek()==='}')break;await reader.expect(',');}
      await reader.expect('}');
    }else{if(Object.hasOwn(meta,key))throw Error('Intestazione duplicata nel backup.');Object.defineProperty(meta,key,{value:await reader.value(),enumerable:true});}
    await reader.space();if(await reader.peek()==='}')break;await reader.expect(',');
  }
  await reader.expect('}');await reader.space();if(await reader.peek())throw Error('Dati aggiuntivi dopo il backup.');
  if(meta.formato!=='skooling'||meta.versione!==1||!storesSeen)throw Error('Questo non è un backup di Skooling valido.');
  if(requiredStores.some(name=>!Object.hasOwn(counts,name)))throw Error('Il backup di Skooling è incompleto e non è stato importato.');
  return {...meta,conteggi:counts};
}
