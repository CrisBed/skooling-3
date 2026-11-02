import {DB,DB_NAME,createId} from './db.js';
import {activeDatabaseName} from './students.js';
import {listMissionSources,loadMissionSource} from './source-mission-source.js';
import {buildAutomaticMap,restoreAutomaticMap} from './auto-map-model.js';
import {mapSVG,layoutMap} from './mind-map-model.js';
import {openMindMap} from './mind-map.js';
import {canonical} from './sync-model.js';

const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const withoutEditId=record=>{if(!record)return null;const{_editId,...value}=record;return value;};

// Automatic local extraction, not a provider call. The selected source is
// retained with the saved map so each branch remains traceable and reviewable.
export async function openAutomaticMap(topic,onSaved=async()=>{},material=null){
 if(document.querySelector('.auto-map-dialog[open]'))return;
 const context=structuredClone(topic),session=DB.session;
 let closed=false,epoch=0,sources=[],selected=0,anchor=null,generated=null,candidate=null,saved=null,saving=false,loading=false;
 const dialog=document.createElement('dialog');dialog.className='mind-map-dialog auto-map-dialog';dialog.setAttribute('aria-label','Mappa dai tuoi materiali');
 dialog.innerHTML=`<header class="map-header"><div><p class="eyebrow">DAI TUOI MATERIALI · ANCHE OFFLINE</p><h2 data-heading>Preparo la tua mappa</h2><p>${h(context.titolo)}</p></div><div class="button-row"><button type="button" class="button primary" data-save disabled>Salva mappa</button><button type="button" class="button secondary" data-edit hidden>Modifica la mappa</button><button type="button" class="button secondary" data-close>Chiudi</button></div></header><p role="status" data-status>Leggo i materiali di questo argomento…</p><p class="form-error" role="alert" data-error></p><details data-settings hidden><summary>Cambia fonte o pagina</summary><form class="dialog-form"><label>Da quale materiale?<select data-source></select></label><label data-page-label hidden>Pagina PDF<input data-page type="number" min="1" step="1" inputmode="numeric" required></label><p class="small-copy" data-page-note></p><button type="submit" class="button secondary" data-prepare>Prepara da questa fonte</button></form></details><div data-preview hidden><p class="small-copy">La preparazione locale raccoglie estratti nell’ordine del testo. Puoi modificare i rami: il brano di partenza resta qui per controllarli. Non è una spiegazione AI.</p><p data-coverage class="small-copy"></p><div class="map-layout"><div class="map-viewport" tabindex="0" aria-label="Mappa pronta: scorri per esplorare"><div data-canvas></div></div><aside class="map-inspector"><h3>Idea selezionata</h3><p data-quote></p><p class="small-copy" data-source-label></p><button type="button" class="button secondary" data-fit>Adatta la mappa</button></aside></div><details><summary>Rivedi tutto il brano</summary><p class="material-text" data-source-text></p></details></div><p class="small-copy">${DB.session?.temporary?'Sul computer questa mappa resta una prova temporanea. Per conservarla usa Invia all’iPad principale.':'La mappa salvata resta in questo argomento, anche senza Internet.'}</p>`;
 const q=selector=>dialog.querySelector(selector);
 function current(){try{return !closed&&dialog.isConnected&&DB.session===session&&activeDatabaseName()===DB_NAME;}catch{return false;}}
 function error(value){if(current())q('[data-error]').textContent=value.message||'Il materiale non è disponibile. Riprova.';}
 function controls(){
  q('[data-save]').disabled=saving||loading||!generated||Boolean(saved);
  q('[data-save]').hidden=Boolean(saved);
  q('[data-source]').disabled=saving||loading;q('[data-page]').disabled=saving||loading||sources[selected]?.kind!=='book';
  q('[data-prepare]').disabled=saving||loading;q('[data-close]').disabled=saving;
  q('[data-edit]').disabled=saving||loading;
 }
 function display(){
  if(!current()||!generated)return;
  q('[data-preview]').hidden=false;q('[data-heading]').textContent='La tua mappa è pronta';
  q('[data-canvas]').innerHTML=mapSVG(generated.map);
  const layout=layoutMap(generated.map),svg=q('[data-canvas] svg');
  const viewport=q('.map-viewport');
  const scale=Math.min(1,Math.max(.75,Math.min(viewport.clientWidth/layout.width,viewport.clientHeight/(layout.height+80))));
  svg.style.width=`${layout.width*scale}px`;svg.style.height=`${(layout.height+80)*scale}px`;
  const first=generated.map.nodes.find(node=>node.parent!==null);
  q('[data-quote]').textContent=first?.note||generated.source.text;
  q('[data-source-label]').textContent=generated.source.label;
  q('[data-source-text]').textContent=generated.source.text;
  q('[data-coverage]').textContent=generated.coverage.included<generated.coverage.available?`Ho raccolto i primi ${generated.coverage.included} estratti su ${generated.coverage.available}. Il brano completo resta qui sotto.`:`Ho raccolto ${generated.coverage.included} ${generated.coverage.included===1?'estratto':'estratti'} del materiale.`;
  const choose=id=>{const node=generated.map.nodes.find(node=>node.id===id);if(node)q('[data-quote]').textContent=node.note;};
  for(const node of q('[data-canvas]').querySelectorAll('[data-node]')){
   node.onclick=()=>choose(node.dataset.node);
   node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(node.dataset.node);}};
  }
  q('[data-status]').textContent=saved?'Mappa salvata. La ritrovi nei materiali di questo argomento.':'I rami sono già preparati. Premi Salva mappa per conservarli.';
 }
 async function chooseSource(){
  const operation=++epoch,item=sources[selected];anchor=null;
  if(!item||!current())return;
  q('[data-error]').textContent='';generated=null;candidate=null;saved=null;q('[data-preview]').hidden=true;q('[data-edit]').hidden=true;
  q('[data-page-label]').hidden=item.kind!=='book';
  q('[data-page-note]').textContent='';
  if(item.kind==='book'){
   const record=await DB.get('impostazioni','book-numbering-'+item.id);
   if(!current()||operation!==epoch)return;
   if(record!=null){
    const value=record.valore;
    if(!Number.isSafeInteger(value?.physical)||value.physical<1||!Number.isSafeInteger(value.printed)||value.printed<1)throw Error('La corrispondenza delle pagine salvata non è leggibile. Controllala nel lettore prima di preparare la mappa.');
    if(item.page-value.physical+value.printed>0)anchor={physical:value.physical,printed:value.printed};
   }
   // Keep the existing input node, its accessibility name and form constraint.
   q('[data-page-label]').firstChild.textContent=anchor?'Pagina del libro':'Pagina PDF';
   q('[data-page]').value=anchor?item.page-anchor.physical+anchor.printed:item.page;
   q('[data-page-note]').textContent=anchor?'Uso il numero stampato già memorizzato per questo libro.':'Il PDF conta anche copertina e indice. Per usare i numeri stampati allinea il libro nel lettore.';
  }
  controls();await prepare();
 }
 async function prepare(){
  if(!current()||saving)return;
  const item=sources[selected];if(!item)return;
  const operation=++epoch,generation=session?.generation;
  let page=item.page;
  if(item.kind==='book'){
   const entered=Number(q('[data-page]').value);
   if(!Number.isSafeInteger(entered)||entered<1)throw Error('Scrivi una pagina intera a partire da 1.');
   page=anchor?entered+anchor.physical-anchor.printed:entered;
   if(!Number.isSafeInteger(page)||page<1)throw Error('Questo numero non corrisponde a una pagina del PDF. Controlla il numero nel lettore.');
  }
  loading=true;q('[data-error]').textContent='';q('[data-status]').textContent='Leggo il brano e preparo i rami…';controls();
  try{
   const source=await loadMissionSource(DB,item,{page});
   if(!current()||operation!==epoch)return;
   if(session?.generation!==generation)throw Error('I materiali sono cambiati durante la preparazione. Riprova con la fonte aggiornata.');
   if(anchor&&item.kind==='book')source.label=`${source.title} · Pagina del libro ${page-anchor.physical+anchor.printed} (PDF ${page})`;
   const next=buildAutomaticMap({topic:context,source});
   generated=next;saved=null;q('[data-edit]').hidden=true;
   candidate={id:createId('mat'),argomento:context.id,titolo:context.titolo,tipo:'mappa',mappa:next.map,fonte:next.source.label,origineMappa:{versione:1,metodo:next.method,fonte:next.source,copertura:next.coverage},creatoIl:Date.now(),aggiornatoIl:Date.now()};
   display();
  }catch(err){if(current()&&operation===epoch){error(err);q('[data-status]').textContent=generated?'La mappa precedente è ancora visibile. Non è stata sostituita.':'Il materiale originale è conservato. Scegli un testo leggibile o un’altra pagina.';}}
  finally{if(current()&&operation===epoch){loading=false;controls();}}
 }
 async function save(){
  if(!current()||saving||loading||!candidate)return;
  const operation=epoch;loading=false;saving=true;q('[data-error]').textContent='';controls();
  try{
   const freshTopic=await DB.get('argomenti',context.id);
   if(!current()||operation!==epoch)return;
   if(!freshTopic||freshTopic.archived||freshTopic.archiviato)throw Error('Questo argomento non è più disponibile. La mappa resta visibile: copiala prima di chiudere.');
   const existing=await DB.get('materiali',candidate.id);
   if(!current()||operation!==epoch)return;
   if(existing&&canonical(withoutEditId(existing))!==canonical(candidate))throw Error('Questo materiale è cambiato. Non sovrascrivo la copia già presente.');
   if(!existing)await DB.saveMindMap(candidate,canonical(null));
   const readback=await DB.get('materiali',candidate.id);
   if(!current()||operation!==epoch)return;
   if(canonical(withoutEditId(readback))!==canonical(candidate))throw Error('Non riesco a confermare il salvataggio. La mappa resta visibile; riprova prima di chiudere.');
   saved=readback;q('[data-edit]').hidden=false;display();await onSaved();
  }catch(err){error(err);}
  finally{if(current()){saving=false;controls();}}
 }
 function close(){
  if(saving)return;
  if(generated&&!saved&&!confirm('La mappa non è ancora salvata. Chiudere senza conservarla?'))return;
  dialog.close();
 }
 function unload(event){if(saving||(generated&&!saved)){event.preventDefault();event.returnValue='';}}
 q('[data-close]').onclick=close;q('[data-save]').onclick=save;
 q('[data-edit]').onclick=()=>{if(!saved)return;const material=saved;dialog.close();openMindMap(context,material,onSaved);};
 q('[data-fit]').onclick=()=>{const svg=q('svg'),layout=layoutMap(generated.map),scale=Math.min(1,q('.map-viewport').clientWidth/layout.width);svg.style.width=`${layout.width*scale}px`;svg.style.height=`${(layout.height+80)*scale}px`;};
 q('[data-source]').onchange=()=>{selected=Number(q('[data-source]').value);chooseSource().catch(error);};
 q('form').onsubmit=event=>{event.preventDefault();prepare().catch(error);};
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{closed=true;epoch++;window.removeEventListener('beforeunload',unload);dialog.remove();document.dispatchEvent(new Event('skooling:map-closed'));});
 window.addEventListener('beforeunload',unload);document.body.append(dialog);dialog.showModal();
 try{
  if(material){generated=restoreAutomaticMap(material,context);saved=structuredClone(material);candidate=withoutEditId(saved);q('[data-edit]').hidden=false;display();controls();return;}
  const operation=++epoch;sources=await listMissionSources(DB,context);
  const materials=await DB.getAll('materiali');
  if(!current()||operation!==epoch)return;
  const dates=new Map(materials.map(row=>[row.id,Number(row.aggiornatoIl||row.creatoIl)||0]));
  sources.sort((a,b)=>(a.kind==='material'?0:1)-(b.kind==='material'?0:1)||(dates.get(b.id)||0)-(dates.get(a.id)||0));
  if(!sources.length){q('[data-heading]').textContent='Scegliamo il materiale';q('[data-status]').textContent='Per preparare la mappa collega un libro o aggiungi un testo a questo argomento. Le foto sono conservate, ma la calligrafia non viene ancora letta automaticamente.';return;}
  q('[data-settings]').hidden=false;
  q('[data-source]').innerHTML=sources.map((item,index)=>`<option value="${index}">${h(item.title)} · ${item.kind==='book'?'Libro':'Testo'}</option>`).join('');
  await chooseSource();
 }catch(err){error(err);q('[data-status]').textContent='I materiali sono conservati. Riapri la fonte per riprovare.';}
}
