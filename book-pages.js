export function createNumbering(labels,total,anchor=null){
 if(!Number.isInteger(total)||total<1)throw Error('Libro non valido.');
 if(anchor){if(!Number.isInteger(anchor.physical)||anchor.physical<1||anchor.physical>total||!Number.isInteger(anchor.printed)||anchor.printed<1)throw Error('Allineamento non valido.');return {total,offset:anchor.physical-anchor.printed,labels:null,known:true};}
 const usable=Array.isArray(labels)&&labels.length===total&&labels.every(x=>typeof x==='string'&&x.length<100);
 return {total,offset:null,labels:usable?labels:null,known:usable};
}
export function printedToPhysical(value,numbering){
 const text=String(value).trim();if(!text)throw Error('Scrivi il numero della pagina del libro.');
 if(!numbering.known)throw Error('Usa “Allinea numeri” prima di cercare una pagina del libro.');
 if(numbering.labels){const found=numbering.labels.flatMap((v,i)=>v.trim()===text?[i+1]:[]);if(found.length>1)throw Error('Questo numero si ripete nel PDF. Usa “Allinea numeri”.');if(found.length===1)return found[0];throw Error('Questa pagina non esiste nel libro.');}
 if(!/^\d+$/.test(text)||Number(text)<1)throw Error('Scrivi un numero di pagina valido.');
 const physical=Number(text)+numbering.offset;if(physical<1||physical>numbering.total)throw Error('Questa pagina non esiste nel libro.');return physical;
}
export function physicalLabel(physical,numbering){if(!numbering.known)return '';if(numbering.labels)return numbering.labels[physical-1]||'';const n=physical-numbering.offset;return n>0?String(n):'';}
