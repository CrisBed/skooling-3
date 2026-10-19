import {improntaLibro} from './ricerca.js';
export function pageRange(first,last){if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last-first>2)throw Error('Scegli da 1 a 3 pagine consecutive del PDF.');return Array.from({length:last-first+1},(_,i)=>first+i);}
export async function extractBookPages(book,first,last,index){
 const numbers=pageRange(first,last);if(!(book?.blob instanceof Blob))throw Error('Collega prima il PDF su questo dispositivo.');
 const result=[];
 if(index?.impronta===improntaLibro(book)){for(const n of numbers)result.push({numero:n,testo:index.pagine.find(p=>p.numero===n)?.testo||''});}
 else{const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='./vendor/pdf.worker.mjs';const url=URL.createObjectURL(book.blob);let task;
  try{task=pdfjs.getDocument({url,wasmUrl:'./vendor/',disableAutoFetch:true,disableStream:true});const pdf=await task.promise;if(last>pdf.numPages)throw Error('Il numero di pagina supera la lunghezza del PDF.');for(const n of numbers){const page=await pdf.getPage(n);const content=await page.getTextContent();result.push({numero:n,testo:content.items.map(i=>i.str||'').join(' ').replace(/\s+/g,' ').trim()});page.cleanup?.();}}
  finally{if(task)await task.destroy().catch(()=>{});URL.revokeObjectURL(url);}
 }
 if(result.some(p=>!p.testo))throw Error('Una pagina non contiene testo leggibile. Serve un PDF con OCR oppure puoi incollare il testo.');const text=result.map(p=>'[Pagina PDF '+p.numero+']\n'+p.testo).join('\n\n');if(text.length>18000)throw Error('L’estratto è troppo lungo: seleziona meno pagine.');return {label:(book.titolo||'Libro').slice(0,85)+' · PDF '+first+(first===last?'':'–'+last),text};
}
