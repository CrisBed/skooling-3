import {DB,DB_NAME} from './db.js';
import {activeDatabaseName} from './students.js';
import {MATERIE} from './orario.js';
import {isTopicTrashed,trashTopic,restoreTopic} from './topic-trash-model.js';

const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const notify=error=>document.dispatchEvent(new CustomEvent('skooling:message',{detail:{text:error.message,error:true}}));
const subjectName=subject=>MATERIE.find(item=>item.id===subject)?.nome||subject;
const sessionNote=()=>DB.session?.temporary?'Sul computer questo cambio resta una prova locale. Per conservarlo usa Invia all’iPad principale.':'L’argomento e i suoi materiali restano conservati in questo profilo.';

function mount(title,content){
 const dialog=document.createElement('dialog');dialog.className='quiz-dialog topic-trash-dialog';dialog.setAttribute('aria-label',title);
 dialog.innerHTML=`<div class="dialog-form"><h2>${h(title)}</h2>${content}<p class="form-error" role="alert" data-error></p><p class="small-copy">${h(sessionNote())}</p></div>`;
 const previous=document.activeElement,session=DB.session;let busy=false;
 const q=selector=>dialog.querySelector(selector),current=()=>{try{return dialog.isConnected&&DB.session===session&&activeDatabaseName()===DB_NAME;}catch{return false;}};
 const setBusy=value=>{busy=value;for(const element of dialog.querySelectorAll('button'))element.disabled=value;};
 const showError=error=>{if(current())q('[data-error]').textContent=error.message||'Il cestino non è disponibile. Riprova.';};
 const close=()=>{if(!busy)dialog.close();};
 const unload=event=>{if(busy){event.preventDefault();event.returnValue='';}};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('close',()=>{window.removeEventListener('beforeunload',unload);dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:topic-trash-closed'));});
 window.addEventListener('beforeunload',unload);document.body.append(dialog);dialog.showModal();
 return{dialog,q,current,setBusy,showError,close};
}
async function changed(callback,topic){try{await callback(topic);}catch(error){notify(error);}}

export async function confirmTrashTopic(topic,onChanged=async()=>{}){
 if(document.querySelector('.topic-trash-dialog[open]'))return;
 const state=mount('Sposta argomento nel cestino',`<p>Vuoi spostare <strong>${h(topic.titolo)}</strong> nel cestino?</p><p>Foto, mappe, appunti e risultati resteranno conservati insieme all’argomento. Potrai ripristinarli quando vuoi.</p><p>I libri e i quaderni collegati restano al loro posto.</p><p class="small-copy" data-count>Controllo i materiali collegati…</p><div class="dialog-actions"><button type="button" class="button secondary" data-cancel>Annulla</button><button type="button" class="button primary" data-confirm disabled>Sposta nel cestino</button></div>`);
 const{dialog,q,current,setBusy,showError,close}=state;q('[data-cancel]').onclick=close;
 try{
  const[materials,results]=await Promise.all([DB.getAll('materiali'),DB.getAll('risultati')]);
  if(!current())return;
  const materialCount=materials.filter(row=>row.argomento===topic.id).length,resultCount=results.filter(row=>row.argomento===topic.id).length;
  q('[data-count]').textContent=`Conserviamo ${materialCount} ${materialCount===1?'materiale':'materiali'} e ${resultCount} ${resultCount===1?'risultato':'risultati'}.`;
  q('[data-confirm]').disabled=false;
 }catch(error){showError(error);}
 q('[data-confirm]').onclick=async()=>{
  if(!current())return;setBusy(true);q('[data-error]').textContent='';
  try{const saved=await trashTopic(DB,topic);if(!current())return;setBusy(false);dialog.close();await changed(onChanged,saved);}
  catch(error){showError(error);}finally{if(current())setBusy(false);}
 };
 return dialog;
}

export async function openTopicTrash({subject='',onChanged=async()=>{}}={}){
 if(document.querySelector('.topic-trash-dialog[open]'))return;
 const title=subject?`Cestino · ${subjectName(subject)}`:'Cestino degli argomenti';
 const state=mount(title,`<p>Qui ritrovi gli argomenti messi da parte. Ripristina li riporta nella materia con i loro materiali.</p><div class="material-list" data-topics></div><div class="dialog-actions"><button type="button" class="button secondary" data-reload>Rileggi il cestino</button><button type="button" class="button primary" data-close>Chiudi</button></div>`);
 const{dialog,q,current,setBusy,showError,close}=state;q('[data-close]').onclick=close;
 let paintEpoch=0;
 async function paint(){
  const epoch=++paintEpoch;q('[data-error]').textContent='';const topics=(await DB.getAll('argomenti')).filter(topic=>isTopicTrashed(topic)&&(!subject||topic.materia===subject)).sort((a,b)=>(Number(b.cestinoArgomento?.spostatoIl)||0)-(Number(a.cestinoArgomento?.spostatoIl)||0));
  if(!current()||epoch!==paintEpoch)return;
  const list=q('[data-topics]');list.replaceChildren();
  for(const topic of topics){
   const card=document.createElement('article');card.className='material-card';
   card.innerHTML=`<small>${h(subjectName(topic.materia))}</small><h3>${h(topic.titolo)}</h3><p>Materiali e collegamenti conservati.</p><button type="button" class="button secondary" data-restore>Ripristina argomento</button>`;
   card.querySelector('[data-restore]').onclick=async()=>{
    if(!current())return;setBusy(true);q('[data-error]').textContent='';
    try{const restored=await restoreTopic(DB,topic);if(!current())return;await changed(onChanged,restored);await paint();}
    catch(error){showError(error);}finally{if(current())setBusy(false);}
   };
   list.append(card);
  }
  if(!topics.length){const empty=document.createElement('p');empty.className='studio-empty';empty.textContent='Nessun argomento nel cestino.';list.append(empty);}
 }
 q('[data-reload]').onclick=()=>paint().catch(showError);await paint().catch(showError);return dialog;
}
