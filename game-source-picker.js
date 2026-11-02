import {DB,DB_NAME} from './db.js';
import {activeDatabaseName} from './students.js';
import {MATERIE} from './orario.js';
import {isTopicAvailable} from './topic-trash-model.js';
import {listMissionSources,loadMissionSource} from './source-mission-source.js';
import {gameQuestionBank,demoGameQuestionBank,selectGameQuestions} from './study-game-model.js';
import {readGameAccess} from './game-access.js';
import {canonical} from './sync-model.js';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const subjectName=id=>MATERIE.find(m=>m.id===id)?.nome||id;
let historySession=null;const history=new Map();
function currentSession(session){return DB.session===session&&activeDatabaseName()===DB_NAME;}
function check(session){if(!currentSession(session))throw Error('Il profilo è cambiato. Riapri il gioco.');if(!readGameAccess().allowed)throw Error('È ora di scuola. Riapri il gioco con il permesso del papà.');}
async function sourcesFor(topic){
 const materials=(await DB.getAll('materiali')).filter(m=>m.argomento===topic.id&&m.archiviato!==true&&m.archived!==true);
 const quizzes=materials.filter(m=>m.tipo==='quiz').map(m=>({kind:'quiz',id:m.id,title:m.titolo||'Quiz salvato',topicId:topic.id}));
 return[...quizzes,...await listMissionSources(DB,topic)];
}
async function prepare(selection,{count,previousIds,session}){
 check(session);let pool,normalized,sourceLabel;
 if(selection.topicId==='demo'){
  pool=demoGameQuestionBank();normalized={topicId:'demo',sourceId:'demo',sourceKind:'demo',materia:'matematica',title:'Frazioni · prova dimostrativa'};sourceLabel='Esercizi preparati sulle frazioni, separati dai tuoi libri.';
 }else{
  const topic=await DB.get('argomenti',selection.topicId);check(session);
  if(!isTopicAvailable(topic))throw Error('L’argomento non è più disponibile. Scegline un altro nei compiti per casa.');
  const sources=await sourcesFor(topic);check(session);
  const descriptor=sources.find(s=>s.id===selection.sourceId&&s.kind===selection.sourceKind);
  if(!descriptor)throw Error('La fonte scelta non è più collegata a questo argomento. Scegli di nuovo il materiale.');
  let input;
  if(descriptor.kind==='quiz')input=await DB.get('materiali',descriptor.id);
  else{
   const page=selection.page??descriptor.page;
   if(descriptor.kind==='book'&&(!Number.isSafeInteger(page)||page<1))throw Error('Questa pagina precede le pagine disponibili del PDF. Controlla il numero nel libro.');
   input={...await loadMissionSource(DB,descriptor,{page}),topicId:topic.id};
   if(input.kind==='book'){
    const record=await DB.get('impostazioni','book-numbering-'+descriptor.id),anchor=record?.valore;
    if(record&&(!Number.isSafeInteger(anchor?.physical)||anchor.physical<1||!Number.isSafeInteger(anchor.printed)||anchor.printed<1))throw Error('Controlla prima i numeri di questo libro nel lettore.');
    if(record)input.label=`${input.title} · Pagina del libro ${input.page-anchor.physical+anchor.printed} (PDF ${input.page})`;
   }
  }
  const freshTopic=await DB.get('argomenti',topic.id);check(session);
  if(!isTopicAvailable(freshTopic)||canonical(freshTopic)!==canonical(topic))throw Error('L’argomento è cambiato durante la preparazione. Riaprilo prima di giocare.');
  pool=gameQuestionBank(input,freshTopic);sourceLabel=input.label||descriptor.title;
  normalized={topicId:topic.id,sourceId:descriptor.id,sourceKind:descriptor.kind,...(input.kind==='book'?{page:input.page}:{}),materia:topic.materia,title:topic.titolo};
 }
 check(session);
 if(historySession!==session){historySession=session;history.clear();}
 const key=JSON.stringify([normalized.topicId,normalized.sourceKind,normalized.sourceId,normalized.page||0]);
 const questions=selectGameQuestions(pool,{count,previousIds:[...(previousIds||[]),...(history.get(key)||[])]});history.set(key,questions.map(q=>q.id));
 return{questions,selection:normalized,availableCount:pool.length,sourceLabel};
}

export async function chooseGameQuestions({count=5,previousIds=[],selection=null,initialTopic=null}={}){
 const session=DB.session;check(session);
 if(selection)return prepare(selection,{count,previousIds,session});
 if(document.querySelector('.game-source-dialog[open]'))return null;
 const topics=(await DB.getAll('argomenti')).filter(isTopicAvailable);check(session);
 if(document.querySelector('.game-source-dialog[open]'))return null;
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='quiz-dialog game-source-dialog';dialog.setAttribute('aria-label','Scegli cosa ripassare');
  dialog.innerHTML=`<div class="dialog-form"><h2>Cosa stai studiando adesso?</h2><p>Scegli la materia e l’argomento preciso, per esempio quello della prossima verifica. Le domande useranno soltanto la fonte scelta.</p><label>Materia<select data-game-subject><option value="demo">Prova con le frazioni · demo</option>${[...new Set(topics.map(t=>t.materia))].sort().map(s=>`<option value="${h(s)}">${h(subjectName(s))}</option>`).join('')}</select></label><label data-game-topic-label hidden>Argomento<select data-game-topic></select></label><label data-game-source-label hidden>Libro, testo o quiz<select data-game-source></select></label><label data-game-page-label hidden><span data-page-label>Pagina PDF</span><input data-game-page type="number" min="1" step="1" inputmode="numeric"></label><p class="small-copy" data-game-source-note></p><p role="alert" class="form-error" data-game-picker-error></p><div class="dialog-actions"><button type="button" class="button secondary" data-game-picker-cancel>Annulla</button><button type="button" class="button primary" data-game-picker-start>Usa questo argomento</button></div></div>`;
  const q=s=>dialog.querySelector(s);let descriptors=[],anchor=null,epoch=0,answer=null,busy=false,sourceReady=false;
  const connected=()=>dialog.isConnected&&currentSession(session);
  const setBusy=value=>{busy=value;for(const e of dialog.querySelectorAll('select,input,[data-game-picker-start]'))e.disabled=value;};
  const error=e=>{if(connected())q('[data-game-picker-error]').textContent=e.message||'Non riesco a preparare le domande. Scegli un’altra fonte.';};
  async function updateSource(op=++epoch){
   setBusy(true);sourceReady=false;anchor=null;q('[data-game-page-label]').hidden=true;
   try{
   const descriptor=descriptors[Number(q('[data-game-source]').value)];
   if(descriptor?.kind==='book'){
    const record=await DB.get('impostazioni','book-numbering-'+descriptor.id);if(!connected()||op!==epoch)return;
    if(record){const a=record.valore;if(!Number.isSafeInteger(a?.physical)||a.physical<1||!Number.isSafeInteger(a.printed)||a.printed<1)throw Error('Controlla prima i numeri di questo libro nel lettore.');anchor=a;}
    q('[data-page-label]').textContent=anchor?'Pagina del libro':'Pagina PDF';q('[data-game-page]').value=anchor?Math.max(1,descriptor.page-anchor.physical+anchor.printed):descriptor.page;q('[data-game-page-label]').hidden=false;
   }
   q('[data-game-source-note]').textContent=descriptor?'A ogni giro scegliamo domande e opzioni diverse, nei limiti del materiale disponibile.':'Aggiungi un testo leggibile, collega un libro o salva un quiz in questo argomento.';
   sourceReady=Boolean(descriptor);q('[data-game-picker-start]').disabled=!sourceReady;
   }finally{if(connected()&&op===epoch){setBusy(false);q('[data-game-picker-start]').disabled=!sourceReady;}}
  }
  async function updateTopic(){
   const op=++epoch;setBusy(true);q('[data-game-picker-error]').textContent='';
   try{
    const topic=topics.find(t=>t.id===q('[data-game-topic]').value);descriptors=topic?await sourcesFor(topic):[];
    if(!connected()||op!==epoch)return;
    q('[data-game-source]').innerHTML=descriptors.map((s,i)=>`<option value="${i}">${h(s.title)} · ${s.kind==='book'?'Libro':s.kind==='quiz'?'Quiz':'Testo'}</option>`).join('');
    await updateSource(op);
   }catch(e){error(e);}finally{if(connected()&&op===epoch){setBusy(false);q('[data-game-picker-start]').disabled=!sourceReady;}}
  }
  async function updateSubject(){
   epoch++;q('[data-game-picker-error]').textContent='';const subject=q('[data-game-subject]').value,demo=subject==='demo';
   for(const name of ['topic','source'])q(`[data-game-${name}-label]`).hidden=demo;
   q('[data-game-page-label]').hidden=true;
   if(demo){descriptors=[];sourceReady=true;setBusy(false);q('[data-game-source-note]').textContent='Demo di matematica, non usa i tuoi libri. Le altre materie richiedono un argomento con un testo, un libro o un quiz.';return;}
   q('[data-game-topic]').innerHTML=topics.filter(t=>t.materia===subject).map(t=>`<option value="${h(t.id)}">${h(t.titolo)}</option>`).join('');
   if(initialTopic?.materia===subject&&topics.some(t=>t.id===initialTopic.id))q('[data-game-topic]').value=initialTopic.id;
   await updateTopic();
  }
  q('[data-game-subject]').onchange=()=>updateSubject().catch(error);q('[data-game-topic]').onchange=()=>updateTopic().catch(error);q('[data-game-source]').onchange=()=>updateSource().catch(error);
  q('[data-game-picker-cancel]').onclick=()=>dialog.close();
  q('[data-game-picker-start]').onclick=async()=>{
   if(busy)return;setBusy(true);q('[data-game-picker-error]').textContent='';
   try{
    let selected={topicId:'demo'};
    if(q('[data-game-subject]').value!=='demo'){
     const descriptor=descriptors[Number(q('[data-game-source]').value)];if(!descriptor)throw Error('Scegli un materiale di questo argomento.');
     selected={topicId:q('[data-game-topic]').value,sourceId:descriptor.id,sourceKind:descriptor.kind};
     if(descriptor.kind==='book'){const entered=Number(q('[data-game-page]').value);if(!Number.isSafeInteger(entered)||entered<1)throw Error('Scrivi un numero di pagina intero.');selected.page=anchor?entered+anchor.physical-anchor.printed:entered;if(selected.page<1)throw Error('Questa pagina precede le pagine disponibili del PDF. Controlla il numero nel libro.');}
    }
    const prepared=await prepare(selected,{count,previousIds,session});if(!connected())return;answer=prepared;dialog.close();
   }catch(e){error(e);}finally{if(connected())setBusy(false);}
  };
  dialog.addEventListener('close',()=>{epoch++;dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:game-closed'));resolve(answer);});
  document.body.append(dialog);dialog.showModal();if(initialTopic?.id)q('[data-game-subject]').value=initialTopic.materia;
  updateSubject().catch(error);
 });
}
