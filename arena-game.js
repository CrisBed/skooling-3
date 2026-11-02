import {DB,DB_NAME} from './db.js';
import {activeDatabaseName} from './students.js';
import {readGameAccess,ensureGameAccess} from './game-access.js';
import {chooseGameQuestions} from './game-source-picker.js';
import {isTopicAvailable} from './topic-trash-model.js';
import {createArenaProfileStore} from './arena-game-storage.js';
import {ARENA_CATALOG,ARENA_MISSIONS,newArenaProfile,validateArenaProfile,buyArenaItem,equipArenaItem,awardArenaAnswer,claimArenaMission,completeArenaActivity,arenaCompanionBonus,newArenaRun,applyArenaAnswer,restartArenaRun,lootQuestionCount,completeArenaSummary,damageArenaRun} from './arena-game-model.js';
import {h,avatarSVG,petSVG,itemSVG,newArenaWorld,arenaMapSVG,ARENA_BUILDINGS} from './arena-render.js';
import {cameraRelativeMove,joystickVector,advanceArenaJump} from './arena-controls.js';

const labels={skin:'Tute',pickaxe:'Picconi',pet:'Compagni',wrap:'Colorazioni'};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const itemName=id=>ARENA_CATALOG.find(v=>v.id===id)?.name||'';
let openingArena=false;

export async function openStudyArena(){
 if(openingArena||document.querySelector('.study-game-dialog[open],.island-arena-dialog[open],.game-source-dialog[open]'))return;
 const session=DB.session,focus=document.activeElement;
 let closed=false;
 const profileCurrent=()=>{try{return !closed&&DB.session===session&&activeDatabaseName()===DB_NAME;}catch{return false;}};
 let prepared;openingArena=true;
 try{if(!await ensureGameAccess()||!readGameAccess().allowed||document.querySelector('.study-game-dialog[open],.island-arena-dialog[open],.game-source-dialog[open]'))return;prepared=await chooseGameQuestions({count:2,previousIds:[]});}
 finally{openingArena=false;}
 if(!prepared||!profileCurrent()||!readGameAccess().allowed||document.querySelector('.study-game-dialog[open],.island-arena-dialog[open]'))return;
 let selection=prepared.selection,availableCount=prepared.availableCount,profile=newArenaProfile(),tab='Gioca',buildMode=true;
 let run=null,runId=null,world=null,quest=null,summaryOpen=false,paused=false,loading=false,saving=false,afterSave=null,accessLocked=false;
 let frame=null,lastTime=0,elapsed=0,lastDamage=0,watch=null,shotUntil=0,lastUsed=[],used=[],lastSummary='',aimTarget=null;
 let viewMode='3d',scene3D=null,sceneHost=null,sceneEpoch=0,sceneLoading=false,sceneNotice='',sceneFrames=0;
 let joystick={x:0,y:0},joystickPointer=null,lookPointer=null,sprintEnabled=false,jumpQueued=false,jumpState={height:0,velocity:0,grounded:true};
 const keys=new Set();
 const dialog=document.createElement('dialog');dialog.className='island-arena-dialog';dialog.setAttribute('aria-label','Isola delle Idee');
 dialog.innerHTML=`<header class="ia-header"><div><span class="ia-logo-mark" aria-hidden="true">I</span><h2>Isola delle Idee</h2></div><div><span class="ia-balance" data-ia-balance>0 crediti</span><button type="button" class="ia-close" aria-label="Chiudi Isola delle Idee" data-ia-action="close">×</button></div></header><nav class="ia-tabs" aria-label="Sezioni dell’isola">${['Gioca','Armadietto','Shop','Missioni','Crediti'].map(name=>`<button type="button" data-ia-tab="${name}">${name}</button>`).join('')}</nav><div class="ia-source"><span data-ia-source></span><button type="button" data-ia-action="source">Cambia argomento</button></div><main class="ia-content" data-ia-content></main><footer class="ia-footer"><p role="status" data-ia-status></p><p role="alert" data-ia-error></p><button type="button" class="ia-button" data-ia-action="retry" hidden>Riprova salvataggio</button><small>${session?.temporary?'Su questo computer le prove restano in questa apertura. Per conservarle usa l’invio all’iPad nelle Impostazioni.':'Il tuo armadietto e i crediti si salvano nell’archivio di Skooling su questo dispositivo.'}</small></footer>`;
 const q=s=>dialog.querySelector(s),store=createArenaProfileStore(DB,{createProfile:newArenaProfile,validateProfile:validateArenaProfile,isCurrent:profileCurrent});
 function status(text=''){if(!closed)q('[data-ia-status]').textContent=text;}
 function error(value){if(!closed)q('[data-ia-error]').textContent=value?.message||String(value||'');}
 function checkAccess(){
  if(closed)return false;
  if(!profileCurrent()){close(true);return false;}
  if(readGameAccess().allowed){if(accessLocked){accessLocked=false;render();}return true;}
  if(!accessLocked){accessLocked=true;stop();renderLocked();}return false;
 }
 function renderLocked(){
  detachScene();dialog.classList.remove('ia-immersive');
  q('.ia-tabs').hidden=true;q('.ia-source').hidden=true;q('[data-ia-balance]').textContent='Gioco in pausa';
  q('[data-ia-content]').innerHTML='<section class="ia-school-lock"><h1>Adesso sei a scuola.</h1><p>L’isola è in pausa. Il giro, la bozza del riassunto e gli eventuali salvataggi da riprovare restano qui.</p><p>Dal lunedì al venerdì, dalle 08:00 alle 15:00, serve il codice del papà.</p><button type="button" class="ia-button ia-primary" data-ia-action="unlock">Sblocca per oggi</button></section>';
  status('Per riprendere, chiedi il permesso del papà.');q('[data-ia-action="retry"]').hidden=true;
 }
 async function unlock(){if(await ensureGameAccess())checkAccess();}
 async function availableTopic(){
  if(!checkAccess())return false;if(selection.topicId==='demo')return true;
  const id=selection.topicId,fresh=await DB.get('argomenti',id);if(!checkAccess()||selection.topicId!==id)return false;
  if(!isTopicAvailable(fresh))throw Error('Questo argomento è stato spostato nel cestino. Le risposte nuove non vengono registrate. Scegli un altro argomento.');return true;
 }
 function stop(){cancelAnimationFrame(frame);frame=null;lastTime=0;keys.clear();joystick={x:0,y:0};joystickPointer=null;lookPointer=null;jumpQueued=false;}
 function detachScene(){sceneHost?.remove();}
 function disposeScene(){sceneEpoch++;sceneLoading=false;detachScene();try{scene3D?.dispose();}catch{}scene3D=null;sceneHost=null;sceneFrames=0;}
 function updateScene(dt=0){
  if(!scene3D||!sceneHost?.isConnected||!world||accessLocked)return;
  try{
   scene3D.update(world,profile,{dt,elapsed,shotUntil,paused:!canMove()});sceneFrames++;
   for(const node of [sceneHost]){node.dataset.iaPlayerX=world.player.x.toFixed(3);node.dataset.iaPlayerY=world.player.y.toFixed(3);node.dataset.iaCameraYaw=String(scene3D.getYaw());node.dataset.iaFrames=String(sceneFrames);node.dataset.iaJumpHeight=String(world.jumpHeight||0);node.setAttribute('data-ia-3d-state','ready');}
  }catch{fallback3D('Il 3D si è interrotto. Puoi continuare con la visuale dall’alto.');}
 }
 function fallback3D(message){
  if(closed)return;disposeScene();viewMode='2d';sceneNotice=message;render();
 }
 async function attachScene(){
  const slot=q('[data-ia-viewport]');if(!slot||viewMode!=='3d'||!run||accessLocked)return;
  if(!sceneHost){sceneHost=document.createElement('div');sceneHost.className='ia-scene-host';sceneHost.setAttribute('data-ia-scene-host','');sceneHost.setAttribute('data-ia-3d-state','loading');sceneHost.setAttribute('aria-label','Isola tridimensionale');}
  slot.prepend(sceneHost);
  if(scene3D){try{scene3D.resize();updateScene();}catch{fallback3D('Il 3D è stato sospeso. Puoi continuare nella visuale dall’alto.');}return;}
  if(sceneLoading)return;sceneLoading=true;const epoch=++sceneEpoch,currentRun=runId,host=sceneHost;
  try{
   const {createArenaScene3D}=await import('./arena-scene3d.js');
   if(!profileCurrent()||epoch!==sceneEpoch||runId!==currentRun||!run)return;
   const made=await createArenaScene3D(host,{onContextLost:()=>{if(epoch===sceneEpoch)fallback3D('Il dispositivo ha sospeso il 3D. La partita continua nella visuale dall’alto.');}});
   if(!profileCurrent()||epoch!==sceneEpoch||runId!==currentRun||!run){made.dispose();return;}
   scene3D=made;sceneLoading=false;sceneNotice='';
   if(viewMode==='3d'&&tab==='Gioca'&&!accessLocked){q('[data-ia-viewport]')?.prepend(host);scene3D.resize();updateScene();q('[data-ia-scene-loading]')?.remove();animate();}
  }catch{if(epoch===sceneEpoch)fallback3D('Il 3D non è disponibile su questo dispositivo. Puoi giocare con la visuale dall’alto e riprovare il 3D quando vuoi.');}
  finally{if(epoch===sceneEpoch)sceneLoading=false;}
 }
 function close(force=false){
  if(closed)return;
  if(!force&&(saving||store.hasPending)){error('Prima di chiudere, attendi il salvataggio o premi Riprova salvataggio.');return;}
  if(!force&&lastSummary.trim()&&!confirm('Il riassunto non è ancora salvato. Chiudere e lasciare questa bozza? Per conservarlo torna al medikit e conferma.'))return;
  closed=true;stop();disposeScene();clearInterval(watch);
  window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);window.removeEventListener('focus',checkAccess);window.removeEventListener('storage',checkAccess);
  document.removeEventListener('visibilitychange',visibility);document.removeEventListener('skooling:game-access-changed',checkAccess);
  window.removeEventListener('resize',resizeScene);
  dialog.close();dialog.remove();if(focus?.isConnected)focus.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:game-closed'));
 }
 function refreshLocks(){
  for(const button of dialog.querySelectorAll('button[data-ia-action],[data-ia-answer],[data-ia-tab]')){
   if(['close','retry','unlock'].includes(button.dataset.iaAction))continue;
   if(saving||store.hasPending||loading||accessLocked){if(!button.disabled)button.dataset.iaSaveLocked='true';button.disabled=true;}
   else if(button.dataset.iaSaveLocked){button.disabled=false;delete button.dataset.iaSaveLocked;}
  }
  for(const control of dialog.querySelectorAll('[data-ia-summary-form] input,[data-ia-summary-form] textarea,[data-ia-summary-form] button')){
   if(saving||store.hasPending||loading||accessLocked){if(!control.disabled)control.dataset.iaSaveLocked='true';control.disabled=true;}
   else if(control.dataset.iaSaveLocked){control.disabled=false;delete control.dataset.iaSaveLocked;}
  }
  q('[data-ia-action="retry"]').hidden=accessLocked||!store.hasPending;q('[data-ia-action="retry"]').disabled=saving;
 }
 async function transact(mutate,done){
  if(!checkAccess()||saving||store.hasPending)return;
  saving=true;afterSave=done;error('');refreshLocks();
  try{profile=await store.commit(mutate);if(!profileCurrent())return;const complete=afterSave;afterSave=null;status('Salvato nel tuo spazio di Skooling.');complete?.();}
  catch(e){error(e);if(!store.hasPending){afterSave=null;try{profile=await store.load();}catch{}}}
  finally{saving=false;if(!closed){render();refreshLocks();}}
 }
 async function retry(){
  if(!checkAccess()||saving)return;saving=true;refreshLocks();
  try{profile=await store.retry();if(!profileCurrent())return;const complete=afterSave;afterSave=null;complete?.();status('Salvataggio verificato. Puoi continuare.');}
  catch(e){error(e);if(!store.hasPending){afterSave=null;try{profile=await store.load();}catch{}}}finally{saving=false;if(!closed){render();refreshLocks();}}
 }
 function render(){
  if(!checkAccess()){if(accessLocked)renderLocked();return;}stop();detachScene();q('.ia-tabs').hidden=false;q('.ia-source').hidden=false;
  dialog.classList.toggle('ia-immersive',tab==='Gioca'&&Boolean(run)&&viewMode==='3d');
  q('[data-ia-balance]').textContent=`${profile.credits} crediti`;
  q('[data-ia-source]').textContent=`${selection.materia} · ${selection.title}`;
  for(const button of dialog.querySelectorAll('[data-ia-tab]')){button.classList.toggle('selected',button.dataset.iaTab===tab);button.setAttribute('aria-current',button.dataset.iaTab===tab?'page':'false');}
  q('[data-ia-content]').innerHTML=tab==='Gioca'?(run?matchHTML():lobbyHTML()):tab==='Armadietto'?lockerHTML():tab==='Shop'?shopHTML():tab==='Missioni'?missionsHTML():creditsHTML();
  refreshLocks();
  if(tab==='Gioca'&&run){bindMap();paintActors();if(viewMode==='3d')attachScene();if(!quest&&!summaryOpen&&!paused&&run.phase==='active')animate();}
 }
 function lobbyHTML(){
  const guide=viewMode==='3d'?'<li>Tablet: muoviti con il joystick a sinistra e guarda trascinando a destra. Computer: WASD o frecce, trascina per guardare.</li><li>Avvicinati a una cassa o a un’auto e premi Interagisci. Salta con il pulsante o Spazio; Corri oppure Shift per accelerare.</li><li>Mira un robot e premi Colpisci oppure F. Le domande fermano il gioco: rispondi con calma.</li>':'<li>Tocca un punto della mappa per camminare, oppure usa WASD e frecce.</li><li>Avvicinati a una cassa o a un’auto e premi Interagisci.</li><li>Tocca un robot per mirare e premi Colpisci. Le domande fermano il gioco: rispondi con calma.</li>';
  const friend='<div class="ia-friend-slot"><span aria-hidden="true">＋</span><strong>Amico</strong><small>Online prossimamente</small></div>';
  return `<section class="ia-lobby"><div class="ia-lobby-heading"><h1>La tua prossima scoperta.</h1><p>Esplora l’isola. Apri rifornimenti, incontra i robot e ripassa l’argomento che hai scelto.</p></div><div class="ia-party"><div>${friend}</div><div class="ia-hero-character">${avatarSVG(profile)}${profile.equipped.pet!=='pet-nessuno'?`<div class="ia-lobby-pet">${petSVG(profile.equipped.pet)}</div>`:''}<strong>${h(itemName(profile.equipped.skin))}</strong></div><div class="ia-two-friends">${friend}${friend}</div></div><div class="ia-mode" role="group" aria-label="Modalità costruzione"><button type="button" data-ia-action="build-on" class="${buildMode?'selected':''}" aria-pressed="${buildMode}">Costruisci</button><button type="button" data-ia-action="build-off" class="${!buildMode?'selected':''}" aria-pressed="${!buildMode}">Non costruire</button></div><p class="ia-mode-copy">${buildMode?'Puoi creare ripari per fermare i colpi dei robot.':'Esplora e usa i ripari già presenti sulla mappa.'} ${availableCount} domande disponibili nella fonte scelta.</p><div class="ia-view-choice" role="group" aria-label="Scegli la visuale"><button type="button" class="ia-button ${viewMode==='3d'?'selected':''}" data-ia-action="view-3d" aria-pressed="${viewMode==='3d'}">Esplora in 3D</button><button type="button" class="ia-button ${viewMode==='2d'?'selected':''}" data-ia-action="view-2d" aria-pressed="${viewMode==='2d'}">Visuale dall’alto</button></div><button type="button" class="ia-button ia-primary ia-start" data-ia-action="start">Parti per l’isola</button><div class="ia-how"><h3>Tre mosse per cominciare</h3><ol>${guide}</ol><p>Si gioca da soli. Gli amici online arriveranno in futuro.</p></div></section>`;
 }
 function lockerHTML(){return `<section class="ia-collection"><h1>Il tuo armadietto</h1><p>Scegli quello che vuoi indossare. I compagni aiutano il medikit, senza saltare domande.</p>${Object.entries(labels).map(([type,label])=>`<h2>${label}</h2><div class="ia-item-grid">${ARENA_CATALOG.filter(v=>v.type===type&&profile.owned.includes(v.id)).map(item=>`<article class="ia-item-card">${itemSVG(item,profile)}<h3>${h(item.name)}</h3><p>${h(item.description)}</p><button type="button" class="ia-button" data-ia-action="equip" data-item="${item.id}" ${profile.equipped[type]===item.id?'disabled':''}>${profile.equipped[type]===item.id?'Indossato':'Indossa'}</button></article>`).join('')}</div>`).join('')}</section>`;}
 function shopHTML(){return `<section class="ia-collection"><h1>Lo shop dell’isola</h1><p>Solo crediti del gioco. Una risposta corretta vale 5 crediti, una volta per domanda in ogni giro. Non si usa denaro vero.</p><div class="ia-item-grid">${ARENA_CATALOG.filter(v=>!v.base&&!v.reward).map(item=>`<article class="ia-item-card">${itemSVG(item,profile)}<h3>${h(item.name)}</h3><p>${h(item.description)}</p><strong>${item.cost} crediti</strong><button type="button" class="ia-button" data-ia-action="buy" data-item="${item.id}" ${profile.owned.includes(item.id)||profile.credits<item.cost?'disabled':''}>${profile.owned.includes(item.id)?'Nel tuo armadietto':profile.credits<item.cost?'Servono altri crediti':'Prendi con i crediti'}</button></article>`).join('')}</div></section>`;}
 function missionsHTML(){return `<section class="ia-collection"><h1>Le tue missioni</h1><p>Ogni obiettivo completato ti regala un oggetto originale per l’armadietto.</p><div class="ia-mission-list">${ARENA_MISSIONS.map(m=>`<article class="ia-mission"><div>${itemSVG(ARENA_CATALOG.find(v=>v.id===m.rewardId),profile)}</div><section><h2>${h(m.name)}</h2><p>${h(m.description)}</p><progress max="${m.target}" value="${Math.min(m.target,profile.stats[m.stat])}"></progress><p>${Math.min(m.target,profile.stats[m.stat])} / ${m.target} · Regalo: ${h(itemName(m.rewardId))}</p><button type="button" class="ia-button" data-ia-action="claim" data-mission="${m.id}" ${profile.missions[m.id]||profile.stats[m.stat]<m.target?'disabled':''}>${profile.missions[m.id]?'Regalo ricevuto':profile.stats[m.stat]>=m.target?'Ricevi il regalo':'Missione in corso'}</button></section></article>`).join('')}</div></section>`;}
 function creditsHTML(){const summaries=Object.values(profile.receipts.activities).filter(r=>r.kind==='summary');return `<section class="ia-credit-page"><h1>I tuoi crediti</h1><strong class="ia-credit-number">${profile.credits}</strong><p>Crediti virtuali da usare solo nello shop dell’isola. Nessun pagamento, abbonamento o acquisto con denaro vero.</p><dl><div><dt>Risposte corrette</dt><dd>${profile.stats.correct}</dd></div><div><dt>Robot completati</dt><dd>${profile.stats.robots}</dd></div><div><dt>Rifornimenti aperti</dt><dd>${profile.stats.loot}</dd></div><div><dt>Riassunti scritti</dt><dd>${profile.stats.summaries}</dd></div></dl><p>I crediti arrivano dalle risposte corrette. Ripremere la stessa risposta o riprovare un salvataggio non li raddoppia.</p>${summaries.length?`<h2>Riassunti conservati</h2>${summaries.map((s,i)=>`<details><summary>Riassunto ${i+1}</summary><blockquote>${h(s.text)}</blockquote></details>`).join('')}`:''}</section>`;}
 function matchHTML(){
  const nearby=nearestInteraction(),fuel=world.driving?world.cars.find(c=>c.id===world.driving)?.fuel:0,threeD=viewMode==='3d';
  const overlay=quest?questionHTML():summaryOpen?summaryHTML():run.phase==='rest'?'<div class="ia-pause-card"><h2>Un momento di riposo</h2><p>Hai esaurito l’energia. Crediti e oggetti guadagnati restano tuoi.</p><button type="button" class="ia-button ia-primary" data-ia-action="restart">Riparti con energia nuova</button></div>':paused?'<div class="ia-pause-card"><h2>Isola in pausa</h2><button type="button" class="ia-button ia-primary" data-ia-action="resume">Riprendi</button></div>':'';
  const controls=threeD?`<div class="ia-touch-controls"><div class="ia-joystick" data-ia-joystick role="group" aria-label="Joystick per muoverti"><span class="ia-stick-ring"></span><span data-ia-stick-thumb></span><small>Muoviti</small></div><div class="ia-action-pad"><button type="button" class="ia-button ${sprintEnabled?'selected':''}" data-ia-action="run" aria-pressed="${sprintEnabled}">Corri</button><button type="button" class="ia-button" data-ia-action="jump">Salta</button><button type="button" class="ia-button ia-primary" data-ia-action="interact" data-ia-interact>${h(nearby?.label||'Interagisci')}</button><button type="button" class="ia-button ia-primary" data-ia-action="fire">Colpisci</button>${buildMode?'<button type="button" class="ia-button" data-ia-action="build">Riparo</button>':''}<button type="button" class="ia-button" data-ia-action="summary">Medikit</button></div></div>`:`<div class="ia-match-tools"><div class="ia-dpad" aria-label="Cammina sulla mappa"><button type="button" data-ia-move="up" aria-label="Vai su">↑</button><button type="button" data-ia-move="left" aria-label="Vai a sinistra">←</button><button type="button" data-ia-move="down" aria-label="Vai giù">↓</button><button type="button" data-ia-move="right" aria-label="Vai a destra">→</button></div><button type="button" class="ia-button ia-primary" data-ia-action="interact" data-ia-interact>${h(nearby?.label||'Interagisci')}</button><button type="button" class="ia-button" data-ia-action="fire">Colpisci</button>${buildMode?'<button type="button" class="ia-button" data-ia-action="build">Riparo</button>':''}<button type="button" class="ia-button" data-ia-action="summary">Medikit</button></div>`;
  return `<section class="ia-match ${threeD?'ia-match-3d':''}">${sceneNotice?`<p class="ia-scene-notice" role="status">${h(sceneNotice)}</p>`:''}<div class="ia-hud"><div><span>Energia</span><meter min="0" max="100" value="${run.health}"></meter><strong data-ia-health>${run.health}</strong></div><div class="ia-weapon-hud"><strong>${h(world.weapon)}</strong></div>${world.driving?`<div><span>Carburante</span><strong data-ia-fuel>${Math.round(fuel)}%</strong></div>`:''}<button type="button" class="ia-button" data-ia-action="${threeD?'view-2d':'view-3d'}">${threeD?'Visuale dall’alto':'Torna al 3D'}</button><button type="button" class="ia-button" data-ia-action="pause">${paused?'Riprendi':'Pausa'}</button><button type="button" class="ia-button" data-ia-action="lobby">Lobby</button></div><div class="ia-map-wrap ${threeD?'ia-viewport-3d':''}" data-ia-viewport ${!threeD?'data-ia-3d-state="fallback"':''} tabindex="0" aria-label="${threeD?'Esplora l’isola in tre dimensioni':'Mappa dall’alto'}">${threeD?`${!scene3D?'<p class="ia-scene-loading" data-ia-scene-loading>Preparo l’isola in 3D…</p>':''}<div class="ia-look-pad" data-ia-look aria-label="Trascina qui per guardarti intorno"></div><span class="ia-crosshair" aria-hidden="true"></span>${!overlay?controls:''}`:arenaMapSVG(world,profile)}${overlay}</div>${threeD?'':controls}<p class="ia-control-help">${threeD?'Joystick a sinistra, camera a destra. WASD o frecce per muoverti, Shift per correre, Spazio per saltare, E per interagire, F per colpire.':'Tocca la mappa per camminare. Frecce o WASD, E per interagire, Spazio o F per colpire. Per mirare tocca un robot vicino.'}</p></section>`;
 }
 function questionHTML(){
  const question=quest.questions[quest.index];return `<article class="ia-question" data-ia-question><span>${quest.kind==='loot'?`${h(quest.item.rarity)} · apri il rifornimento`:'Incontro con il robot'} · ${quest.index+1} di ${quest.questions.length}</span><h2 tabindex="-1">${h(question.prompt)}</h2><div class="ia-answers">${question.options.map((option,i)=>`<button type="button" data-ia-answer="${i}" ${quest.correct?'disabled':''} class="${quest.correct&&i===question.correct?'correct':''}">${h(option)}</button>`).join('')}</div><p role="status">${h(quest.feedback||'L’isola è ferma. Hai tutto il tempo per pensare.')}</p><details ${quest.feedback&&!quest.correct?'open':''}><summary>Fonte e indizio</summary>${question.quote?`<blockquote>${h(question.quote)}</blockquote>`:''}<p>${h(question.sourceLabel)}</p></details>${quest.correct?'<button type="button" class="ia-button ia-primary" data-ia-action="next">Continua</button>':''}<button type="button" class="ia-button" data-ia-action="cancel-quest">Torna alla mappa</button></article>`;
 }
 function summaryHTML(){return `<article class="ia-question ia-summary"><h2>Il medikit delle idee</h2><p>Riassumi quello che hai studiato in almeno 10 parole. Rileggi e conferma: non c’è una valutazione AI.</p><p>Fonte scelta: ${h(selection.materia)} · ${h(selection.title)}. Recuperi 50 energie${arenaCompanionBonus(profile)?' più 10 grazie al compagno':''}.</p><form data-ia-summary-form><label>Il tuo piccolo riassunto<textarea data-ia-summary rows="4" maxlength="10000" required>${h(lastSummary)}</textarea></label><label class="ia-confirm"><input type="checkbox" data-ia-summary-confirm required> Ho riletto il riassunto e confermo che racconta quello che ho studiato.</label><button type="submit" class="ia-button ia-primary">Conferma e usa il medikit</button></form><button type="button" class="ia-button" data-ia-action="cancel-summary">Torna alla mappa</button></article>`;}
 async function start(){
  if(!checkAccess()||loading)return;loading=true;refreshLocks();
  try{const source=await chooseGameQuestions({count:2,previousIds:used.length?used:lastUsed,selection});if(!source||!checkAccess())return;selection=source.selection;availableCount=source.availableCount;lastUsed=used;used=[];disposeScene();jumpState={height:0,velocity:0,grounded:true};sprintEnabled=false;run=newArenaRun({buildMode});runId=crypto.randomUUID();world=newArenaWorld();world.player.angle=-Math.PI/2;world.jumpHeight=0;quest=null;summaryOpen=false;paused=false;elapsed=0;lastDamage=0;aimTarget=null;tab='Gioca';error('');status('Avvicinati alla cassa verde davanti a te per iniziare.');}
  catch(e){error(e);}finally{loading=false;render();if(run&&tab==='Gioca'&&!quest&&!summaryOpen)dialog.scrollTo(0,0);}
 }
 async function changeSource(){
  if(!checkAccess()||loading)return;if((run||lastSummary.trim())&&!confirm(`Cambiare argomento e tornare alla lobby? Crediti, oggetti e riassunti già salvati restano tuoi.${lastSummary.trim()?' La bozza non salvata appartiene all’argomento attuale e non verrà conservata. Per salvarla, annulla e conferma il medikit.':''}`))return;
  loading=true;stop();refreshLocks();try{const source=await chooseGameQuestions({count:2,previousIds:[]});if(source&&checkAccess()){selection=source.selection;availableCount=source.availableCount;disposeScene();run=null;quest=null;summaryOpen=false;lastSummary='';tab='Gioca';used=[];lastUsed=[];}}catch(e){error(e);}finally{loading=false;render();}
 }
 async function beginQuest(kind,item){
  if(!checkAccess()||loading||quest||summaryOpen||paused||run?.phase!=='active')return;
  const count=kind==='robot'?2:lootQuestionCount(item.rarity);loading=true;stop();refreshLocks();
  try{const result=await chooseGameQuestions({count,previousIds:[...lastUsed,...used],selection});if(!result||!checkAccess())return;
   quest={kind,item,questions:result.questions,index:0,solved:[],correct:false,feedback:''};selection=result.selection;availableCount=result.availableCount;world.destination=null;error('');
  }catch(e){error(e);}finally{loading=false;render();q('[data-ia-question] h2')?.focus({preventScroll:true});}
 }
 async function respond(answer){
  if(!checkAccess()||!quest||quest.correct||saving||store.hasPending||loading)return;const current=quest,question=current.questions[current.index];
  loading=true;refreshLocks();
  try{
   if(!await availableTopic()||quest!==current)return;
   if(answer!==question.correct){run=applyArenaAnswer(run,false);current.feedback=`Riprova. ${question.explanation||'Leggi la fonte e cerca l’idea della domanda.'}`;if(run.phase==='rest')quest=null;return;}
   await transact(p=>awardArenaAnswer(p,{runId,questionId:question.id,correct:true}),()=>{if(quest!==current)return;run=applyArenaAnswer(run,true);current.solved.push(question.id);used.push(question.id);current.correct=true;current.feedback=`Risposta corretta. ${question.explanation||'Puoi continuare.'}`;});
  }catch(e){quest=null;error(e);}finally{loading=false;render();}
 }
 async function nextQuestion(){
  if(!checkAccess()||!quest?.correct||loading)return;
  if(quest.index+1<quest.questions.length){quest.index++;quest.correct=false;quest.feedback='';render();q('[data-ia-question] h2')?.focus({preventScroll:true});return;}
  const current=quest;loading=true;refreshLocks();try{if(!await availableTopic()||quest!==current)return;await transact(p=>completeArenaActivity(p,{runId,activityId:current.item.id,kind:current.kind,questionIds:current.solved,rarity:current.item.rarity}),()=>{
   if(current.kind==='loot'){current.item.opened=true;world.weapon=`${current.item.name} · ${current.item.rarity}`;}else current.item.alive=false;
   quest=null;status(current.kind==='loot'?'Rifornimento aperto: hai un nuovo strumento.':'Incontro completato. Il robot si riposa.');
  });}catch(e){quest=null;error(e);}finally{loading=false;render();}
 }
 async function saveSummary(form){
  if(!checkAccess()||saving||store.hasPending||loading||run?.phase!=='active')return;
  const text=form.querySelector('[data-ia-summary]').value,confirmed=form.querySelector('[data-ia-summary-confirm]').checked;
  let next;try{next=completeArenaSummary(run,text,{confirmed,bonus:arenaCompanionBonus(profile)});}catch(e){error(e);return;}
  const activityId='summary-'+crypto.randomUUID();loading=true;refreshLocks();
  try{if(!await availableTopic())return;await transact(p=>completeArenaActivity(p,{runId,activityId,kind:'summary',text,confirmed}),()=>{run=next;lastSummary='';summaryOpen=false;status('Medikit usato. Il tuo riassunto è conservato nella sezione Crediti.');});}
  catch(e){error(e);}finally{loading=false;render();}
 }
 function walls(){return [...ARENA_BUILDINGS.map(b=>({x:b.x-5,y:b.y+5,w:b.w+10,h:b.h})),...world.walls];}
 function blocked(x,y,padding=12){return x<45||x>955||y<45||y>595||walls().some(b=>x>b.x-padding&&x<b.x+b.w+padding&&y>b.y-padding&&y<b.y+b.h+padding);}
 function lineClear(a,b){const steps=Math.ceil(distance(a,b)/8);for(let i=1;i<steps;i++){const x=a.x+(b.x-a.x)*i/steps,y=a.y+(b.y-a.y)*i/steps;if(walls().some(o=>x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h))return false;}return true;}
 function nearestInteraction(){
  if(!world)return null;if(world.driving){const station=ARENA_BUILDINGS.find(v=>v.id==='benzinaio');if(distance(world.player,station.door)<105)return{kind:'fuel',label:'Rifornisci l’auto',item:station};return{kind:'exit-car',label:'Scendi dall’auto'};}
  const choices=[...world.loot.filter(v=>!v.opened).map(item=>({kind:'loot',item,label:`Apri: ${item.rarity}`})),...world.cars.map(item=>({kind:'car',item,label:'Sali in auto'})),...ARENA_BUILDINGS.map(item=>({kind:item.id,item:{...item,...item.door},label:item.id==='casa'?'Riposa e usa il medikit':item.id==='negozio'?'Entra nel negozio':item.id==='benzinaio'?'Rifornimento auto':'Esplora il castello'}))].sort((a,b)=>distance(world.player,a.item)-distance(world.player,b.item));
  return choices[0]&&distance(world.player,choices[0].item)<68?choices[0]:null;
 }
 function interact(){
  if(!checkAccess()||quest||summaryOpen||paused||run?.phase!=='active')return;const next=nearestInteraction();if(!next){status('Avvicinati a una cassa, a un’auto o alla porta di un edificio.');return;}
  if(next.kind==='loot'){beginQuest('loot',next.item);return;}
  if(next.kind==='car'){world.driving=next.item.id;world.player.x=next.item.x;world.player.y=next.item.y;world.destination=null;jumpState={height:0,velocity:0,grounded:true};world.jumpHeight=0;status(viewMode==='3d'?'Sei in auto. Usa il joystick o le frecce per guidare.':'Sei in auto. Usa la mappa o le frecce per guidare.');}
  else if(next.kind==='exit-car'){
   const p=world.player,exit=[[0,46],[0,-46],[46,0],[-46,0],[38,38],[-38,38],[38,-38],[-38,-38]].map(([x,y])=>({x:p.x+x,y:p.y+y})).find(v=>!blocked(v.x,v.y,12));
   if(!exit){status('Non c’è spazio per scendere qui. Sposta l’auto in uno spazio libero.');return;}
   world.driving=null;p.x=exit.x;p.y=exit.y;status('Sei sceso dall’auto.');
  }
  else if(next.kind==='fuel'){world.cars.find(c=>c.id===world.driving).fuel=100;status('Auto rifornita. Puoi proseguire. Per scendere allontanati dalla pompa.');}
  else if(next.kind==='negozio'){tab='Shop';paused=true;}
  else if(next.kind==='casa'){summaryOpen=true;}
  else if(next.kind==='castello')status('Il rifornimento leggendario ti aspetta davanti al castello: richiede 10 domande di questo argomento.');
  else status('Avvicinati al benzinaio con una delle auto dell’isola.');render();
 }
 function fire(){
  if(!checkAccess()||quest||summaryOpen||paused||run?.phase!=='active')return;if(world.driving){status('Scendi dall’auto per usare lo strumento.');return;}
  const p=world.player;if(viewMode==='3d'&&scene3D)p.angle=scene3D.getYaw()-Math.PI/2;const targets=world.robots.filter(r=>r.alive&&distance(p,r)<205&&lineClear(p,r)).filter(r=>Math.abs(Math.atan2(Math.sin(Math.atan2(r.y-p.y,r.x-p.x)-p.angle),Math.cos(Math.atan2(r.y-p.y,r.x-p.x)-p.angle)))<.7).sort((a,b)=>distance(p,a)-distance(p,b));
  const target=targets[0];world.shots=[{from:{x:p.x,y:p.y},to:target?{x:target.x,y:target.y}:{x:p.x+Math.cos(p.angle)*150,y:p.y+Math.sin(p.angle)*150}}];shotUntil=elapsed+.17;paintActors();
  if(target)beginQuest('robot',target);else status(viewMode==='3d'?'Guarda verso un robot vicino e premi Colpisci. I ripari fermano il raggio.':'Mira un robot vicino, senza edifici o ripari in mezzo. Toccalo sulla mappa per mirarlo.');
 }
 function build(){
  if(!checkAccess()||!buildMode||quest||summaryOpen||paused||run?.phase!=='active')return;
  if(world.driving){status('Scendi dall’auto prima di costruire.');return;}
  const p=world.player;if(viewMode==='3d'&&scene3D)p.angle=scene3D.getYaw()-Math.PI/2;const x=p.x+Math.cos(p.angle)*48-26,y=p.y+Math.sin(p.angle)*48-9;
  if(blocked(x+26,y+9,5)){status('Qui c’è già un ostacolo. Scegli uno spazio libero.');return;}
  world.walls.push({x,y,w:52,h:18});if(world.walls.length>4)world.walls.shift();status('Riparo costruito. Ferma i colpi che lo attraversano.');render();
 }
 function canMove(){return (viewMode!=='3d'||Boolean(scene3D))&&!accessLocked&&tab==='Gioca'&&run?.phase==='active'&&!quest&&!summaryOpen&&!paused&&!loading&&!saving&&!store.hasPending;}
 function animate(){if(frame===null&&canMove()&&!document.hidden)frame=requestAnimationFrame(tick);}
 function tick(time){
  frame=null;if(!profileCurrent()||!canMove()||document.hidden)return;
  const dt=lastTime?Math.min(.05,(time-lastTime)/1000):0;lastTime=time;elapsed+=dt;
  const p=world.player;let dx=0,dy=0;
  if(viewMode==='3d'){
   const strafe=(keys.has('right')?1:0)-(keys.has('left')?1:0)+joystick.x;
   const forward=(keys.has('up')?1:0)-(keys.has('down')?1:0)+joystick.y;
   const vector=cameraRelativeMove(strafe,forward,scene3D?.getYaw()||0);dx=vector.x;dy=vector.y;world.destination=null;
  }else{
   dx=(keys.has('right')?1:0)-(keys.has('left')?1:0);dy=(keys.has('down')?1:0)-(keys.has('up')?1:0);
   if(dx||dy)world.destination=null;else if(world.destination){const d=distance(p,world.destination);if(d<5)world.destination=null;else{dx=(world.destination.x-p.x)/d;dy=(world.destination.y-p.y)/d;}}
   const length=Math.hypot(dx,dy);if(length>1){dx/=length;dy/=length;}
  }
  const car=world.driving&&world.cars.find(c=>c.id===world.driving);
  if(dx||dy){const speed=(car?car.fuel>0?205:0:(sprintEnabled||keys.has('sprint'))?170:105)*dt;p.angle=Math.atan2(dy,dx);const nx=p.x+dx*speed,ny=p.y+dy*speed;
   if(!blocked(nx,p.y,car?21:12))p.x=nx;if(!blocked(p.x,ny,car?21:12))p.y=ny;
   if(car){car.x=p.x;car.y=p.y;car.angle=p.angle;car.fuel=Math.max(0,car.fuel-dt*1.2);}
  }
  if(!car){jumpState=advanceArenaJump(jumpState,dt,{trigger:jumpQueued});world.jumpHeight=jumpState.height;}else world.jumpHeight=0;jumpQueued=false;
  for(let i=0;i<world.robots.length;i++){const robot=world.robots[i];if(!robot.alive)continue;const nx=robot.homeX+Math.sin(elapsed*.6+i*2)*27,ny=robot.homeY+Math.cos(elapsed*.45+i)*22;if(!blocked(nx,ny,12)){robot.x=nx;robot.y=ny;}}
  if(elapsed-lastDamage>5&&world.robots.some(r=>r.alive&&distance(p,r)<100&&lineClear(p,r))){lastDamage=elapsed;run=damageArenaRun(run,5);status('Un robot ti ha raggiunto: meno 5 energie. Puoi allontanarti o usare un riparo.');if(run.phase==='rest'){render();return;}}
  paintActors(dt);animate();
 }
 function paintActors(dt=0){
  if(!world)return;
  const health=q('[data-ia-health]');if(health){health.textContent=run.health;health.previousElementSibling.value=run.health;}
  const car=world.driving&&world.cars.find(c=>c.id===world.driving);if(car&&q('[data-ia-fuel]'))q('[data-ia-fuel]').textContent=`${Math.round(car.fuel)}%`;
  const interactButton=q('[data-ia-interact]');if(interactButton)interactButton.textContent=nearestInteraction()?.label||'Interagisci';
  if(viewMode==='3d'){updateScene(dt);return;}
  if(!q('[data-ia-map]'))return;const p=world.player;
  const player=q('[data-ia-player]');player.setAttribute('transform',`translate(${p.x} ${p.y})`);player.style.display=world.driving?'none':'';player.querySelector('[data-ia-aim]')?.setAttribute('transform',`rotate(${p.angle*180/Math.PI})`);
  const pet=q('[data-ia-pet]');pet?.setAttribute('transform',`translate(${p.x-31} ${p.y+22})`);if(pet)pet.style.display=world.driving?'none':'';
  for(const car of world.cars)q(`[data-ia-car="${car.id}"]`)?.setAttribute('transform',`translate(${car.x} ${car.y}) rotate(${car.angle*180/Math.PI})`);
  for(const robot of world.robots){const node=q(`[data-ia-robot="${robot.id}"]`);if(node){node.style.display=robot.alive?'':'none';node.setAttribute('transform',`translate(${robot.x} ${robot.y})`);node.classList.toggle('ia-targeted',aimTarget===robot.id);}}
  for(const loot of world.loot){const node=q(`[data-ia-loot="${loot.id}"]`);if(node)node.style.display=loot.opened?'none':'';}
  q('[data-ia-walls]').innerHTML=world.walls.map(b=>`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="#b88b5a" stroke="#694e3a" stroke-width="3"/>`).join('');
  const marker=q('[data-ia-destination]');marker.toggleAttribute('hidden',!world.destination);if(world.destination){marker.setAttribute('cx',world.destination.x);marker.setAttribute('cy',world.destination.y);}
  const shot=q('[data-ia-shot]');shot.toggleAttribute('hidden',elapsed>=shotUntil||!world.shots.length);if(world.shots[0]){const s=world.shots[0];shot.querySelector('path').setAttribute('d',`M${s.from.x} ${s.from.y}L${s.to.x} ${s.to.y}`);}
 }
 function bindMap(){
  const viewport=q('[data-ia-viewport]');
  const map=q('[data-ia-map]');map?.addEventListener('pointerdown',event=>{
   if(viewMode!=='2d'||!checkAccess()||!canMove())return;event.preventDefault();const point=map.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const pos=point.matrixTransform(map.getScreenCTM().inverse());
   const robotId=event.target.closest('[data-ia-robot]')?.dataset.iaRobot;
   if(robotId){const robot=world.robots.find(r=>r.id===robotId);aimTarget=robot.id;world.player.angle=Math.atan2(robot.y-world.player.y,robot.x-world.player.x);world.destination=null;status('Robot mirato. Avvicinati se serve, poi premi Colpisci.');}
   else{world.destination={x:clamp(pos.x,45,955),y:clamp(pos.y,45,595)};aimTarget=null;}
   map.focus({preventScroll:true});animate();
  });
  for(const button of dialog.querySelectorAll('[data-ia-move]')){button.onpointerdown=event=>{if(!checkAccess()||!canMove())return;event.preventDefault();button.setPointerCapture(event.pointerId);keys.add(button.dataset.iaMove);world.destination=null;animate();};for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>keys.delete(button.dataset.iaMove));}
  const stick=q('[data-ia-joystick]'),thumb=q('[data-ia-stick-thumb]');
  const moveStick=event=>{const rect=stick.getBoundingClientRect();joystick=joystickVector(event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2,48);thumb.style.transform=`translate(${joystick.x*34}px,${-joystick.y*34}px)`;animate();};
  stick?.addEventListener('pointerdown',event=>{if(joystickPointer!==null||!checkAccess()||!canMove())return;event.preventDefault();joystickPointer=event.pointerId;stick.setPointerCapture(event.pointerId);moveStick(event);viewport.focus({preventScroll:true});});
  stick?.addEventListener('pointermove',event=>{if(event.pointerId!==joystickPointer||!canMove())return;event.preventDefault();moveStick(event);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stick?.addEventListener(name,event=>{if(event.pointerId!==joystickPointer)return;joystickPointer=null;joystick={x:0,y:0};thumb.style.transform='translate(0,0)';});
  const look=q('[data-ia-look]');let previous=null,travel=0;
  look?.addEventListener('pointerdown',event=>{if(lookPointer!==null||!checkAccess()||!canMove()||!scene3D)return;event.preventDefault();lookPointer=event.pointerId;previous={x:event.clientX,y:event.clientY,type:event.pointerType,button:event.button};travel=0;look.setPointerCapture(event.pointerId);viewport.focus({preventScroll:true});});
  look?.addEventListener('pointermove',event=>{if(event.pointerId!==lookPointer||!previous||!canMove()||!scene3D)return;event.preventDefault();const dx=event.clientX-previous.x,dy=event.clientY-previous.y;travel+=Math.hypot(dx,dy);scene3D.look(dx,dy);previous.x=event.clientX;previous.y=event.clientY;paintActors();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])look?.addEventListener(name,event=>{if(event.pointerId!==lookPointer)return;const click=name==='pointerup'&&previous?.type==='mouse'&&previous.button===0&&travel<5;lookPointer=null;previous=null;if(click&&canMove())fire();});
  look?.addEventListener('contextmenu',event=>event.preventDefault());
 }
 function resizeScene(){if(scene3D&&sceneHost?.isConnected){try{scene3D.resize();updateScene();}catch{fallback3D('Il 3D è stato sospeso. Puoi continuare nella visuale dall’alto.');}}}
 const keyMap={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
 function keydown(event){
  if(event.target.closest('input,textarea,select,button,summary,a,[contenteditable="true"]')||!checkAccess()||!canMove())return;
  if(keyMap[event.key]){event.preventDefault();keys.add(keyMap[event.key]);animate();}
  else if(event.key==='Shift'){event.preventDefault();keys.add('sprint');}
  else if(event.code==='Space'){event.preventDefault();if(!event.repeat){if(viewMode==='3d'&&!world.driving){jumpQueued=true;animate();}else if(viewMode==='2d')fire();}}
  else if((event.key==='f'||event.key==='F')&&!event.repeat){event.preventDefault();fire();}
  else if((event.key==='e'||event.key==='E')&&!event.repeat){event.preventDefault();interact();}
 }
 function keyup(event){if(keyMap[event.key])keys.delete(keyMap[event.key]);if(event.key==='Shift')keys.delete('sprint');}
 function blur(){keys.clear();stop();if(run&&canMove()){paused=true;render();}}
 function visibility(){if(!checkAccess())return;if(document.hidden)blur();}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('submit',event=>{if(event.target.matches('[data-ia-summary-form]')){event.preventDefault();saveSummary(event.target);}});
 dialog.addEventListener('input',event=>{if(event.target.matches('[data-ia-summary]'))lastSummary=event.target.value;});
 dialog.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.iaAction==='close'){close();return;}if(button.dataset.iaAction==='unlock'){unlock().catch(error);return;}if(!checkAccess())return;
  if(button.dataset.iaTab){if(quest||summaryOpen){status('Termina o chiudi la domanda prima di cambiare sezione.');return;}tab=button.dataset.iaTab;render();return;}
  if(button.hasAttribute('data-ia-answer')){respond(Number(button.dataset.iaAnswer));return;}
  const action=button.dataset.iaAction;
  if(action==='close'){close();return;}if(action==='retry'){retry();return;}if(saving||store.hasPending||loading)return;
  if(action==='source')changeSource();else if(action==='start')start();else if(action==='view-2d'||action==='view-3d'){viewMode=action==='view-3d'?'3d':'2d';if(world){world.destination=null;world.jumpHeight=0;}jumpState={height:0,velocity:0,grounded:true};render();if(run&&!quest&&!summaryOpen)dialog.scrollTo(0,0);}else if(action==='build-on'||action==='build-off'){buildMode=action==='build-on';render();}
  else if(action==='equip')transact(p=>equipArenaItem(p,button.dataset.item));else if(action==='buy')transact(p=>buyArenaItem(p,button.dataset.item));else if(action==='claim')transact(p=>claimArenaMission(p,button.dataset.mission));
  else if(action==='pause'||action==='resume'){paused=action==='resume'?false:!paused;render();}else if(action==='lobby'){if(!confirm('Tornare alla lobby? Crediti e oggetti già ottenuti restano salvati.'))return;disposeScene();run=null;quest=null;summaryOpen=false;tab='Gioca';render();}
  else if(action==='run'){sprintEnabled=!sprintEnabled;button.setAttribute('aria-pressed',String(sprintEnabled));button.classList.toggle('selected',sprintEnabled);}else if(action==='jump'){if(canMove()&&!world.driving){jumpQueued=true;animate();}}else if(action==='interact')interact();else if(action==='fire')fire();else if(action==='build')build();else if(action==='next')nextQuestion();else if(action==='cancel-quest'){quest=null;render();}
  else if(action==='summary'){if(quest||paused)return;if(run?.phase!=='active'){status('Riparti con energia nuova prima di usare il medikit.');return;}summaryOpen=true;render();}else if(action==='cancel-summary'){summaryOpen=false;render();}
  else if(action==='restart'){jumpState={height:0,velocity:0,grounded:true};world.jumpHeight=0;run=restartArenaRun(run);world.player.x=495;world.player.y=320;if(viewMode==='3d')world.player.angle=(scene3D?.getYaw()||0)-Math.PI/2;world.driving=null;world.destination=null;render();}
  if(event.detail>0&&canMove())q('[data-ia-viewport]')?.focus({preventScroll:true});
 });
 document.body.append(dialog);dialog.showModal();window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);window.addEventListener('focus',checkAccess);window.addEventListener('storage',checkAccess);document.addEventListener('visibilitychange',visibility);document.addEventListener('skooling:game-access-changed',checkAccess);window.addEventListener('resize',resizeScene);watch=setInterval(checkAccess,1000);
 try{profile=await store.load();if(checkAccess())render();}catch(e){error(e);q('[data-ia-content]').innerHTML='<p>Non riesco ad aprire il profilo del gioco. I dati precedenti restano conservati. Chiudi e riapri l’isola per riprovare.</p>';}
}
