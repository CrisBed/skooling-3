import {DB,createId} from './db.js';
import {buildSourceMission,checkMissionAnswer,createSourceMissionStore,maskMissionQuote} from './source-mission-model.js';
import {listMissionSources,loadMissionSource} from './source-mission-source.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const action=(id,label,primary=false)=>`<button type="button" class="button ${primary?'primary':'secondary'}" data-mission-action="${id}">${label}</button>`;
let api={},topic=null,current=null,epoch=0,leaving=Promise.resolve(),pendingSaves=0;
const thoughts=new Map();

function controller(container,isCurrent,context){
 const store=createSourceMissionStore(DB,'source-mission-v1-'+context.id);
 let progress,sources=[],selected=0,screen='source',busy=false,work=Promise.resolve(),anchor=null,order=[],choiceEpoch=0,restoredThought=false;
 const find=s=>container.querySelector(s);
 const sessionNote=()=>DB.session?.temporary?'Prova temporanea su questo dispositivo. Per conservarla su Drive usa Invia all’iPad principale.':'Il percorso e il tuo pensiero restano salvati in questo profilo.';
 function shell(title,body){
  if(!isCurrent())return;
  container.dataset.inSession='true';
  const draft=thoughts.get(context.id);
  const recovery=draft&&!restoredThought?`<aside class="mission-card"><h2>Il tuo pensiero è ancora qui</h2><p>Non è ancora salvato. Copialo prima di chiudere o ripartire.</p><textarea id="mission-recovery" rows="4" readonly aria-label="Pensiero da recuperare">${h(draft.text)}</textarea>${action('copy-thought','Copia il mio pensiero')}</aside>`:restoredThought?'<p class="mission-hint">Ho ritrovato il pensiero che non era stato salvato. Riprendi il percorso per conservarlo.</p>':'';
  container.innerHTML=`<div class="source-mission"><header class="mission-heading"><p class="eyebrow">${h(context.materia)} · UN PASSO ALLA VOLTA</p><h1 tabindex="-1">${h(title)}</h1><p>${h(context.titolo)}</p></header>${recovery}${body}<footer class="mission-footer">${action('back','Torna ai tuoi materiali')}<p>${h(sessionNote())}</p></footer></div>`;
  container.querySelectorAll('[data-mission-action]').forEach(b=>b.onclick=()=>invoke(b.dataset.missionAction));
  container.querySelectorAll('[data-mission-book]').forEach(b=>b.onclick=()=>api.openBook(b.dataset.missionBook,Number(b.dataset.missionPage)).catch(error));
  find('h1')?.focus({preventScroll:true});
 }
 function error(err){
  if(!isCurrent())return;
  const value=find('#mission-reflection')?.value;
  if(value!==undefined)keepThought(value);
  restoredThought=false;
  shell('Ripartiamo dalla fonte',`<article class="mission-card"><p role="alert">${h(err.message||'Questo brano non è disponibile.')}</p><p>I materiali e i tentativi precedenti sono conservati.</p>${action('reload','Riapri il percorso',true)}${progress?.history.length?action('history','Rivedi i tuoi tentativi'):''}</article>`);
 }
 function keepThought(text){if(progress?.active&&text!==progress.active.reflection)thoughts.set(context.id,{runId:progress.active.id,text,base:progress.active.reflection});}
 async function write(next,nextScreen='session'){
  if(busy||!isCurrent())return;
  busy=true;container.dataset.missionBusy='true';
  container.querySelectorAll('button,input,select,textarea').forEach(n=>n.disabled=true);
  work=(async()=>{progress=await store.save(next);const draft=thoughts.get(context.id);if(draft&&[progress.active,...progress.history].some(s=>s?.id===draft.runId&&s.reflection===draft.text)){thoughts.delete(context.id);restoredThought=false;}screen=nextScreen;paint();})();
  try{await work;}catch(e){error(e);}finally{busy=false;delete container.dataset.missionBusy;}
 }
 const sourceView=mission=>`<details class="mission-source"><summary>Rivedi il brano e la fonte</summary><p class="mission-source-label">${h(mission.source.label)}</p><blockquote>${h(mission.source.text)}</blockquote><p class="mission-small">Brano conservato con questo tentativo. Per leggere un’altra versione scegli un nuovo brano.</p>${mission.source.kind==='book'?`<button type="button" class="button secondary" data-mission-book="${h(mission.source.id)}" data-mission-page="${mission.source.page}">Apri la pagina nel libro</button>`:''}</details>`;
 async function choose(){
  const choice=++choiceEpoch;
  screen='source';sources=await listMissionSources(DB,context);
  if(!isCurrent()||choice!==choiceEpoch)return;
  if(!sources.length){shell('Ci serve il primo indizio',`<article class="mission-card"><h2>Collega una fonte a questo argomento</h2><p>Puoi usare il libro oppure aggiungere un testo, un riassunto o una trascrizione nei materiali. Una foto o un link da soli non diventano una spiegazione inventata.</p>${action('back','Apri i materiali',true)}${progress.active?action('resume','Riprendi il brano salvato'):''}</article>`);return;}
  if(selected>=sources.length)selected=0;
  const item=sources[selected];anchor=null;
  if(item.kind==='book'){
   const saved=(await DB.get('impostazioni','book-numbering-'+item.id))?.valore;
   if(Number.isInteger(saved?.physical)&&saved.physical>0&&Number.isInteger(saved.printed)&&saved.printed>0&&item.page-saved.physical+saved.printed>0)anchor=saved;
  }
  if(!isCurrent()||choice!==choiceEpoch)return;
  const page=anchor?item.page-anchor.physical+anchor.printed:item.page;
  shell('Da quale indizio partiamo?',`<article class="mission-card"><p>Prendiamo un piccolo brano dai tuoi materiali. La missione si costruisce qui, anche senza Internet.</p><label>La fonte<select id="mission-source-choice">${sources.map((s,i)=>`<option value="${i}" ${i===selected?'selected':''}>${h(s.title)}${s.kind==='book'?' · Libro':' · Materiale'}</option>`).join('')}</select></label>${item.kind==='book'?`<label>${anchor?'Pagina del libro':'Pagina PDF'}<input id="mission-page" type="number" min="1" max="99999" value="${page}" required></label><p class="mission-small">${anchor?'Uso l’allineamento già salvato per questo libro.':'Il PDF può contare anche copertina e indice. Nel lettore puoi usare Allinea numeri per impostare il numero stampato.'}</p>`:''}<p id="mission-source-status" role="status" aria-live="polite"></p><div class="mission-actions">${action('prepare','Partiamo',true)}${progress.active?action('resume','Riprendi il brano salvato'):''}</div></article>`);
  find('#mission-source-choice').onchange=e=>{selected=Number(e.target.value);choose().catch(error);};
 }
 async function prepare(){
  if(busy||!isCurrent())return;
  const descriptor=sources[selected];let page=descriptor.page;
  if(descriptor.kind==='book'){
   const entered=Number(find('#mission-page').value);
   if(!Number.isInteger(entered)||entered<1){find('#mission-source-status').textContent='Scegli una pagina intera a partire da 1.';return;}
   page=anchor?entered+anchor.physical-anchor.printed:entered;
   if(page<1){find('#mission-source-status').textContent='Questo numero non corrisponde a una pagina del PDF. Controlla l’allineamento nel libro.';return;}
  }
  busy=true;container.dataset.missionBusy='true';
  container.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);
  find('#mission-source-status').textContent='Leggo il tuo brano. Tieni aperta questa pagina…';
  try{
   const source=await loadMissionSource(DB,descriptor,{page});
   if(!isCurrent())return;
   if(anchor)source.label=`${source.title} · Pagina del libro ${page-anchor.physical+anchor.printed} (PDF ${page})`;
   const mission=buildSourceMission({topic:context,source}),now=Date.now(),next=structuredClone(progress);
   if(next.active)next.history.push({...next.active,status:'paused',completedAt:now});
   next.active={id:createId('mission'),mission,step:0,answer:null,hints:false,reflection:'',updatedAt:now};
   busy=false;await write(next);
  }catch(e){error(e);}finally{busy=false;delete container.dataset.missionBusy;}
 }
 function paint(){
  if(!isCurrent())return;
  if(screen==='resume'){
   shell('Il tuo percorso ti aspetta',`<article class="mission-card"><p>Riprendi da <strong>${h(['Scopri','Prova','Raccontalo'][progress.active.step])}</strong>, con il brano che avevi scelto.</p><p class="mission-source-label">${h(progress.active.mission.source.label)}</p><div class="mission-actions">${action('resume','Riprendi da qui',true)}${action('choose','Scegli un nuovo brano')}</div>${progress.history.length?action('history','Rivedi i tuoi tentativi'):''}</article>`);return;
  }
  if(screen==='history'){
   shell('Le tue esplorazioni',`<article class="mission-card">${progress.history.slice().reverse().map(s=>`<section class="mission-past"><p class="mission-small">${new Date(s.completedAt).toLocaleDateString('it-IT')} · ${s.status==='completed'?'Concluso':'Interrotto'}</p><h2>${h(s.mission.title)}</h2><p class="mission-source-label">${h(s.mission.source.label)}</p>${s.reflection?`<blockquote>${h(s.reflection)}</blockquote>`:''}${sourceView(s.mission)}</section>`).join('')||'<p>Il primo percorso è pronto quando vuoi.</p>'}<div class="mission-actions">${progress.active?action('resume','Riprendi il percorso',true):''}${action('choose','Scegli un brano',!progress.active)}</div></article>`);return;
  }
  if(screen==='summary'){
   const saved=progress.history.at(-1);
   shell('Un indizio in più, una tua idea',`<article class="mission-card"><h2>${h(saved.mission.title)}</h2><p>Hai lavorato su un brano dei tuoi materiali. La tua spiegazione è un punto da cui ripartire, senza un voto automatico.</p>${saved.reflection?`<h3>Come lo racconteresti tu</h3><blockquote>${h(saved.reflection)}</blockquote>`:'<p>Potrai aggiungere la tua spiegazione in un prossimo tentativo.</p>'}${sourceView(saved.mission)}<div class="mission-actions">${action('choose','Un’altra esplorazione',true)}${action('history','Rivedi i tuoi tentativi')}</div></article>`);return;
  }
  const active=progress.active;
  if(!active){choose().catch(error);return;}
  const {mission,step}=active,challenge=mission.challenge;
  const top=`<ol class="mission-steps" aria-label="Il tuo percorso">${['Scopri','Prova','Raccontalo'].map((t,i)=>`<li ${i===step?'aria-current="step"':''}><span>${i+1}</span>${t}</li>`).join('')}</ol>`;
  if(step===0){
   shell(mission.theme.title,`${top}<article class="mission-card"><h2>${h(mission.theme.prompt)}</h2><p class="mission-aside">${h(mission.theme.aside)}</p><p class="mission-source-label">${h(mission.source.label)}</p><blockquote>${h(challenge.quote||mission.source.text)}</blockquote><div class="mission-actions">${action('try','Provo io',true)}${action('pause','Mi fermo qui')}</div>${sourceView(mission)}</article>`);return;
  }
  if(step===1){
   const result=active.answer!==null&&challenge.kind!=='observe'?checkMissionAnswer(mission,active.answer):null;
   const good=result?.kind==='correct';
   if(challenge.kind==='order'&&!order.length&&Array.isArray(active.answer))order=[...active.answer];
   const exercise=challenge.kind==='cloze'?`<blockquote>${h(maskMissionQuote(mission))}</blockquote><div class="mission-options" role="group" aria-label="Scegli la parola">${challenge.options.map((v,i)=>`<button type="button" class="button secondary ${active.answer===v?'selected':''}" data-word="${i}" aria-pressed="${active.answer===v}">${h(v)}</button>`).join('')}</div>`:challenge.kind==='order'?`<p class="mission-order-result" aria-live="polite">${h(order.map(i=>challenge.chunks[i]).join('')||'Tocca i pezzi nell’ordine che scegli.')}</p><div class="mission-options" role="group" aria-label="I pezzi della frase">${[2,0,1].map(i=>`<button type="button" class="button secondary" data-chunk="${i}" aria-pressed="${order.includes(i)}">${h(challenge.chunks[i])}</button>`).join('')}</div>${action('clear-order','Ricomincio la frase')}`:`<blockquote>${h(challenge.quote||mission.source.text)}</blockquote><p>Cerca un dettaglio che ti incuriosisce e uno che vorresti spiegare. Qui scegli tu gli indizi, senza correzione automatica.</p>`;
   shell('Metti alla prova l’indizio',`${top}<article class="mission-card"><h2>${h(challenge.prompt)}</h2>${exercise}<p id="mission-feedback" role="status" aria-live="polite">${h(result?.message||'')}</p>${active.hints?`<div class="mission-hint"><strong>Torniamo al brano</strong><p>${h(challenge.kind==='order'?challenge.chunks[0]:challenge.quote||mission.source.text)}</p></div>`:''}<div class="mission-actions">${good||challenge.kind==='observe'?action('reflect','Raccontalo',true):challenge.kind==='order'?action('check-order','Confronta con il brano',true):''}${!active.hints&&!good?action('hint','Un indizio'):''}${action('pause','Mi fermo qui')}</div>${sourceView(mission)}</article>`);
   container.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>setAnswer(challenge.options[Number(b.dataset.word)]));
   container.querySelectorAll('[data-chunk]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.chunk);order=order.includes(i)?order.filter(x=>x!==i):[...order,i];paint();});
   return;
  }
  shell('Raccontalo a modo tuo',`${top}<article class="mission-card"><h2>${h(mission.theme.reflection)}</h2><label>La mia idea<textarea id="mission-reflection" rows="5" maxlength="1600" placeholder="Basta una frase, o un esempio tuo…">${h(active.reflection)}</textarea></label><p class="mission-small">È un pensiero da rileggere insieme, senza correzione automatica.</p><p id="mission-feedback" role="status"></p><div class="mission-actions">${action('finish','Concludi e conserva',true)}${action('skip','Per ora salto')}${action('pause','Mi fermo qui')}</div>${sourceView(mission)}</article>`);
 }
 async function update(values){const next=structuredClone(progress);Object.assign(next.active,values,{updatedAt:Date.now()});await write(next);}
 function setAnswer(value){return update({answer:value});}
 async function invoke(name){
  if(busy||!isCurrent())return;
  try{
   if(name==='back'){await flush();api.navigate(context.id.startsWith('book:')?'libreria':'studio');return;}
   if(name==='copy-thought'){
    const draft=thoughts.get(context.id);if(!draft)return;
    try{await navigator.clipboard.writeText(draft.text);thoughts.delete(context.id);api.notify('Pensiero copiato. Puoi incollarlo in un posto sicuro.');find('#mission-recovery')?.closest('aside')?.remove();}catch{find('#mission-recovery')?.select();api.notify('Il pensiero è selezionato. Copialo prima di chiudere.');}return;
   }
   if(name==='reload'){await SourceMission.render(container);return;}
   if(name==='prepare'){await prepare();return;}
   if(name==='choose'){await flush();await choose();return;}
   if(name==='resume'){screen='session';order=[];paint();return;}
   if(name==='history'){screen='history';paint();return;}
   if(name==='try'){await update({step:1});return;}
   if(name==='hint'){await update({hints:true});return;}
   if(name==='clear-order'){order=[];await update({answer:null});return;}
   if(name==='check-order'){
    if(order.length!==3){find('#mission-feedback').textContent='Scegli tutti e tre i pezzi della frase.';return;}
    await setAnswer([...order]);return;
   }
   if(name==='reflect'){await update({step:2});return;}
   if(name==='pause'){await flush();screen='resume';paint();return;}
   if(name==='finish'||name==='skip'){
    const reflection=find('#mission-reflection').value.trim();
    if(name==='finish'&&!reflection){find('#mission-feedback').textContent='Scrivi una tua idea, oppure scegli Per ora salto.';return;}
    keepThought(reflection);const next=structuredClone(progress),now=Date.now();next.history.push({...next.active,reflection,updatedAt:now,status:'completed',completedAt:now});next.active=null;await write(next,'summary');
   }
  }catch(e){error(e);}
 }
 async function flush(){
  const reflection=find('#mission-reflection')?.value;
  await work;
  if(reflection!==undefined&&progress?.active?.step===2&&(reflection!==progress.active.reflection||restoredThought)){
   keepThought(reflection);
   const next=structuredClone(progress);next.active.reflection=reflection;next.active.updatedAt=Date.now();
   busy=true;try{progress=await store.save(next);thoughts.delete(context.id);restoredThought=false;}finally{busy=false;}
  }
 }
 return {
  get busy(){return busy;},
  async load(){try{progress=await store.load();const draft=thoughts.get(context.id);if(draft&&progress.active?.id===draft.runId&&progress.active.step===2&&progress.active.reflection===draft.base){progress.active.reflection=draft.text;restoredThought=true;}if(progress.active){screen='resume';paint();}else if(progress.history.length){screen='summary';paint();}else await choose();}catch(e){error(e);}},
  flush,
  dispose(){delete container.dataset.inSession;delete container.dataset.missionBusy;},
 };
}

export const SourceMission={
 init(options){api=options;window.addEventListener('beforeunload',event=>{if(thoughts.size){event.preventDefault();event.returnValue='';}});},
 open(value){if(!value?.id)throw Error('Scegli un argomento o un libro.');topic=structuredClone(value);api.navigate('missione');},
 isBusy(){return Boolean(current?.busy)||pendingSaves>0||thoughts.size>0;},
 inSession(){return Boolean(current&&document.querySelector('#missione.active'));},
 async render(container=document.querySelector('#missione')){
  pendingSaves++;
  try{
  const visit=++epoch,previous=current;current=null;previous?.dispose();
  await leaving;try{await previous?.flush();}catch(e){api.notify(e.message,true);}
  if(visit!==epoch)return;
  if(!topic){api.navigate('studio');return;}
  current=controller(container,()=>visit===epoch,structuredClone(topic));await current.load();
  }finally{pendingSaves--;}
 },
 leave(){
  ++epoch;const previous=current;current=null;previous?.dispose();
  if(previous){pendingSaves++;leaving=leaving.catch(()=>{}).then(()=>previous.flush()).catch(e=>api.notify(e.message,true)).finally(()=>pendingSaves--);}return leaving;
 },
};
