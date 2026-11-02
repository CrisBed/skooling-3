import {createNumbering} from './book-pages.js';
import {canonical} from './sync-model.js';

function recordId(bookId){
 if(typeof bookId!=='string'||!bookId.trim())throw Error('Libro non valido.');
 return 'book-numbering-'+bookId;
}

function savedState(record,id,total){
 if(!record||record.id!==id)throw Error('Corrispondenza salvata non leggibile. Nessun numero è stato modificato.');
 try{
  const numbering=createNumbering(null,total,record.valore);
  if(!record.valore)throw Error('Corrispondenza assente.');
  return {numbering,anchor:{physical:record.valore.physical,printed:record.valore.printed},status:'saved'};
 }catch(error){throw Error('Corrispondenza salvata non leggibile. Nessun numero è stato modificato.',{cause:error});}
}

// Read and write through the active profile DB, including its Mac RAM overlay.
// A storage error is different from an absent record: never silently reset it.
export async function loadBookNumbering(db,bookId,total,labels=null){
 const id=recordId(bookId),fallback=createNumbering(labels,total);
 let record;
 try{record=await db.get('impostazioni',id);}
 catch(error){throw Error('Non riesco a leggere la corrispondenza salvata di questo libro. Riprova senza riallineare i numeri.',{cause:error});}
 if(record==null)return {numbering:fallback,anchor:null,status:fallback.known?'pdf':'unset'};
 return savedState(record,id,total);
}

export async function saveBookNumbering(db,bookId,total,anchor){
 const id=recordId(bookId);
 createNumbering(null,total,anchor);
 if(!anchor)throw Error('Allineamento non valido.');
 const value={physical:anchor.physical,printed:anchor.printed};
 let previous;
 try{previous=await db.get('impostazioni',id);}
 catch(error){throw Error('Non riesco a leggere la corrispondenza salvata di questo libro. Riprova senza riallineare i numeri.',{cause:error});}
 try{
  const row={id,valore:value};
  if(typeof db.putIfUnchanged==='function')await db.putIfUnchanged('impostazioni',row,canonical(previous||null));
  else await db.put('impostazioni',row);
 }catch(error){throw Error('Non riesco a salvare la corrispondenza. Il salvataggio non è stato confermato: riprova.',{cause:error});}
 try{
  const saved=savedState(await db.get('impostazioni',id),id,total);
  if(saved.anchor.physical!==value.physical||saved.anchor.printed!==value.printed)throw Error('La corrispondenza è cambiata.');
  return saved;
 }catch(error){throw Error('Non riesco a confermare il salvataggio della corrispondenza. Riapri il libro per controllare prima di riallineare.',{cause:error});}
}
