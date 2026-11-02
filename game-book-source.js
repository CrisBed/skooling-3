import {loadBookNumbering} from './book-numbering-store.js';
import {printedToPhysical,physicalLabel} from './book-pages.js';
import {gameQuestionBank,selectGameQuestions} from './study-game-model.js';
import {isTopicAvailable} from './topic-trash-model.js';
import {canonical} from './sync-model.js';

const MAX_PAGES=80;
const archived=book=>book?.archiviato===true||book?.archived===true;
const bookToken=book=>canonical({id:book.id,editId:book._editId??null,size:book.blob?.size??0,type:book.blob?.type??'',data:book.data??null,titolo:book.titolo??'',materia:book.materia??''});
const anchorToken=state=>canonical(state.anchor);
const abortError=()=>new Error('Preparazione annullata. I tuoi libri non sono stati modificati.');
function physical(value,total){if(!/^\d+$/.test(String(value).trim()))throw Error('Scrivi una pagina PDF intera, a partire da 1.');const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>total)throw Error('Questa pagina non esiste nel PDF.');return n;}
export function resolveGameBookRange(numbering,from,to){
 const first=numbering.known?printedToPhysical(from,numbering):physical(from,numbering.total),last=numbering.known?printedToPhysical(to,numbering):physical(to,numbering.total);
 if(last<first)throw Error('La pagina finale viene prima della pagina iniziale.');
 if(last-first+1>MAX_PAGES)throw Error('Scegli al massimo 80 pagine. Dividi il capitolo in parti, senza saltare pagine.');return{first,last};
}
export async function resolveGameBookChapters(pdf,{check=()=>{}}={}){
 const outline=await pdf.getOutline().catch(()=>null);check();if(!Array.isArray(outline))return[];const flat=[];let visited=0;
 async function walk(items,level=0,path=''){
  if(level>10)return;
  for(let i=0;i<items.length&&visited<500;i++){
   const item=items[i],id=path+i;visited++;check();let first=null;
   if(item&&!item.url&&!item.unsafeUrl&&item.dest){try{const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;check();if(Array.isArray(dest)){const index=Number.isInteger(dest[0])?dest[0]:await pdf.getPageIndex(dest[0]);check();if(Number.isInteger(index)&&index>=0&&index<pdf.numPages)first=index+1;}}catch(error){check();}}
   if(first&&typeof item.title==='string'&&item.title.trim())flat.push({id,title:item.title.trim().slice(0,180),level,first});
   if(Array.isArray(item?.items))await walk(item.items,level+1,id+'.');
  }
 }
 await walk(outline);
 return flat.map((chapter,index)=>{const next=flat.slice(index+1).find(other=>other.level<=chapter.level&&other.first>chapter.first);return{...chapter,last:next?next.first-1:pdf.numPages};});
}
export function balanceGameBookQuestions(pageBanks,{previousIds=[],random=Math.random}={}){
 if(!Array.isArray(pageBanks)||!pageBanks.length||pageBanks.length>MAX_PAGES)throw Error('Scegli da 1 a 80 pagine leggibili.');
 const ordered=pageBanks.map(bank=>selectGameQuestions(bank.questions,{count:bank.questions.length,previousIds,random})),pool=[],seen=new Set();
 for(let round=0;pool.length<80;round++){
  let found=false;for(const bank of ordered){const question=bank[round];if(!question)continue;found=true;if(!seen.has(question.id)){seen.add(question.id);pool.push(question);}if(pool.length===80)break;}if(!found)break;
 }return pool;
}
async function defaultLoadPDF(book,{signal}={}){
 const pdfjs=await import('./vendor/pdf.mjs');if(signal?.aborted)throw abortError();pdfjs.GlobalWorkerOptions.workerSrc='./vendor/pdf.worker.mjs';
 const url=URL.createObjectURL(book.blob),task=pdfjs.getDocument({url,wasmUrl:'./vendor/',disableAutoFetch:true,disableStream:true});let disposed=false;
 const destroy=async()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',abort);try{await task.destroy();}catch{}finally{URL.revokeObjectURL(url);}};
 const abort=()=>{destroy();};signal?.addEventListener('abort',abort,{once:true});
 try{const pdf=await task.promise;if(signal?.aborted){await destroy();throw abortError();}return{pdf,destroy};}catch(error){await destroy();if(signal?.aborted)throw abortError();throw error;}
}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function createGameBookSourceService(db,{loadPDF=defaultLoadPDF,check=()=>{}}={}){
 let activeSession=db.session;const cache=new Map();
 function current(session){if(db.session!==session)throw Error('Il profilo è cambiato. Riapri il gioco.');check();}
 function reset(){if(activeSession!==db.session){activeSession=db.session;cache.clear();}}
 async function readBook(id,session){current(session);const book=await db.get('libri',id);current(session);if(!book||book.id!==id||archived(book)||!(book.blob instanceof Blob)||!book.blob.size)throw Error('Collega il PDF di questo libro sul dispositivo prima di giocare. Il lavoro salvato resta tuo.');return book;}
 async function assertEntry(entry,session){
  const book=await readBook(entry.selection.sourceId,session);if(bookToken(book)!==entry.bookRevision)throw Error('Il libro è cambiato. Scegli di nuovo le pagine prima di giocare.');
  const saved=await loadBookNumbering(db,book.id,entry.total,entry.labels);current(session);if(anchorToken(saved)!==entry.anchorRevision)throw Error('I numeri del libro sono cambiati. Scegli di nuovo le pagine.');
  if(entry.topic){const fresh=await db.get('argomenti',entry.topic.id);current(session);if(!isTopicAvailable(fresh)||canonical(fresh)!==canonical(entry.topic))throw Error('L’argomento è cambiato. Scegli di nuovo la fonte.');}
 }
 async function assertAvailable(selection){
  reset();const session=db.session,entry=cache.get(selection.sourceRevision);if(!entry||entry.selection.sourceId!==selection.sourceId||entry.selection.topicId!==selection.topicId||entry.selection.page!==selection.page||entry.selection.pageEnd!==selection.pageEnd)throw Error('Questa preparazione non è più disponibile. Scegli di nuovo le pagine.');
  await assertEntry(entry,session);return true;
 }
 async function bank(selection,{previousIds=[],random=Math.random}={}){await assertAvailable(selection);return balanceGameBookQuestions(cache.get(selection.sourceRevision).pageBanks,{previousIds,random});}
 async function open(id,{signal,onProgress=()=>{},guard=()=>{}}={}){
  reset();const session=db.session;let resource=null,disposed=false,released=false;
  const alive=()=>{current(session);guard();if(signal?.aborted||disposed)throw abortError();};
  const dispose=async()=>{disposed=true;signal?.removeEventListener('abort',abort);if(resource&&!released){released=true;await resource.destroy();}};
  const abort=()=>{dispose().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
   alive();const book=await readBook(id,session);alive();resource=await loadPDF(book,{signal});alive();const pdf=resource.pdf,total=pdf.numPages;
   const labels=await pdf.getPageLabels().catch(()=>null);alive();const saved=await loadBookNumbering(db,id,total,labels);alive();const chapters=await resolveGameBookChapters(pdf,{check:alive});alive();
   const numbering=saved.numbering,revision=bookToken(book),anchorRevision=anchorToken(saved);
   async function prepare({first,last,materia,chapterTitle='',topic=null}={}){
    try{
     alive();if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>total||last-first+1>MAX_PAGES)throw Error('Scegli da 1 a 80 pagine consecutive, senza superare il libro.');
     const context=topic||{id:'book:'+id,libro:id,materia,titolo:book.titolo};
     if(!isTopicAvailable(context)||context.libro!==id)throw Error('Questa fonte non appartiene all’argomento scelto.');
     if(topic){const fresh=await db.get('argomenti',topic.id);alive();if(!isTopicAvailable(fresh)||canonical(fresh)!==canonical(topic))throw Error('L’argomento è cambiato. Scegli di nuovo la fonte.');}
     const pageBanks=[],unreadablePages=[];
     for(let page=first;page<=last;page++){
      alive();let pdfPage;
      try{
       pdfPage=await pdf.getPage(page);alive();const content=await pdfPage.getTextContent();alive();const plain=content.items.map(item=>item.str||'').join(' ').replace(/\s+/g,' ').trim();
       if(!plain)throw Error('Nessun testo leggibile: serve OCR o trascrizione.');const text=`[Pagina PDF ${page}]\n${plain}`;
       if(text.length>18000)throw Error('Questa pagina supera 18000 caratteri: usa un estratto salvato.');
       const printed=physicalLabel(page,numbering),label=`${book.titolo} · ${printed?'Pagina del libro '+printed+' (PDF '+page+')':'Pagina PDF '+page}`;
       const fingerprint=await digest(JSON.stringify(['book',id,context.id,page,text]));alive();
       const questions=gameQuestionBank({kind:'book',id,topicId:context.id,page,title:book.titolo,label,text,fingerprint},context);pageBanks.push({page,questions});
      }catch(error){alive();unreadablePages.push({page,label:physicalLabel(page,numbering)||String(page),reason:error.message});}finally{pdfPage?.cleanup?.();}
      onProgress({done:page-first+1,total:last-first+1,page});
     }
     alive();if(!pageBanks.length)throw Error('Nessuna pagina scelta contiene testo adatto alle domande. Usa un PDF con OCR, un testo o un quiz salvato.');
     const sourceRevision=await digest(canonical([revision,anchorRevision,context.id,topic?canonical(topic):null,first,last,pageBanks.map(b=>b.questions[0].sourceFingerprint)]));alive();
     const printedFirst=physicalLabel(first,numbering),printedLast=physicalLabel(last,numbering),rangeLabel=numbering.known&&printedFirst&&printedLast?`Pagine del libro ${printedFirst}–${printedLast}`:`PDF ${first}–${last}${numbering.known?' (incluse pagine senza numero stampato)':''}`;
     const selection={topicId:context.id,sourceId:id,sourceKind:'book',page:first,pageEnd:last,materia:materia||context.materia,title:chapterTitle||context.titolo||book.titolo,chapterTitle,rangeLabel,sourceRevision};
     const entry={selection,pageBanks,readablePages:pageBanks.map(b=>b.page),unreadablePages,bookRevision:revision,anchorRevision,total,labels,topic:topic?structuredClone(topic):null};
     await assertEntry(entry,session);alive();cache.set(sourceRevision,entry);while(cache.size>3)cache.delete(cache.keys().next().value);
     return{selection,readablePages:entry.readablePages,unreadablePages,availableCount:balanceGameBookQuestions(pageBanks).length,sourceLabel:`${book.titolo} · ${rangeLabel}`};
    }finally{await dispose();}
   }
   return{book,total,numbering,chapters,prepare,dispose};
  }catch(error){await dispose();throw error;}
 }
 return{open,bank,assertAvailable};
}
