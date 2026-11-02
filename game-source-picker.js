import {DB,DB_NAME} from './db.js';
import {activeDatabaseName} from './students.js';
import {MATERIE,idMateriaDaNome,libriDiMateria} from './orario.js';
import {isTopicAvailable} from './topic-trash-model.js';
import {listMissionSources,loadMissionSource} from './source-mission-source.js';
import {gameQuestionBank,demoGameQuestionBank,selectGameQuestions} from './study-game-model.js';
import {createGameBookSourceService,resolveGameBookRange} from './game-book-source.js';
import {physicalLabel} from './book-pages.js';
import {readGameAccess} from './game-access.js';
import {canonical} from './sync-model.js';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const subjectName=id=>id==='unassigned'?'Libri senza materia':MATERIE.find(m=>m.id===id)?.nome||id;
let historySession=null;const history=new Map(),normalCache=new Map();
function currentSession(session){return DB.session===session&&activeDatabaseName()===DB_NAME;}
function check(session){if(!currentSession(session))throw Error('Il profilo è cambiato. Riapri il gioco.');if(!readGameAccess().allowed)throw Error('È ora di scuola. Riapri il gioco con il permesso del papà.');}
const booksService=createGameBookSourceService(DB,{check:()=>check(DB.session)});
function caches(session){check(session);if(historySession!==session){historySession=session;history.clear();normalCache.clear();}}
async function sourcesFor(topic){
 const materials=(await DB.getAll('materiali')).filter(m=>m.argomento===topic.id&&m.archiviato!==true&&m.archived!==true);
 return [...materials.filter(m=>m.tipo==='quiz').map(m=>({kind:'quiz',id:m.id,title:m.titolo||'Quiz salvato',topicId:topic.id})),...await listMissionSources(DB,topic)];
}
export async function assertGameSelectionAvailable(selection){
 const session=DB.session;caches(session);if(selection?.topicId==='demo')return true;
 if(selection?.sourceKind==='book'&&selection.sourceRevision)return booksService.assertAvailable(selection);
 const stored=normalCache.get(selection?.sourceRevision);if(!stored)throw Error('Questa preparazione non è più disponibile. Scegli di nuovo cosa ripassare.');
 const topic=await DB.get('argomenti',selection.topicId);check(session);
 if(!isTopicAvailable(topic)||canonical(topic)!==stored.topicRevision)throw Error('L’argomento è cambiato o è nel cestino. Scegli di nuovo la fonte.');
 const material=await DB.get('materiali',selection.sourceId);check(session);
 if(!material||material.argomento!==topic.id||material.archiviato===true||material.archived===true||canonical(material)!==stored.materialRevision)throw Error('Il materiale è cambiato. Scegli di nuovo cosa ripassare.');return true;
}
async function prepare(selection,{count,previousIds=[],session,allowFewer=false}){
 caches(session);let pool,sourceLabel,normalized=selection;
 if(selection.topicId==='demo'){
  pool=demoGameQuestionBank();normalized={topicId:'demo',sourceId:'demo',sourceKind:'demo',materia:'matematica',title:'Frazioni · prova dimostrativa',rangeLabel:'Esercizi dimostrativi'};sourceLabel='Esercizi preparati sulle frazioni, separati dai tuoi libri.';
 }else if(selection.sourceKind==='book'){
  await assertGameSelectionAvailable(selection);pool=await booksService.bank(selection,{previousIds});sourceLabel=selection.rangeLabel||'Pagine del libro scelte';
 }else{
  if(selection.sourceRevision){await assertGameSelectionAvailable(selection);const saved=normalCache.get(selection.sourceRevision);pool=saved.pool;sourceLabel=saved.sourceLabel;}
  else{
   const topic=await DB.get('argomenti',selection.topicId);check(session);if(!isTopicAvailable(topic))throw Error('Scegli un argomento disponibile.');
   const sources=await sourcesFor(topic);check(session);const descriptor=sources.find(s=>s.id===selection.sourceId&&s.kind===selection.sourceKind);if(!descriptor||descriptor.kind==='book')throw Error('La fonte non è più collegata all’argomento. Scegli di nuovo il materiale.');
   const material=await DB.get('materiali',descriptor.id);check(session);const input=descriptor.kind==='quiz'?material:{...await loadMissionSource(DB,descriptor),topicId:topic.id};check(session);
   const fresh=await DB.get('argomenti',topic.id),freshMaterial=await DB.get('materiali',descriptor.id);check(session);
   if(!isTopicAvailable(fresh)||canonical(fresh)!==canonical(topic)||canonical(freshMaterial)!==canonical(material))throw Error('La fonte è cambiata durante la preparazione. Sceglila di nuovo.');
   pool=gameQuestionBank(input,fresh);sourceLabel=input.label||descriptor.title;
   const sourceRevision='material:'+crypto.randomUUID();normalized={topicId:topic.id,sourceId:descriptor.id,sourceKind:descriptor.kind,materia:topic.materia,title:topic.titolo,sourceRevision,rangeLabel:descriptor.title};
   normalCache.set(sourceRevision,{topicRevision:canonical(topic),materialRevision:canonical(material),pool,sourceLabel});while(normalCache.size>3)normalCache.delete(normalCache.keys().next().value);
  }
 }
 check(session);const key=JSON.stringify([normalized.topicId,normalized.sourceId,normalized.page||0,normalized.pageEnd||0,normalized.sourceRevision||'demo']);
 const questions=selectGameQuestions(pool,{count:allowFewer?Math.min(count,pool.length):count,previousIds:[...previousIds,...(history.get(key)||[])]});history.set(key,questions.map(q=>q.id));
 return{questions,selection:normalized,availableCount:pool.length,sourceLabel};
}
export async function chooseGameQuestions({count=5,previousIds=[],selection=null,initialTopic=null,initialMode=null,allowFewer=false}={}){
 const session=DB.session;caches(session);if(selection)return prepare(selection,{count,previousIds,session,allowFewer});
 if(document.querySelector('.game-source-dialog[open]'))return null;
 const [topicsRaw,booksRaw,linksRecord]=await Promise.all([DB.getAll('argomenti'),DB.getAll('libri'),DB.get('impostazioni','materie-libri')]);check(session);
 if(document.querySelector('.game-source-dialog[open]'))return null;
 const topics=topicsRaw.filter(isTopicAvailable),books=booksRaw.filter(book=>book.archiviato!==true&&book.archived!==true),links=linksRecord?.valore||{},bySubject=new Map();
 for(const materia of MATERIE){const listed=libriDiMateria(links,materia.id,books),ids=new Set(listed.map(book=>book.id));for(const book of books)if(idMateriaDaNome(book.materia)===materia.id)ids.add(book.id);if(ids.size)bySubject.set(materia.id,books.filter(book=>ids.has(book.id)));}
 const assigned=new Set([...bySubject.values()].flat().map(book=>book.id)),unassigned=books.filter(book=>!assigned.has(book.id));if(unassigned.length)bySubject.set('unassigned',unassigned);
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='quiz-dialog game-source-dialog';dialog.setAttribute('aria-label','Scegli cosa ripassare');
  dialog.innerHTML=`<div class="dialog-form game-source-form"><h2>Cosa vuoi ripassare?</h2><p>Usa i tuoi libri o un argomento salvato. Le domande vengono soltanto dalle fonti che scegli.</p><div class="button-row" role="group" aria-label="Scegli la fonte"><button type="button" class="button secondary" data-game-mode="books">Dai miei libri</button><button type="button" class="button secondary" data-game-mode="topics">Argomenti e quiz</button><button type="button" class="button secondary" data-game-mode="demo">Prova le frazioni</button></div><label data-game-subject-label>Materia<select data-game-subject></select></label><label data-game-book-label>Libro<select data-game-book></select></label><label data-game-topic-label hidden>Argomento<select data-game-topic></select></label><label data-game-source-label hidden>Testo, libro o quiz<select data-game-source></select></label><section data-game-range hidden><label>Quale parte?<select data-game-chapter><option value="pages">Scelgo le pagine</option></select></label><div class="game-page-range"><label><span data-game-from-label>Dalla pagina</span><input data-game-from type="text" inputmode="numeric" maxlength="80"></label><label><span data-game-to-label>Alla pagina</span><input data-game-to type="text" inputmode="numeric" maxlength="80"></label></div><p class="small-copy" data-game-number-note></p><p class="small-copy" data-game-chapter-note></p><button type="button" class="button secondary" data-game-first-part hidden>Usa le prime 80 pagine del capitolo</button></section><p class="small-copy" role="status" data-game-source-note></p><section data-game-partial hidden><h3>Alcune pagine non sono leggibili</h3><p data-game-partial-note></p><ul data-game-missing></ul><button type="button" class="button primary" data-game-picker-confirm-partial>Gioca con le pagine leggibili</button></section><p role="alert" class="form-error" data-game-picker-error></p><div class="dialog-actions"><button type="button" class="button secondary" data-game-picker-cancel>Annulla</button><button type="button" class="button primary" data-game-picker-start disabled>Gioca con queste pagine</button></div></div>`;
  const q=s=>dialog.querySelector(s);let mode=initialMode==='demo'?'demo':initialTopic?.id?'topics':'books',epoch=0,answer=null,busy=false,descriptors=[],bookHandle=null,bookId=null,bookTopic=null,abort=null,preparedBook=null,handleUsed=false,chapterRange=null,watch=null;
  const connected=()=>dialog.isConnected&&currentSession(session);
  const error=e=>{if(connected())q('[data-game-picker-error]').textContent=e.message||'Non riesco a preparare le domande. Scegli un’altra fonte.';};
  const ready=()=>mode==='demo'||mode==='books'?mode==='demo'||Boolean(bookHandle):Boolean(descriptors[Number(q('[data-game-source]').value)]&&(descriptors[Number(q('[data-game-source]').value)].kind!=='book'||bookHandle));
  function setBusy(value){busy=value;for(const control of dialog.querySelectorAll('select,input,[data-game-mode],[data-game-picker-start],[data-game-picker-confirm-partial]'))control.disabled=value;if(!value){q('[data-game-picker-start]').disabled=!ready()||Boolean(preparedBook?.unreadablePages.length);q('[data-game-picker-confirm-partial]').disabled=!preparedBook;}}
  function clearPrepared(){preparedBook=null;q('[data-game-partial]').hidden=true;q('[data-game-picker-start]').hidden=false;q('[data-game-picker-error]').textContent='';}
  function clearBook(){chapterRange=null;abort?.abort();bookHandle?.dispose().catch(()=>{});bookHandle=null;bookId=null;bookTopic=null;handleUsed=false;clearPrepared();q('[data-game-range]').hidden=true;q('[data-game-first-part]').hidden=true;}
  function guard(op){check(session);if(!connected()||op!==epoch)throw Error('Scelta annullata.');}
  function setChapterFields(chapter,first=chapter.first,last=chapter.last){chapterRange={first,last};const from=bookHandle.numbering.known?physicalLabel(first,bookHandle.numbering):String(first),to=bookHandle.numbering.known?physicalLabel(last,bookHandle.numbering):String(last);q('[data-game-from]').value=from||`PDF ${first} (senza numero stampato)`;q('[data-game-to]').value=to||`PDF ${last} (senza numero stampato)`;for(const input of dialog.querySelectorAll('[data-game-from],[data-game-to]'))input.readOnly=bookHandle.numbering.known&&(!from||!to);}
  function showBook(handle){
   const numbering=handle.numbering,initial=Math.max(1,Math.min(handle.total,Number(handle.book.ultimaPagina)||1));
   for(const input of dialog.querySelectorAll('[data-game-from],[data-game-to]'))input.readOnly=false;
   q('[data-game-range]').hidden=false;q('[data-game-chapter]').innerHTML='<option value="pages">Scelgo le pagine</option>'+handle.chapters.map(ch=>`<option value="${h(ch.id)}">${h('  '.repeat(ch.level)+ch.title)}</option>`).join('');
   const start=physicalLabel(initial,numbering)||Array.from({length:handle.total},(_,i)=>physicalLabel(i+1,numbering)).find(Boolean)||String(initial);q('[data-game-from]').value=start;q('[data-game-to]').value=start;
   q('[data-game-from-label]').textContent=numbering.known?'Dalla pagina del libro':'Dalla pagina PDF';q('[data-game-to-label]').textContent=numbering.known?'Alla pagina del libro':'Alla pagina PDF';
   q('[data-game-number-note]').textContent=numbering.known?'Uso i numeri del libro già riconosciuti o allineati.':'Qui i numeri indicano le pagine del file PDF, copertina compresa. Per i numeri stampati usa Allinea numeri nel lettore.';
   q('[data-game-chapter-note]').textContent=handle.chapters.length?'Puoi scegliere un capitolo dell’indice PDF oppure indicare le pagine. Massimo 80 pagine alla volta.':'Questo PDF non ha un indice interno utilizzabile. Indica le pagine da ripassare, fino a 80 alla volta.';
  }
  async function openBook(id,topic=null){
   const op=++epoch;clearBook();bookId=id;bookTopic=topic;abort=new AbortController();setBusy(true);q('[data-game-source-note]').textContent='Leggo indice e numeri del libro…';
   try{const handle=await booksService.open(id,{signal:abort.signal,guard:()=>guard(op),onProgress:progress=>{if(connected()&&op===epoch)q('[data-game-source-note]').textContent=`Preparo le domande: ${progress.done} di ${progress.total} pagine…`;}});guard(op);bookHandle=handle;showBook(handle);q('[data-game-source-note]').textContent='Scegli il capitolo o le pagine, poi premi Gioca.';}
   catch(e){if(connected()&&op===epoch)error(e);}finally{if(connected()&&op===epoch)setBusy(false);}
  }
  async function updateSource(){
   const descriptor=descriptors[Number(q('[data-game-source]').value)];clearBook();if(descriptor?.kind==='book'){await openBook(descriptor.id,topics.find(t=>t.id===q('[data-game-topic]').value));return;}
   q('[data-game-source-note]').textContent=descriptor?'Useremo soltanto il testo o il quiz salvato di questo argomento.':'Qui non ci sono fonti leggibili. Scegli un libro, aggiungi testo o salva un quiz nell’argomento.';setBusy(false);
  }
  async function updateTopic(){
   const op=++epoch;clearBook();setBusy(true);
   try{const topic=topics.find(t=>t.id===q('[data-game-topic]').value);descriptors=topic?await sourcesFor(topic):[];guard(op);q('[data-game-source]').innerHTML=descriptors.map((source,i)=>`<option value="${i}">${h(source.title)} · ${source.kind==='book'?'Libro':source.kind==='quiz'?'Quiz':'Testo'}</option>`).join('');await updateSource();}
   catch(e){if(connected()&&op===epoch)error(e);}finally{if(connected()&&op===epoch)setBusy(false);}
  }
  async function updateSubject(){
   epoch++;clearBook();const subject=q('[data-game-subject]').value;
   if(mode==='books'){
    const choices=bySubject.get(subject)||[];q('[data-game-book]').innerHTML='<option value="">Scegli il libro</option>'+choices.map(book=>`<option value="${h(book.id)}">${h(book.titolo||'Libro')}${book.blob instanceof Blob?'':' · PDF da aggiungere'}</option>`).join('');
    q('[data-game-source-note]').textContent=subject?(choices.length?'Scegli il libro di questa materia.':'Nessun libro collegato. Puoi sistemare Libri per materia dalla libreria.'):'Scegli la materia che stai studiando.';setBusy(false);
    if(choices.length===1){q('[data-game-book]').value=choices[0].id;await openBook(choices[0].id);}return;
   }
   q('[data-game-topic]').innerHTML=topics.filter(topic=>topic.materia===subject).map(topic=>`<option value="${h(topic.id)}">${h(topic.titolo)}</option>`).join('');if(initialTopic?.materia===subject&&topics.some(t=>t.id===initialTopic.id))q('[data-game-topic]').value=initialTopic.id;await updateTopic();
  }
  async function setMode(value){
   mode=value;epoch++;clearBook();descriptors=[];for(const button of dialog.querySelectorAll('[data-game-mode]')){button.setAttribute('aria-pressed',String(button.dataset.gameMode===mode));button.classList.toggle('primary',button.dataset.gameMode===mode);}
   q('[data-game-subject-label]').hidden=mode==='demo';q('[data-game-book-label]').hidden=mode!=='books';q('[data-game-topic-label]').hidden=mode!=='topics';q('[data-game-source-label]').hidden=mode!=='topics';q('[data-game-picker-start]').textContent=mode==='demo'?'Prova le frazioni':mode==='books'?'Gioca con queste pagine':'Gioca con questa fonte';
   if(mode==='demo'){q('[data-game-source-note]').textContent='Demo esplicita di matematica: esercizi preparati sulle frazioni, separati dai tuoi libri.';setBusy(false);return;}
   const subjects=mode==='books'?[...bySubject.keys()]:[...new Set(topics.map(topic=>topic.materia))];q('[data-game-subject]').innerHTML='<option value="">Scegli la materia</option>'+subjects.map(subject=>`<option value="${h(subject)}">${h(subjectName(subject))}</option>`).join('');
   if(mode==='topics'&&initialTopic)q('[data-game-subject]').value=initialTopic.materia;await updateSubject();
   if(!subjects.length)q('[data-game-source-note]').textContent=mode==='books'?'Non ci sono libri nel profilo. Aggiungili in Libreria, oppure scegli Argomenti e quiz.':'Non ci sono ancora argomenti salvati. Puoi scegliere direttamente un libro.';
  }
  async function finishBook(prepared,confirmed=false){
   if(prepared.unreadablePages.length&&!confirmed){preparedBook=prepared;q('[data-game-partial]').hidden=false;q('[data-game-picker-start]').hidden=true;q('[data-game-partial-note]').textContent=`Leggibili ${prepared.readablePages.length} pagine. Le altre non entreranno nel gioco: conferma solo se vuoi ripassare queste pagine leggibili.`;q('[data-game-missing]').innerHTML=prepared.unreadablePages.map(item=>`<li>Pagina ${h(item.label)}: ${h(item.reason)}</li>`).join('');return;}
   const selected={...prepared.selection,...(confirmed?{partialConfirmed:true,readablePages:[...prepared.readablePages]}:{})};answer=await prepare(selected,{count,previousIds,session,allowFewer});if(connected())dialog.close();
  }
  async function start(confirmed=false){
   if(busy)return;setBusy(true);q('[data-game-picker-error]').textContent='';const op=epoch;
   try{
    check(session);
    if(mode==='demo'){answer=await prepare({topicId:'demo'},{count,previousIds,session,allowFewer});guard(op);dialog.close();return;}
    const descriptor=mode==='topics'?descriptors[Number(q('[data-game-source]').value)]:null;
    if(mode==='books'||descriptor?.kind==='book'){
     if(confirmed&&preparedBook){await finishBook(preparedBook,true);return;}if(!bookHandle)throw Error('Scegli prima il libro.');
     const from=q('[data-game-from]').value,to=q('[data-game-to]').value,chapter=bookHandle.chapters.find(ch=>ch.id===q('[data-game-chapter]').value),id=bookId,topic=bookTopic;
     if(handleUsed){abort?.abort();abort=new AbortController();bookHandle=await booksService.open(id,{signal:abort.signal,guard:()=>guard(op),onProgress:progress=>{if(connected()&&op===epoch)q('[data-game-source-note]').textContent=`Preparo le domande: ${progress.done} di ${progress.total} pagine…`;}});guard(op);}
     const range=chapterRange?resolveGameBookRange({known:false,total:bookHandle.total},chapterRange.first,chapterRange.last):resolveGameBookRange(bookHandle.numbering,from,to);handleUsed=true;
     const prepared=await bookHandle.prepare({...range,materia:q('[data-game-subject]').value==='unassigned'?'Da scegliere':q('[data-game-subject]').value,chapterTitle:chapter?.title||'',topic});guard(op);preparedBook=prepared;await finishBook(prepared);return;
    }
    if(!descriptor)throw Error('Scegli un testo o un quiz dell’argomento.');answer=await prepare({topicId:q('[data-game-topic]').value,sourceId:descriptor.id,sourceKind:descriptor.kind},{count,previousIds,session,allowFewer});guard(op);dialog.close();
   }catch(e){if(connected())error(e);}finally{if(connected())setBusy(false);}
  }
  q('[data-game-subject]').onchange=()=>updateSubject().catch(error);q('[data-game-book]').onchange=()=>{const id=q('[data-game-book]').value;if(id)openBook(id).catch(error);else{epoch++;clearBook();setBusy(false);}};q('[data-game-topic]').onchange=()=>updateTopic().catch(error);q('[data-game-source]').onchange=()=>updateSource().catch(error);
  for(const button of dialog.querySelectorAll('[data-game-mode]'))button.onclick=()=>setMode(button.dataset.gameMode).catch(error);
  for(const input of dialog.querySelectorAll('[data-game-from],[data-game-to]'))input.oninput=()=>{chapterRange=null;clearPrepared();q('[data-game-chapter]').value='pages';q('[data-game-first-part]').hidden=true;setBusy(false);};
  q('[data-game-chapter]').onchange=()=>{clearPrepared();const ch=bookHandle?.chapters.find(item=>item.id===q('[data-game-chapter]').value);q('[data-game-first-part]').hidden=!ch||ch.last-ch.first+1<=80;if(ch){setChapterFields(ch);q('[data-game-chapter-note]').textContent=ch.last-ch.first+1>80?'Questo capitolo supera 80 pagine. Scegli esplicitamente una prima parte di massimo 80 pagine: non viene tagliato da solo.':'Capitolo selezionato dall’indice PDF. Le pagine senza numero stampato restano incluse; per scrivere altri numeri scegli Scelgo le pagine.';}else if(bookHandle){chapterRange=null;showBook(bookHandle);}setBusy(false);};
  q('[data-game-first-part]').onclick=()=>{const ch=bookHandle?.chapters.find(item=>item.id===q('[data-game-chapter]').value);if(!ch)return;clearPrepared();setChapterFields(ch,ch.first,ch.first+79);q('[data-game-chapter-note]').textContent='Hai scelto solo la prima parte di 80 pagine. Il resto del capitolo resta escluso da questo giro.';q('[data-game-first-part]').hidden=true;setBusy(false);};
  q('[data-game-picker-start]').onclick=()=>start();q('[data-game-picker-confirm-partial]').onclick=()=>start(true);q('[data-game-picker-cancel]').onclick=()=>dialog.close();
  dialog.addEventListener('close',async()=>{epoch++;abort?.abort();await bookHandle?.dispose().catch(()=>{});clearInterval(watch);dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:game-closed'));resolve(answer);});
  document.body.append(dialog);dialog.showModal();watch=setInterval(()=>{try{check(session);}catch{dialog.close();}},1000);setMode(mode).catch(error);
 });
}
