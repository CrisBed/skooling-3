import {DB,DB_NAME} from './db.js';
import {activeDatabaseName} from './students.js';
import {readGameAccess,ensureGameAccess} from './game-access.js';
import {chooseGameQuestions,assertGameSelectionAvailable} from './game-source-picker.js';
import {createArenaProfileStore} from './arena-game-storage.js';
import {ARENA_CATALOG,ARENA_MISSIONS,newArenaProfile,validateArenaProfile,buyArenaItem,equipArenaItem,awardArenaAnswer,claimArenaMission,completeArenaActivity,arenaCompanionBonus,newArenaRun,applyArenaAnswer,restartArenaRun,lootQuestionCount,completeArenaSummary,damageArenaRun} from './arena-game-model.js';
import {h,avatarSVG,petSVG,itemSVG,newArenaWorld,arenaMapSVG,arenaShotsSVG,ARENA_BUILDINGS} from './arena-render.js';
import {cameraRelativeMove,joystickVector,advanceArenaJump} from './arena-controls.js';
import {CASTLE_ROOM,inArenaCastle,enterArenaCastle,leaveArenaCastle,visibleArenaLoot,arenaLootPosition} from './arena-castle.js';
import {nextArenaRobotAttack} from './arena-robot-fire.js';
import {ARENA_BUILD_OPTIONS,nearestArenaNode,strikeArenaNode,arenaMaterialObstacles,placeArenaShelter} from './arena-building.js';
import {resolveArenaCarMotion} from './arena-vehicle.js';
import {ARENA_STUDY_INTERVAL_SECONDS,ARENA_WORLD_BOUNDS,ARENA_LANDMARKS,CAVE_ROOMS,sampleArenaSurface,enterArenaCave,leaveArenaCave,createArenaExploration,advanceArenaStudyClock,beginArenaDiscovery,completeArenaDiscovery,strikeArenaDig,createArenaEnemyRoster,advanceArenaEnemies,requestArenaEnemyCover} from './arena-world-model.js';
import {arenaWeapon,arenaWeaponForLoot,canFireArenaWeapon,createArenaWeaponShots} from './arena-weapons.js';
import {newArenaCombat,equipArenaCombat,startArenaReload,advanceArenaCombat,takeArenaCombatShot,withArenaEnemyHealth,hitArenaEnemy,createArenaExpedition,recordArenaExpedition,arenaExpeditionProgress} from './arena-combat-model.js';
import {arenaMissionHUD,updateArenaMissionHUD} from './arena-hud.js';

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
 let run=null,runId=null,world=null,quest=null,summaryOpen=false,buildOpen=false,paused=false,loading=false,saving=false,afterSave=null,accessLocked=false;
 let frame=null,lastTime=0,elapsed=0,lastDamage=0,watch=null,shotUntil=0,lastUsed=[],used=[],lastSummary='',aimTarget=null;
 let viewMode='3d',scene3D=null,sceneHost=null,sceneEpoch=0,sceneLoading=false,sceneNotice='',sceneFrames=0;
 let joystick={x:0,y:0},joystickPointer=null,lookPointer=null,sprintEnabled=false,jumpQueued=false,jumpState={height:0,velocity:0,grounded:true};
 let obstacleMaterials=null,materialRects=[],discoveryQuest=null,studyRetryAt=0,lastWeaponShot=null,pendingEncounter=null,fireHeld=false,firePointer=null;
 const robotChallenges=new Map();
 const area=()=>world?.area||'island';
 const caveRoom=()=>CAVE_ROOMS.find(room=>room.id===world?.caveId);
 const indoors=()=>area()!=='island';
 const surfaceAt=(x,y)=>sampleArenaSurface(x,y,{area:area(),caveId:world?.caveId});
 function updateSurface(){const surface=surfaceAt(world.player.x,world.player.y);if(!surface)return false;world.groundHeight=surface.kind==='water'?surface.waterLevel-.2:surface.height;world.movementMode=surface.kind==='water'?'swim':surface.kind==='rock'&&surface.slope>.3?'climb':'walk';world.surfaceKind=surface.kind;return true;}
 const keys=new Set();
 const dialog=document.createElement('dialog');dialog.className='island-arena-dialog';dialog.setAttribute('aria-label','Isola delle Idee');
 dialog.innerHTML=`<header class="ia-header"><div><span class="ia-logo-mark" aria-hidden="true">I</span><h2>Isola delle Idee</h2></div><div><span class="ia-balance" data-ia-balance>0 crediti</span><button type="button" class="ia-close" aria-label="Chiudi Isola delle Idee" data-ia-action="close">×</button></div></header><nav class="ia-tabs" aria-label="Sezioni dell’isola">${['Gioca','Armadietto','Shop','Missioni','Crediti'].map(name=>`<button type="button" data-ia-tab="${name}">${name}</button>`).join('')}</nav><div class="ia-source"><span data-ia-source></span><button type="button" data-ia-action="source">Cambia argomento</button></div><main class="ia-content" data-ia-content></main><footer class="ia-footer"><p role="status" data-ia-status></p><p role="alert" data-ia-error></p><button type="button" class="ia-button" data-ia-action="retry" hidden>Riprova salvataggio</button><small>${session?.temporary?'Su questo computer le prove restano in questa apertura. Per conservarle usa l’invio all’iPad nelle Impostazioni.':'Il tuo armadietto e i crediti si salvano nell’archivio di Skooling su questo dispositivo.'}</small></footer>`;
 const q=s=>dialog.querySelector(s),store=createArenaProfileStore(DB,{createProfile:newArenaProfile,validateProfile:validateArenaProfile,isCurrent:profileCurrent});
 function status(text=''){if(!closed&&q('[data-ia-status]').textContent!==text)q('[data-ia-status]').textContent=text;}
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
  if(!checkAccess())return false;
  const chosen=selection;await assertGameSelectionAvailable(chosen);
  return checkAccess()&&selection===chosen;
 }
 function stop(){cancelAnimationFrame(frame);frame=null;lastTime=0;keys.clear();joystick={x:0,y:0};joystickPointer=null;lookPointer=null;jumpQueued=false;sprintEnabled=false;fireHeld=false;firePointer=null;if(world)world.aiming=false;const button=q('[data-ia-action="run"]');if(button){button.textContent='Corri';button.setAttribute('aria-pressed','false');button.classList.remove('selected');}}
 function detachScene(){sceneHost?.remove();}
 function disposeScene(){sceneEpoch++;sceneLoading=false;detachScene();try{scene3D?.dispose();}catch{}scene3D=null;sceneHost=null;sceneFrames=0;}
 function updateScene(dt=0){
  if(!scene3D||!sceneHost?.isConnected||!world||accessLocked)return;
  try{
   scene3D.update(world,profile,{dt,elapsed,shotUntil,paused:!canPlay()});sceneFrames++;
   for(const node of [sceneHost]){node.dataset.iaPlayerX=world.player.x.toFixed(3);node.dataset.iaPlayerY=world.player.y.toFixed(3);node.dataset.iaCameraYaw=String(scene3D.getYaw());node.dataset.iaFrames=String(sceneFrames);node.dataset.iaJumpHeight=String(world.jumpHeight||0);node.dataset.iaArea=area();node.dataset.iaCaveId=world.caveId||'';node.setAttribute('data-ia-3d-state','ready');}
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
   scene3D=made;sceneLoading=false;sceneNotice='';q('.ia-scene-notice')?.remove();
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
   if(['close','retry','unlock'].includes(button.dataset.iaAction)||pendingEncounter&&['pause','resume'].includes(button.dataset.iaAction))continue;
   if(saving||store.hasPending||loading||accessLocked||pendingEncounter){if(!button.disabled)button.dataset.iaSaveLocked='true';button.disabled=true;}
   else if(button.dataset.iaSaveLocked){button.disabled=false;delete button.dataset.iaSaveLocked;}
  }
  for(const control of dialog.querySelectorAll('[data-ia-summary-form] input,[data-ia-summary-form] textarea,[data-ia-summary-form] button')){
   if(saving||store.hasPending||loading||accessLocked||pendingEncounter){if(!control.disabled)control.dataset.iaSaveLocked='true';control.disabled=true;}
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
  if(tab==='Gioca'&&run){bindMap();paintActors();if(viewMode==='3d')attachScene();if(!quest&&!summaryOpen&&!buildOpen&&!paused&&run.phase==='active')animate();}
 }
 function lobbyHTML(){
  const guide=viewMode==='3d'?'<li>Tablet: muoviti con il joystick a sinistra e guarda trascinando a destra. Computer: WASD o frecce, trascina per guardare.</li><li>Avvicinati a una cassa o a un’auto e premi Interagisci. Salta con il pulsante o Spazio. Corri parte da solo; Ferma corsa lo arresta. Shift accelera mentre cammini.</li><li>Tieni premuto Colpisci e trascina per mirare. Più colpi fermano un guardiano; poi arrivano due domande. Completa i tre obiettivi della spedizione.</li>':'<li>Tocca un punto della mappa per camminare, oppure usa WASD e frecce.</li><li>Avvicinati a una cassa o a un’auto e premi Interagisci.</li><li>Tocca un robot per mirare e premi Colpisci. Le domande fermano il gioco: rispondi con calma.</li>';
  const friend='<div class="ia-friend-slot"><span aria-hidden="true">＋</span><strong>Amico</strong><small>Online prossimamente</small></div>';
  return `<section class="ia-lobby"><div class="ia-lobby-heading"><h1>La tua prossima spedizione.</h1><p>Apri un rifornimento, completa tre incontri e scopri un reperto. Le domande arrivano dalle pagine che hai scelto.</p></div><div class="ia-party"><div>${friend}</div><div class="ia-hero-character">${avatarSVG(profile)}${profile.equipped.pet!=='pet-nessuno'?`<div class="ia-lobby-pet">${petSVG(profile.equipped.pet)}</div>`:''}<strong>${h(itemName(profile.equipped.skin))}</strong></div><div class="ia-two-friends">${friend}${friend}</div></div><div class="ia-mode" role="group" aria-label="Modalità costruzione"><button type="button" data-ia-action="build-on" class="${buildMode?'selected':''}" aria-pressed="${buildMode}">Costruisci</button><button type="button" data-ia-action="build-off" class="${!buildMode?'selected':''}" aria-pressed="${!buildMode}">Non costruire</button></div><p class="ia-mode-copy">${buildMode?'Puoi creare ripari per fermare i colpi dei robot.':'Esplora e usa i ripari già presenti sulla mappa.'} ${availableCount} domande disponibili nella fonte scelta.</p><div class="ia-view-choice" role="group" aria-label="Scegli la visuale"><button type="button" class="ia-button ${viewMode==='3d'?'selected':''}" data-ia-action="view-3d" aria-pressed="${viewMode==='3d'}">Esplora in 3D</button><button type="button" class="ia-button ${viewMode==='2d'?'selected':''}" data-ia-action="view-2d" aria-pressed="${viewMode==='2d'}">Visuale dall’alto</button></div><button type="button" class="ia-button ia-primary ia-start" data-ia-action="start">Parti per l’isola</button><div class="ia-how"><h3>Tre mosse per cominciare</h3><ol>${guide}</ol><p>Tre colpi di piccone raccolgono legno o mattoni. Premi Riparo per scegliere pareti o angoli. I materiali valgono per questo giro.</p><p>Si gioca da soli. Gli amici online arriveranno in futuro.</p></div></section>`;
 }
 function lockerHTML(){return `<section class="ia-collection"><h1>Il tuo armadietto</h1><p>Scegli quello che vuoi indossare. I compagni aiutano il medikit, senza saltare domande.</p>${Object.entries(labels).map(([type,label])=>`<h2>${label}</h2><div class="ia-item-grid">${ARENA_CATALOG.filter(v=>v.type===type&&profile.owned.includes(v.id)).map(item=>`<article class="ia-item-card">${itemSVG(item,profile)}<h3>${h(item.name)}</h3><p>${h(item.description)}</p><button type="button" class="ia-button" data-ia-action="equip" data-item="${item.id}" ${profile.equipped[type]===item.id?'disabled':''}>${profile.equipped[type]===item.id?(type==='pet'?(item.id==='pet-nessuno'?'Senza compagno':'Ti segue'):'Indossato'):(type==='pet'?'Scegli':'Indossa')}</button></article>`).join('')}</div>`).join('')}</section>`;}
 function shopHTML(){
  const animals=new Set(['pet-cane','pet-gatto','pet-volpe','pet-drago']);
  return `<section class="ia-collection ia-shop"><h1>Lo shop dell’isola</h1><p>Guadagni 5 crediti per risposta corretta, una volta per domanda in ogni giro. Scegli qui il tuo compagno e il tuo costume. Non si usa denaro vero.</p>${['pet','skin','pickaxe','wrap'].map(type=>{
   const items=ARENA_CATALOG.filter(item=>item.type===type&&!item.base&&!item.reward).sort((a,b)=>type==='pet'?Number(animals.has(b.id))-Number(animals.has(a.id)):0);
   return `<section class="ia-shop-type"><h2>${type==='pet'?'Animali e compagni che ti seguono':labels[type]}</h2>${type==='pet'?'<p>Scegline uno nell’Armadietto dopo averlo ottenuto. Ti segue un compagno alla volta; il suo bonus aiuta il medikit.</p>':''}<div class="ia-item-grid">${items.map(item=>{
    const owned=profile.owned.includes(item.id),missing=Math.max(0,Math.ceil((item.cost-profile.credits)/5));
    return `<article class="ia-item-card">${itemSVG(item,profile)}<h3>${h(item.name)}</h3><p>${h(item.description)}</p><strong>${item.cost} crediti</strong>${!owned&&missing?`<p class="ia-shop-shortfall">${missing===1?'Ti manca 1 risposta corretta':`Ti mancano ${missing} risposte corrette`}</p>`:''}<button type="button" class="ia-button" data-ia-action="buy" data-item="${item.id}" ${owned||missing?'disabled':''}>${owned?'Nel tuo armadietto':missing?'Continua a rispondere':'Prendi con i crediti'}</button></article>`;
   }).join('')}</div></section>`;
  }).join('')}</section>`;
 }
 function missionsHTML(){return `<section class="ia-collection"><h1>Le tue missioni</h1><p>Ogni obiettivo completato ti regala un oggetto originale per l’armadietto.</p><div class="ia-mission-list">${ARENA_MISSIONS.map(m=>`<article class="ia-mission"><div>${itemSVG(ARENA_CATALOG.find(v=>v.id===m.rewardId),profile)}</div><section><h2>${h(m.name)}</h2><p>${h(m.description)}</p><progress max="${m.target}" value="${Math.min(m.target,profile.stats[m.stat])}"></progress><p>${Math.min(m.target,profile.stats[m.stat])} / ${m.target} · Regalo: ${h(itemName(m.rewardId))}</p><button type="button" class="ia-button" data-ia-action="claim" data-mission="${m.id}" ${profile.missions[m.id]||profile.stats[m.stat]<m.target?'disabled':''}>${profile.missions[m.id]?'Regalo ricevuto':profile.stats[m.stat]>=m.target?'Ricevi il regalo':'Missione in corso'}</button></section></article>`).join('')}</div></section>`;}
 function creditsHTML(){const summaries=Object.values(profile.receipts.activities).filter(r=>r.kind==='summary');return `<section class="ia-credit-page"><h1>I tuoi crediti</h1><strong class="ia-credit-number">${profile.credits}</strong><p>Crediti virtuali da usare solo nello shop dell’isola. Nessun pagamento, abbonamento o acquisto con denaro vero.</p><dl><div><dt>Risposte corrette</dt><dd>${profile.stats.correct}</dd></div><div><dt>Robot completati</dt><dd>${profile.stats.robots}</dd></div><div><dt>Rifornimenti aperti</dt><dd>${profile.stats.loot}</dd></div><div><dt>Riassunti scritti</dt><dd>${profile.stats.summaries}</dd></div></dl><p>I crediti arrivano dalle risposte corrette. Ripremere la stessa risposta o riprovare un salvataggio non li raddoppia.</p>${summaries.length?`<h2>Riassunti conservati</h2>${summaries.map((s,i)=>`<details><summary>Riassunto ${i+1}</summary><blockquote>${h(s.text)}</blockquote></details>`).join('')}`:''}</section>`;}
 function matchHTML(){
  const nearby=nearestInteraction(),fuel=world.driving?world.cars.find(c=>c.id===world.driving)?.fuel:0,threeD=viewMode==='3d';
  const overlay=quest?questionHTML():summaryOpen?summaryHTML():buildOpen?buildHTML():run.phase==='rest'?'<div class="ia-pause-card"><h2>Un momento di riposo</h2><p>Hai esaurito l’energia. Crediti e oggetti guadagnati restano tuoi.</p><button type="button" class="ia-button ia-primary" data-ia-action="restart">Riparti con energia nuova</button></div>':paused?`<div class="ia-pause-card"><h2>${world.exploration.pending?'Ripasso in pausa':'Isola in pausa'}</h2>${world.exploration.pending?'<p>Il giro e il tempo restano fermi. Le domande preparate restano le stesse.</p>':''}<button type="button" class="ia-button ia-primary" data-ia-action="${world.exploration.pending?'study':'resume'}">${world.exploration.pending?'Riprendi il ripasso':'Riprendi'}</button></div>`:'';
  const controls=threeD?`<div class="ia-touch-controls"><div class="ia-joystick" data-ia-joystick role="group" aria-label="Joystick per muoverti"><span class="ia-stick-ring"></span><span data-ia-stick-thumb></span><small>Muoviti</small></div><div class="ia-action-pad"><button type="button" class="ia-button ${sprintEnabled?'selected':''}" data-ia-action="run" aria-pressed="${sprintEnabled}" ${world.driving?'disabled':''}>${sprintEnabled?'Ferma corsa':'Corri'}</button><button type="button" class="ia-button" data-ia-action="jump">Salta</button><button type="button" class="ia-button ia-primary" data-ia-action="interact" data-ia-interact>${h(nearby?.label||'Interagisci')}</button><button type="button" class="ia-button ia-primary" data-ia-action="fire">Colpisci</button><button type="button" class="ia-button" data-ia-action="aim" aria-pressed="${Boolean(world.aiming)}">Mira</button>${area()==='island'?'<button type="button" class="ia-button" data-ia-action="harvest">Piccone</button>':''}${buildMode?'<button type="button" class="ia-button" data-ia-action="build">Riparo</button>':''}<button type="button" class="ia-button" data-ia-action="summary">Medikit</button></div></div>`:`<div class="ia-match-tools"><div class="ia-dpad" aria-label="Cammina sulla mappa"><button type="button" data-ia-move="up" aria-label="Vai su">↑</button><button type="button" data-ia-move="left" aria-label="Vai a sinistra">←</button><button type="button" data-ia-move="down" aria-label="Vai giù">↓</button><button type="button" data-ia-move="right" aria-label="Vai a destra">→</button></div><button type="button" class="ia-button ia-primary" data-ia-action="interact" data-ia-interact>${h(nearby?.label||'Interagisci')}</button><button type="button" class="ia-button" data-ia-action="fire">Colpisci</button>${area()==='island'?'<button type="button" class="ia-button" data-ia-action="harvest">Piccone</button>':''}${buildMode?'<button type="button" class="ia-button" data-ia-action="build">Riparo</button>':''}<button type="button" class="ia-button" data-ia-action="summary">Medikit</button></div>`;
  const hud=`<div class="ia-hud"><div><span>Energia</span><meter min="0" max="100" value="${run.health}"></meter><strong data-ia-health>${run.health}</strong></div><div class="ia-weapon-hud"><strong>${h(world.weapon)}</strong><button type="button" data-ia-action="reload" aria-label="Ricarica lo strumento"><span data-ia-ammo>${world.combat.ammo} / ${world.combat.capacity}</span><small>Ricarica</small></button></div><div class="ia-location-hud" data-ia-location>${area()==='cave'?'Grotta':inArenaCastle(world)?'Castello':world.movementMode==='swim'?'Nuoti sull’isola':'Esplora l’isola'}</div><div class="ia-resource-hud"><small>Materiali di questo giro</small><span>Legno <strong data-ia-wood>${world.materials.wood}</strong></span><span>Mattoni <strong data-ia-brick>${world.materials.brick}</strong></span></div>${world.driving?`<div><span>Carburante</span><strong data-ia-fuel>${Math.round(fuel)}%</strong></div>`:''}${area()==='cave'?`<button type="button" class="ia-button" data-ia-action="cave-exit" ${run.phase!=='active'||quest||summaryOpen||buildOpen||paused||loading||saving||store.hasPending?'disabled':''}>Esci dalla grotta</button>`:''}${world.exploration?.pending&&!paused&&!quest?'<button type="button" class="ia-button ia-study-pending" data-ia-action="study">Riprendi il ripasso</button>':''}${inArenaCastle(world)?`<button type="button" class="ia-button ia-castle-exit" data-ia-action="castle-exit" ${run.phase!=='active'||quest||summaryOpen||buildOpen||paused||loading||saving||store.hasPending?'disabled':''}>Esci dal castello</button>`:''}<button type="button" class="ia-button" data-ia-action="${threeD?'view-2d':'view-3d'}">${threeD?'Visuale dall’alto':'Torna al 3D'}</button><button type="button" class="ia-button" data-ia-action="pause">${paused?'Riprendi':'Pausa'}</button><button type="button" class="ia-button" data-ia-action="lobby">Lobby</button></div>`;
  return `<section class="ia-match ${threeD?'ia-match-3d':''}">${!threeD&&!overlay?arenaMissionHUD(world,selection):''}${sceneNotice?`<p class="ia-scene-notice" role="status">${h(sceneNotice)}</p>`:''}${!threeD?hud:''}<div class="ia-map-wrap ${threeD?'ia-viewport-3d':''}" data-ia-viewport data-ia-area="${area()}" ${!threeD?'data-ia-3d-state="fallback"':''} tabindex="0" aria-label="${area()==='cave'?'Grotta delle scoperte':inArenaCastle(world)?'Sala del tesoro del castello':threeD?'Esplora l’isola in tre dimensioni':'Mappa dall’alto'}">${threeD?hud:''}${threeD?`${!scene3D?'<p class="ia-scene-loading" data-ia-scene-loading>Preparo l’isola in 3D…</p>':''}<div class="ia-look-pad" data-ia-look aria-label="Trascina qui per guardarti intorno"></div><span class="ia-crosshair" aria-hidden="true"></span>${!overlay?controls+arenaMissionHUD(world,selection):''}`:arenaMapSVG(world,profile)}${overlay}</div>${threeD?'':controls}<p class="ia-control-help">${threeD?'Muoviti con il joystick. Tieni premuto Colpisci e trascina per mirare. Sul Mac: WASD, F per colpire, Q per mirare, R per ricaricare, T per il piccone.':'Tocca la mappa per camminare. Frecce o WASD, E per interagire, Spazio o F per colpire. Per mirare tocca un robot vicino. R per ricaricare, T per il piccone.'}</p><details class="ia-explore-guide"><summary>Dove andare sull’isola</summary><p>La mappa dall’alto mostra tutti i posti. In 3D, orientati con il nord indicato qui: <strong data-ia-compass>nord</strong>.</p><ul><li>Ovest: spiaggia e punto di scavo. Tre colpi di Piccone, poi Interagisci.</li><li>Nord: ingresso della grotta e sentiero che sale alla cima.</li><li>Est: lago, cascata e un drone. Entra nell’acqua a piedi per nuotare.</li><li>I rifugi offrono il medikit. I reperti e gli incontri richiedono due domande.</li></ul><p>Ogni due minuti di esplorazione attiva, un drone ti propone un breve ripasso. Pause e domande fermano il tempo.</p></details></section>`;
 }
 function buildHTML(){
  const materials=world.materials;
  return `<article class="ia-question ia-build-menu" data-ia-build-menu><h2 tabindex="-1">Scegli il tuo riparo</h2><p>Materiali di questo giro: ${materials.wood} legno e ${materials.brick} mattoni. Tre colpi di piccone su un albero o un muro ti danno materiali; poi scegli Riparo.</p><p>Le pareti si orientano davanti a te. Lascia spazio per muoverti e per l’uscita.</p><div class="ia-build-grid">${ARENA_BUILD_OPTIONS.map(option=>{
   const available=materials[option.resource],ready=available>=option.cost&&materials.builtCount<24,color=option.resource==='wood'?'#b68a58':'#ba705c',corner=option.id.endsWith('-corner');
   return `<button type="button" class="ia-build-choice" data-ia-action="place-build" data-ia-build-kind="${option.id}" ${ready?'':'disabled'}><svg viewBox="0 0 100 60" aria-hidden="true"><path d="${corner?'M18 45H73V13':'M15 36H85'}" fill="none" stroke="${color}" stroke-width="15" stroke-linejoin="miter"/><path d="${corner?'M18 45H73V13':'M15 36H85'}" fill="none" stroke="#fff4" stroke-width="3" stroke-dasharray="9 7"/></svg><strong>${h(option.label)}</strong><span>${option.cost} ${option.resource==='wood'?'legno':'mattoni'} · Hai ${available}</span>${materials.builtCount>=24?'<small>Limite di 24 ripari raggiunto</small>':!ready?`<small>Raccogli ancora ${option.cost-available} ${option.resource==='wood'?'legno':'mattoni'}</small>`:''}</button>`;
  }).join('')}</div><button type="button" class="ia-button" data-ia-action="cancel-build">Annulla e torna al gioco</button></article>`;
 }
 function questionHTML(){
  const question=quest.questions[quest.index];return `<article class="ia-question" data-ia-question><span>${quest.discovery?(quest.periodic?'Il drone del ripasso':'Una scoperta da comprendere'):quest.kind==='loot'?`${h(quest.item.rarity)} · apri il rifornimento`:'Incontro con il robot'} · ${quest.index+1} di ${quest.questions.length}</span><h2 tabindex="-1">${h(question.prompt)}</h2><div class="ia-answers">${question.options.map((option,i)=>`<button type="button" data-ia-answer="${i}" ${quest.correct?'disabled':''} class="${quest.correct&&i===question.correct?'correct':''}">${h(option)}</button>`).join('')}</div><p role="status">${h(quest.feedback||'L’isola è ferma. Hai tutto il tempo per pensare.')}</p><details ${quest.feedback&&!quest.correct?'open':''}><summary>Fonte e indizio</summary>${question.quote?`<blockquote>${h(question.quote)}</blockquote>`:''}<p>${h(question.sourceLabel)}</p></details>${quest.correct?'<button type="button" class="ia-button ia-primary" data-ia-action="next">Continua</button>':''}<button type="button" class="ia-button" data-ia-action="cancel-quest">${quest.discovery?'Continuo tra poco':'Torna alla mappa'}</button></article>`;
 }
 function summaryHTML(){return `<article class="ia-question ia-summary"><h2>Il medikit delle idee</h2><p>Riassumi quello che hai studiato in almeno 10 parole. Rileggi e conferma: non c’è una valutazione AI.</p><p>Fonte scelta: ${h(selection.materia)} · ${h(selection.title)}. Recuperi 50 energie${arenaCompanionBonus(profile)?' più 10 grazie al compagno':''}.</p><form data-ia-summary-form><label>Il tuo piccolo riassunto<textarea data-ia-summary rows="4" maxlength="10000" required>${h(lastSummary)}</textarea></label><label class="ia-confirm"><input type="checkbox" data-ia-summary-confirm required> Ho riletto il riassunto e confermo che racconta quello che ho studiato.</label><button type="submit" class="ia-button ia-primary">Conferma e usa il medikit</button></form><button type="button" class="ia-button" data-ia-action="cancel-summary">Torna alla mappa</button></article>`;}
 async function start(){
  if(!checkAccess()||loading)return;loading=true;refreshLocks();
  try{const source=await chooseGameQuestions({count:2,previousIds:used.length?used:lastUsed,selection});if(!source||!checkAccess())return;selection=source.selection;availableCount=source.availableCount;lastUsed=used;used=[];disposeScene();jumpState={height:0,velocity:0,grounded:true};sprintEnabled=false;run=newArenaRun({buildMode});runId=crypto.randomUUID();world=newArenaWorld();world.exploration=createArenaExploration(runId);world.robots=createArenaEnemyRoster(runId).map(withArenaEnemyHealth);world.combat=newArenaCombat();world.expedition=createArenaExpedition();world.aiming=false;world.hitFlash=null;robotChallenges.clear();world.weaponId='base';world.weapon=arenaWeapon('base').name;world.player.angle=-Math.PI/2;updateSurface();discoveryQuest=null;studyRetryAt=0;lastWeaponShot=null;pendingEncounter=null;world.jumpHeight=0;quest=null;summaryOpen=false;buildOpen=false;paused=false;elapsed=0;lastDamage=0;aimTarget=null;tab='Gioca';error('');status('Avvicinati alla cassa verde davanti a te per iniziare.');}
  catch(e){error(e);}finally{loading=false;render();if(run&&tab==='Gioca'&&!quest&&!summaryOpen&&!buildOpen)dialog.scrollTo(0,0);}
 }
 async function changeSource(){
  if(!checkAccess()||loading)return;if((run||lastSummary.trim())&&!confirm(`Cambiare argomento e tornare alla lobby? Crediti, oggetti e riassunti già salvati restano tuoi.${lastSummary.trim()?' La bozza non salvata appartiene all’argomento attuale e non verrà conservata. Per salvarla, annulla e conferma il medikit.':''}`))return;
  loading=true;stop();refreshLocks();try{const source=await chooseGameQuestions({count:2,previousIds:[]});if(source&&checkAccess()){selection=source.selection;availableCount=source.availableCount;disposeScene();run=null;quest=null;discoveryQuest=null;summaryOpen=false;buildOpen=false;lastSummary='';tab='Gioca';used=[];lastUsed=[];}}catch(e){error(e);}finally{loading=false;render();}
 }
 async function beginQuest(kind,item){
  if(!checkAccess()||loading||saving||store.hasPending||quest||summaryOpen||buildOpen||paused||run?.phase!=='active')return;
  if(world.exploration.pending){beginDiscoveryQuest();return;}
  if(kind==='robot'&&robotChallenges.has(item.id)){quest=robotChallenges.get(item.id);quest.item=item;world.destination=null;error('');render();return;}
  const count=kind==='robot'?2:lootQuestionCount(item.rarity);loading=true;stop();refreshLocks();
  try{const result=await chooseGameQuestions({count,previousIds:[...lastUsed,...used],selection});if(!result||!checkAccess())return;
   quest={kind,item,questions:result.questions,index:0,solved:[],correct:false,feedback:''};if(kind==='robot'){item.hp=0;robotChallenges.set(item.id,quest);}selection=result.selection;availableCount=result.availableCount;world.destination=null;error('');
  }catch(e){error(e);}finally{loading=false;render();q('[data-ia-question] h2')?.focus({preventScroll:true});}
 }
 async function beginDiscoveryQuest(siteId=null){
  if(!checkAccess()||loading||saving||store.hasPending||quest||summaryOpen||buildOpen||paused||run?.phase!=='active')return;
  const pending=world.exploration.pending;
  if(discoveryQuest&&pending?.activityId===discoveryQuest.activityId){quest=discoveryQuest;world.destination=null;error('');render();return;}
  if(pending?.questionIds.length){paused=true;error('Non riesco a riprendere le domande preparate. Torna alla lobby per iniziare un altro giro; i crediti già salvati restano tuoi.');render();return;}
  const chosenSite=pending?.kind==='periodic'?'periodic':siteId||pending?.siteId;if(!chosenSite)return;
  const currentRun=runId;loading=true;stop();refreshLocks();
  try{
   if(!await availableTopic()||runId!==currentRun)return;
   const result=await chooseGameQuestions({count:2,previousIds:[...lastUsed,...used],selection});if(!result||!checkAccess()||runId!==currentRun)return;
   world=beginArenaDiscovery(world,{siteId:chosenSite,questionIds:result.questions.map(question=>question.id)});const activity=world.exploration.pending;
   selection=result.selection;availableCount=result.availableCount;
   quest={kind:activity.activityKind,item:{id:activity.activityId,rarity:activity.rarity},activityId:activity.activityId,discovery:true,periodic:activity.kind==='periodic',questions:result.questions,index:0,solved:[],correct:false,feedback:''};discoveryQuest=quest;world.destination=null;error('');
  }catch(e){studyRetryAt=elapsed+15;error(e);paused=true;status('Il ripasso resta in pausa. Premi Riprendi il ripasso per riprovare la fonte; non vengono inventate domande.');}
  finally{loading=false;if(world.exploration.pending&&!quest)paused=true;render();q('[data-ia-question] h2')?.focus({preventScroll:true});}
 }
 function resumeStudy(){if(!checkAccess()||loading||saving||store.hasPending||quest||summaryOpen||buildOpen||run?.phase!=='active')return;paused=false;beginDiscoveryQuest().catch(error);}
 async function respond(answer){
  if(!checkAccess()||!quest||quest.correct||saving||store.hasPending||loading)return;const current=quest,question=current.questions[current.index];
  loading=true;refreshLocks();
  try{
   if(!await availableTopic()||quest!==current)return;
   if(answer!==question.correct){run=applyArenaAnswer(run,false);current.feedback=`Riprova. ${question.explanation||'Leggi la fonte e cerca l’idea della domanda.'}`;if(run.phase==='rest'){if(current.discovery)discoveryQuest=current;quest=null;}return;}
   await transact(p=>awardArenaAnswer(p,{runId,questionId:question.id,correct:true}),()=>{if(quest!==current)return;run=applyArenaAnswer(run,true);current.solved.push(question.id);used.push(question.id);current.correct=true;current.feedback=`Risposta corretta. ${question.explanation||'Puoi continuare.'}`;});
  }catch(e){quest=null;error(e);}finally{loading=false;render();}
 }
 async function nextQuestion(){
  if(!checkAccess()||!quest?.correct||loading)return;
  if(quest.index+1<quest.questions.length){quest.index++;quest.correct=false;quest.feedback='';render();q('[data-ia-question] h2')?.focus({preventScroll:true});return;}
  const current=quest;loading=true;refreshLocks();try{if(!await availableTopic()||quest!==current)return;await transact(p=>completeArenaActivity(p,{runId,activityId:current.activityId||current.item.id,kind:current.kind,questionIds:current.solved,rarity:current.item.rarity}),()=>{
   if(current.discovery){world=completeArenaDiscovery(world,{activityId:current.activityId,profile});if(!current.periodic)world.expedition=recordArenaExpedition(world.expedition,{kind:'discovery',id:current.item.id});discoveryQuest=null;studyRetryAt=0;quest=null;status(current.periodic?'Ripasso completato. Continua a esplorare: il drone tornerà dopo altri due minuti attivi.':'Reperto raccolto dopo le due risposte. La scoperta resta in questo giro.');return;}
   if(current.kind==='loot'){current.item.opened=true;const weapon=arenaWeaponForLoot(current.item);world.weaponId=weapon.id;world.weapon=weapon.name;world.combat=equipArenaCombat(world.combat,weapon.id);lastWeaponShot=null;world.expedition=recordArenaExpedition(world.expedition,{kind:'chest',id:current.item.id});}else{current.item.alive=false;current.item.hp=0;robotChallenges.delete(current.item.id);world.expedition=recordArenaExpedition(world.expedition,{kind:'robot',id:current.item.id});}
   quest=null;status(current.kind==='loot'?`Rifornimento aperto: ora usi ${world.weapon}.`:'Incontro completato. Il robot si riposa.');
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
 function materialObstacles(){if(world.materials!==obstacleMaterials){materialRects=arenaMaterialObstacles(world.materials);obstacleMaterials=world.materials;}return materialRects;}
 function walls(){
  if(inArenaCastle(world))return [...CASTLE_ROOM.pillars,...(world.castleWalls||[])];
  if(area()==='cave')return world.caveWalls||[];
  return [...ARENA_BUILDINGS.map(b=>({x:b.x-5,y:b.y+5,w:b.w+10,h:b.h})),...ARENA_LANDMARKS.filter(p=>p.kind==='house'),...world.walls,...materialObstacles()];
 }
 function bounds(){return inArenaCastle(world)?CASTLE_ROOM.bounds:area()==='cave'?caveRoom()?.bounds||{minX:0,maxX:0,minY:0,maxY:0}:ARENA_WORLD_BOUNDS;}
 function blocked(x,y,padding=12,{vehicle=Boolean(world.driving),airborne=false}={}){
  const b=bounds(),inset=indoors()?padding:0,surface=surfaceAt(x,y);
  return !surface||vehicle&&(surface.kind==='water'||surface.slope>.30)||!vehicle&&!airborne&&surface.kind!=='water'&&!surface.climbable||x<b.minX+inset||x>b.maxX-inset||y<b.minY+inset||y>b.maxY-inset||walls().some(b=>x>b.x-padding&&x<b.x+b.w+padding&&y>b.y-padding&&y<b.y+b.h+padding);
 }
 function actorHeight(actor){
  const surface=surfaceAt(actor.x,actor.y);if(!surface)return 0;
  if(actor===world.player)return world.groundHeight+1.2+(world.jumpHeight||0);
  const enemy=actor.kind?actor:world.robots.find(r=>Math.hypot(r.x-actor.x,r.y-actor.y)<.1);
  return enemy?.kind==='drone'?Math.max(surface.height,surface.waterLevel??-Infinity)+enemy.altitude:surface.height+1.2;
 }
 function lineClear(a,b){
  const obstacles=walls(),steps=Math.ceil(distance(a,b)/8),from=actorHeight(a),to=actorHeight(b);
  for(let i=1;i<steps;i++){const t=i/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,surface=surfaceAt(x,y);if(!surface||surface.height>from+(to-from)*t-.1||obstacles.some(o=>x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h))return false;}return true;
 }
 function clipShot(from,to){
  const obstacles=walls(),steps=Math.max(1,Math.ceil(distance(from,to)/8));let accepted={...from};
  for(let i=1;i<=steps;i++){const t=i/steps,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,height=from.height+(to.height-from.height)*t,surface=surfaceAt(x,y);if(!surface||surface.height>height-.1||obstacles.some(o=>x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h))return accepted;accepted={x,y,height};}return accepted;
 }
 function visibleLoot(){return area()==='cave'?[]:visibleArenaLoot(world);}
 function nearbySites(){return ARENA_LANDMARKS.filter(site=>['dig','find'].includes(site.kind)&&(site.area||'island')===area()&&(area()!=='cave'||site.caveId===world.caveId)&&!world.exploration.finds.includes(site.id));}
 function nearestInteraction(){
  if(!world)return null;
  if(area()==='island'&&world.driving){const station=ARENA_BUILDINGS.find(v=>v.id==='benzinaio');if(distance(world.player,station.door)<105)return{kind:'fuel',label:'Rifornisci l’auto',item:station};return{kind:'exit-car',label:'Scendi dall’auto'};}
  const loot=visibleLoot().filter(v=>!v.opened).map(item=>({kind:'loot',item,position:arenaLootPosition(world,item),label:inArenaCastle(world)?'Apri il tesoro · 10 domande':`Apri: ${item.rarity}`}));
  let places;
  if(inArenaCastle(world))places=[{kind:'castle-exit',item:CASTLE_ROOM.exit,label:'Attraversa l’uscita'}];
  else if(area()==='cave')places=[{kind:'cave-exit',item:caveRoom().exit,label:'Attraversa l’uscita della grotta'}];
  else places=[...world.cars.map(item=>({kind:'car',item,label:'Sali in auto'})),...ARENA_BUILDINGS.map(item=>({kind:item.id,item:{...item,...item.door},label:item.id==='casa'?'Riposa e usa il medikit':item.id==='negozio'?'Entra nel negozio':item.id==='benzinaio'?'Rifornimento auto':'Esplora il castello'})),...ARENA_LANDMARKS.filter(item=>item.kind==='house').map(item=>({kind:'casa',item:item.door,label:'Riposa al rifugio'})),...CAVE_ROOMS.map(room=>({kind:'cave',item:room.portal,caveId:room.id,label:'Entra nella grotta'})),...world.robots.filter(item=>item.alive&&lineClear(world.player,item)).map(item=>({kind:'robot',item,radius:85,label:robotChallenges.has(item.id)?'Riprendi le due domande':item.kind==='drone'?'Rispondi al drone':'Parla al robot'}))];
  const sites=nearbySites().map(item=>({kind:item.kind==='dig'&&world.exploration.dig[item.id]<3?'dig':'discovery',item,label:item.kind==='dig'?(world.exploration.dig[item.id]<3?'Scava con il piccone':'Studia il reperto · 2 domande'):'Scopri il reperto · 2 domande'}));
  return [...loot,...sites,...places].filter(v=>distance(world.player,v.position||v.item)<(v.radius||68)).sort((a,b)=>distance(world.player,a.position||a.item)-distance(world.player,b.position||b.item))[0]||null;
 }
 function resetAreaMovement(){
  stop();jumpState={height:0,velocity:0,grounded:true};world.jumpHeight=0;world.destination=null;world.shots=[];world.enemyShots=[];world.harvestFlash=null;buildOpen=false;shotUntil=0;aimTarget=null;pendingEncounter=null;updateSurface();
 }
 function canChangeArea(){return !pendingEncounter&&checkAccess()&&run?.phase==='active'&&!quest&&!summaryOpen&&!buildOpen&&!paused&&!loading&&!saving&&!store.hasPending;}
 function changeCastleArea(enter){
  if(!canChangeArea())return;
  if(enter){if(area()!=='island')return;world=enterArenaCastle(world);}else{if(!inArenaCastle(world))return;world=leaveArenaCastle(world);}
  resetAreaMovement();status(enter?'Sei nella sala del tesoro. Il rifornimento leggendario richiede 10 domande del tuo argomento.':'Sei tornato davanti al castello. Il lavoro già ottenuto resta tuo.');render();
 }
 function changeCaveArea(enter,id=null){
  if(!canChangeArea())return;
  try{world=enter?enterArenaCave(world,id):leaveArenaCave(world);resetAreaMovement();status(enter?'Sei nella grotta. Cerca il reperto luminoso; l’uscita resta sempre disponibile.':'Sei tornato all’ingresso della grotta.');render();}catch(e){error(e);}
 }
 function interact(){
  if(!canChangeArea())return;const next=nearestInteraction();if(!next){status(indoors()?'Avvicinati a un reperto oppure usa il pulsante di uscita.':'Avvicinati a un robot, a una cassa o a un luogo della mappa. Apri Dove andare sull’isola per orientarti.');return;}
  if(next.kind==='castle-exit'){changeCastleArea(false);return;}
  if(next.kind==='cave-exit'){changeCaveArea(false);return;}
  if(next.kind==='cave'){changeCaveArea(true,next.caveId);return;}
  if(next.kind==='discovery'){beginDiscoveryQuest(next.item.id);return;}
  if(next.kind==='dig'){harvest();return;}
  if(next.kind==='loot'||next.kind==='robot'){beginQuest(next.kind,next.item);return;}
  if(next.kind==='car'){world.driving=next.item.id;world.player.x=next.item.x;world.player.y=next.item.y;world.destination=null;jumpState={height:0,velocity:0,grounded:true};world.jumpHeight=0;updateSurface();status(viewMode==='3d'?'Sei in auto. Usa il joystick o le frecce per guidare.':'Sei in auto. Usa la mappa o le frecce per guidare.');}
  else if(next.kind==='exit-car'){
   const p=world.player,exit=[[0,46],[0,-46],[46,0],[-46,0],[38,38],[-38,38],[38,-38],[-38,-38]].map(([x,y])=>({x:p.x+x,y:p.y+y})).find(v=>!blocked(v.x,v.y,12,{vehicle:false}));
   if(!exit){status('Non c’è spazio per scendere qui. Sposta l’auto in uno spazio libero.');return;}
   world.driving=null;p.x=exit.x;p.y=exit.y;updateSurface();status('Sei sceso dall’auto.');
  }
  else if(next.kind==='fuel'){world.cars.find(c=>c.id===world.driving).fuel=100;status('Auto rifornita. Puoi proseguire. Per scendere allontanati dalla pompa.');}
  else if(next.kind==='negozio'){tab='Shop';paused=true;}
  else if(next.kind==='casa'){summaryOpen=true;}
  else if(next.kind==='castello'){changeCastleArea(true);return;}
  else status('Avvicinati al benzinaio con una delle auto dell’isola.');render();
 }
 function reload(){
  if(!canChangeArea()||world.driving)return;
  const next=startArenaReload(world.combat);if(next===world.combat)return;
  world.combat=next;fireHeld=false;status('Ricarico. Puoi continuare a muoverti.');paintActors();animate();
 }
 function toggleAim(){
  if(!canChangeArea()||world.driving)return;world.aiming=!world.aiming;paintActors();animate();
 }
 function fire(){
  if(!canChangeArea())return;if(indoors()){status('Qui puoi cercare un reperto e usare Interagisci.');return;}if(world.driving){status('Scendi dall’auto per usare lo strumento.');return;}
  if(!canFireArenaWeapon(world.weaponId,elapsed,lastWeaponShot))return;
  const taken=takeArenaCombatShot(world.combat);world.combat=taken.state;
  if(!taken.fired){if(world.combat.reloadRemaining>0)status('Ricarico. Puoi continuare a muoverti.');paintActors();return;}
  const weapon=arenaWeapon(world.weaponId),p=world.player;if(viewMode==='3d'&&scene3D)p.angle=scene3D.getYaw()-Math.PI/2;
  const cone=viewMode==='2d'?.7:world.aiming?.16:.23;
  const targets=world.robots.filter(r=>r.alive&&r.hp>0&&distance(p,r)<weapon.range&&lineClear(p,r)).filter(r=>Math.abs(Math.atan2(Math.sin(Math.atan2(r.y-p.y,r.x-p.x)-p.angle),Math.cos(Math.atan2(r.y-p.y,r.x-p.x)-p.angle)))<cone).sort((a,b)=>distance(p,a)-distance(p,b));
  const target=targets[0],to=target?{x:target.x,y:target.y,height:actorHeight(target)}:{x:p.x+Math.cos(p.angle)*weapon.range,y:p.y+Math.sin(p.angle)*weapon.range,height:actorHeight(p)};
  const from={x:p.x,y:p.y,height:actorHeight(p)};world.shots=createArenaWeaponShots({weapon:weapon.id,from,to:clipShot(from,to),elapsed}).slice(0,taken.rounds);lastWeaponShot=elapsed;shotUntil=Math.max(...world.shots.map(s=>s.expiresAt));
  if(target){
   const impact=hitArenaEnemy(target,{damage:taken.damage});Object.assign(target,impact.enemy);
   if(impact.hit){world.combat={...world.combat,hits:world.combat.hits+1};world.hitFlash={enemyId:target.id,x:target.x,y:target.y,groundHeight:actorHeight(target),expiresAt:elapsed+.22};}
   if(impact.defeated){pendingEncounter={item:target,endsAt:elapsed+Math.min(.55,Math.max(.24,weapon.duration+(weapon.count>1?.13:0)))};keys.clear();joystick={x:0,y:0};sprintEnabled=false;fireHeld=false;firePointer=null;world.destination=null;status('Guardiano fermato. Ora due domande del tuo argomento.');refreshLocks();}
   else{world=requestArenaEnemyCover(world,target.id,{elapsed,obstacles:walls(),isFree:(x,y,enemy)=>!blocked(x,y,enemy.kind==='drone'?7:12,{vehicle:false,airborne:enemy.kind==='drone'}),lineClear:(from)=>lineClear(from,world.player)});status(`A segno: ${target.hp} scudi rimasti. Il guardiano cerca riparo.`);}
  }else if(!fireHeld)status('Regola la mira sul guardiano. I ripari fermano i colpi.');
  paintActors();animate();
 }
 function harvest(){
  if(!checkAccess()||quest||summaryOpen||buildOpen||paused||loading||saving||store.hasPending||run?.phase!=='active')return;
  if(indoors()){status('Qui non ci sono alberi o muri da raccogliere. Cerca il reperto e premi Interagisci.');return;}
  if(world.driving){status('Scendi dall’auto prima di usare il piccone.');return;}
  try{
   const dig=nearbySites().find(site=>site.kind==='dig'&&distance(world.player,site)<=60);
   if(dig){if(world.exploration.dig[dig.id]>=3){beginDiscoveryQuest(dig.id);return;}world=strikeArenaDig(world,dig.id);const hits=world.exploration.dig[dig.id];status(hits===3?'Hai scoperto un reperto. Premi Interagisci e rispondi a due domande.':`Scavo: ${hits} colpi su 3. Continua con Piccone.`);render();return;}
   const node=nearestArenaNode(world.materials,world.player);if(!node){status('Avvicinati a un albero o a un muro. Servono tre colpi di piccone per raccogliere i materiali.');return;}
   const result=strikeArenaNode(world.materials,node.id,{player:world.player});world.materials=result.materials;world.harvestFlash={id:node.id,expiresAt:elapsed+.3};
   const hit=result.hit;status(hit.destroyed?`Raccolti +${hit.gained.wood||hit.gained.brick} ${hit.kind==='tree'?'legno':'mattoni'}. Premi Riparo per scegliere cosa costruire.`:`${hit.kind==='tree'?'Albero':'Muro'} colpito. ${hit.remaining===1?'Resta 1 colpo':`Restano ${hit.remaining} colpi`} di piccone.`);render();
  }catch(e){error(e);}
 }
 function build(){
  if(!checkAccess()||!buildMode||quest||summaryOpen||buildOpen||paused||loading||saving||store.hasPending||run?.phase!=='active')return;
  if(world.driving){status('Scendi dall’auto prima di costruire.');return;}
  buildOpen=true;error('');render();q('[data-ia-build-menu] h2')?.focus({preventScroll:true});
 }
 function placeBuild(kind){
  if(!checkAccess()||!buildOpen||quest||summaryOpen||paused||loading||saving||store.hasPending||run?.phase!=='active'||world.driving)return;
  try{
   const areaWalls=inArenaCastle(world)?world.castleWalls:area()==='cave'?(world.caveWalls||= []):world.walls,b=bounds(),w=b.maxX-b.minX,h=b.maxY-b.minY;
   const borders=[{x:b.minX-20,y:b.minY-20,w:20,h:h+40},{x:b.maxX,y:b.minY-20,w:20,h:h+40},{x:b.minX,y:b.minY-20,w,h:20},{x:b.minX,y:b.maxY,w,h:20}];
   const obstacles=walls(),player={...world.player};if(viewMode==='3d'&&scene3D)player.angle=scene3D.getYaw()-Math.PI/2;
   const intersects=(a,o)=>a.x<o.x+o.w&&a.x+a.w>o.x&&a.y<o.y+o.h&&a.y+a.h>o.y;
   const canPlace=rect=>[[rect.x,rect.y],[rect.x+rect.w,rect.y],[rect.x,rect.y+rect.h],[rect.x+rect.w,rect.y+rect.h]].every(([x,y])=>{const surface=surfaceAt(x,y);return surface&&surface.kind!=='water'&&surface.climbable;})&&rect.x>=b.minX+2&&rect.y>=b.minY+2&&rect.x+rect.w<=b.maxX-2&&rect.y+rect.h<=b.maxY-2&&!obstacles.some(o=>intersects(rect,o))&&(!indoors()||distance({x:rect.x+rect.w/2,y:rect.y+rect.h/2},inArenaCastle(world)?CASTLE_ROOM.exit:caveRoom().exit)>=90);
   const placed=placeArenaShelter(world.materials,{kind,player,existingWalls:[...obstacles,...borders],canPlace});
   world.materials=placed.materials;areaWalls.push(...placed.walls);buildOpen=false;error('');status('Riparo costruito con i materiali di questo giro.');render();
  }catch(e){error(e);}
 }
 function canPlay(){return (viewMode!=='3d'||Boolean(scene3D))&&!accessLocked&&tab==='Gioca'&&run?.phase==='active'&&!quest&&!summaryOpen&&!buildOpen&&!paused&&!loading&&!saving&&!store.hasPending;}
 function canMove(){return !pendingEncounter&&canPlay();}
 function animate(){if(frame===null&&canPlay()&&!document.hidden)frame=requestAnimationFrame(tick);}
 function tick(time){
  frame=null;if(!profileCurrent()||!canPlay()||document.hidden)return;
  const dt=lastTime?Math.min(.05,(time-lastTime)/1000):0;lastTime=time;elapsed+=dt;
  if(pendingEncounter){const encounter=pendingEncounter;paintActors(dt);if(elapsed>=encounter.endsAt){pendingEncounter=null;refreshLocks();beginQuest('robot',encounter.item).catch(error);}else animate();return;}
  world.combat=advanceArenaCombat(world.combat,{dt,active:true});
  if(fireHeld&&!world.driving&&!indoors()){fire();if(pendingEncounter){paintActors(dt);animate();return;}}
  const p=world.player;let dx=0,dy=0;
  if(viewMode==='3d'){
   const strafe=(keys.has('right')?1:0)-(keys.has('left')?1:0)+joystick.x;
   let forward=(keys.has('up')?1:0)-(keys.has('down')?1:0)+joystick.y;if(sprintEnabled&&!strafe&&!forward&&!world.driving)forward=1;
   const vector=cameraRelativeMove(strafe,forward,scene3D?.getYaw()||0);dx=vector.x;dy=vector.y;world.destination=null;
  }else{
   dx=(keys.has('right')?1:0)-(keys.has('left')?1:0);dy=(keys.has('down')?1:0)-(keys.has('up')?1:0);
   if(dx||dy)world.destination=null;else if(world.destination){const d=distance(p,world.destination);if(d<5)world.destination=null;else{dx=(world.destination.x-p.x)/d;dy=(world.destination.y-p.y)/d;}}
   const length=Math.hypot(dx,dy);if(length>1){dx/=length;dy/=length;}
  }
  const car=world.driving&&world.cars.find(c=>c.id===world.driving),oldGround=world.groundHeight||0,oldAbsolute=oldGround+jumpState.height;
  if(dx||dy){
   const running=sprintEnabled||keys.has('sprint'),mode=world.movementMode,speed=(car?car.fuel>0?205:0:mode==='swim'?running?110:75:mode==='climb'?running?100:65:running?170:105)*dt,angle=Math.atan2(dy,dx),nx=p.x+dx*speed,ny=p.y+dy*speed;
   let x=p.x,y=p.y;if(!blocked(nx,y,car?21:12))x=nx;if(!blocked(x,ny,car?21:12))y=ny;
   if(car){const motion=resolveArenaCarMotion(car,world.cars,{x,y,angle}),travel=Math.hypot(motion.x-car.x,motion.y-car.y);p.x=car.x=motion.x;p.y=car.y=motion.y;p.angle=car.angle=motion.angle;if(travel>.001)car.fuel=Math.max(0,car.fuel-dt*1.2);}
   else{p.x=x;p.y=y;p.angle=angle;}
  }
  updateSurface();
  if(!car&&world.movementMode!=='swim'){
   // While airborne, preserve absolute height as the terrain rises or falls.
   // Grounded walking follows small slopes; a ledge starts a real fall.
   if(!jumpState.grounded||oldGround-world.groundHeight>.35){const height=Math.max(0,oldAbsolute-world.groundHeight);jumpState=height>0?{height,velocity:jumpState.velocity,grounded:false}:{height:0,velocity:0,grounded:true};}
   jumpState=advanceArenaJump(jumpState,dt,{trigger:jumpQueued});world.jumpHeight=jumpState.height;
  }else{jumpState={height:0,velocity:0,grounded:true};world.jumpHeight=0;}jumpQueued=false;
  if(world.harvestFlash?.expiresAt<=elapsed)world.harvestFlash=null;if(world.hitFlash?.expiresAt<=elapsed)world.hitFlash=null;
  world.enemyShots=(world.enemyShots||[]).filter(shot=>shot.expiresAt>elapsed);world.shots=(world.shots||[]).filter(shot=>shot.expiresAt>elapsed);
  if(!indoors()){
   world=advanceArenaEnemies(world,{dt,elapsed,active:true,isFree:(x,y,enemy)=>!blocked(x,y,enemy.kind==='drone'?7:12,{vehicle:false,airborne:enemy.kind==='drone'}),lineClear:(from)=>lineClear(from,world.player)});
   const attack=nextArenaRobotAttack({...world,robots:world.robots.filter(enemy=>enemy.hp>0)},{elapsed,lastAttack:lastDamage,lineClear:(from)=>lineClear(from,world.player)});lastDamage=attack.lastAttack;
   if(attack.shot){const enemy=world.robots.find(r=>r.id===attack.shot.robotId);world.enemyShots.push({...attack.shot,fromHeight:actorHeight(enemy||attack.shot.from),toHeight:actorHeight(world.player)});}
   if(attack.damage){run=damageArenaRun(run,attack.damage);status('Il robot ti ha colpito: meno 5 energie. Puoi spostarti o usare un riparo.');if(run.phase==='rest'){render();return;}}
  }
  const study=advanceArenaStudyClock(world.exploration,{dt,active:true});world.exploration=study.state;
  paintActors(dt);
  if(study.request&&elapsed>=studyRetryAt){beginDiscoveryQuest().catch(e=>{studyRetryAt=elapsed+15;error(e);});return;}
  animate();
 }
 function paintActors(dt=0){
  if(!world)return;
  const viewport=q('[data-ia-viewport]');if(viewport){viewport.dataset.iaStudyInterval=String(ARENA_STUDY_INTERVAL_SECONDS);viewport.dataset.iaExpeditionComplete=String(arenaExpeditionProgress(world.expedition).complete);viewport.dataset.iaAmmo=String(world.combat.ammo);viewport.dataset.iaReload=String(world.combat.reloadRemaining);viewport.dataset.iaAiming=String(Boolean(world.aiming));viewport.dataset.iaEnemyShots=String((world.enemyShots||[]).filter(shot=>shot.expiresAt>elapsed).length);viewport.dataset.iaLastRobotShot=String(lastDamage);viewport.dataset.iaWood=String(world.materials.wood);viewport.dataset.iaBrick=String(world.materials.brick);viewport.dataset.iaSurface=world.surfaceKind||'land';viewport.dataset.iaGround=String(world.groundHeight||0);viewport.dataset.iaMode=world.movementMode||'walk';viewport.dataset.iaArea=area();viewport.dataset.iaCaveId=world.caveId||'';viewport.dataset.iaStudySeconds=String(world.exploration.activeSeconds);viewport.dataset.iaStudyPending=String(Boolean(world.exploration.pending));viewport.dataset.iaWeapon=world.weaponId;viewport.dataset.iaEncounterPending=String(Boolean(pendingEncounter));}
  updateArenaMissionHUD(dialog,world);
  const ammo=q('span[data-ia-ammo]');if(ammo){const text=world.combat.reloadRemaining>0?'Ricarico…':`${world.combat.ammo} / ${world.combat.capacity}`;if(ammo.textContent!==text)ammo.textContent=text;}
  const aim=q('[data-ia-action="aim"]');if(aim){aim.setAttribute('aria-pressed',String(Boolean(world.aiming)));aim.classList.toggle('selected',Boolean(world.aiming));}q('[data-ia-viewport]')?.classList.toggle('ia-hit-confirmed',Boolean(world.hitFlash?.expiresAt>elapsed));
  const health=q('[data-ia-health]');if(health){health.textContent=run.health;health.previousElementSibling.value=run.health;}
  const car=world.driving&&world.cars.find(c=>c.id===world.driving);if(car&&q('[data-ia-fuel]'))q('[data-ia-fuel]').textContent=`${Math.round(car.fuel)}%`;
  const wood=q('strong[data-ia-wood]'),brick=q('strong[data-ia-brick]');if(wood)wood.textContent=world.materials.wood;if(brick)brick.textContent=world.materials.brick;
  const compass=q('[data-ia-compass]');if(compass){const yaw=scene3D?.getYaw()??(world.player.angle+Math.PI/2),index=((Math.round(yaw/(Math.PI/4))%8)+8)%8;compass.textContent=['nord','nord-est','est','sud-est','sud','sud-ovest','ovest','nord-ovest'][index];}const location=q('[data-ia-location]');if(location)location.textContent=area()==='cave'?'Grotta':inArenaCastle(world)?'Castello':world.movementMode==='swim'?'Nuoti':world.movementMode==='climb'?'Sul sentiero':'Esplora l’isola';
  const interactButton=q('[data-ia-interact]');if(interactButton)interactButton.textContent=nearestInteraction()?.label||'Interagisci';
  if(viewMode==='3d'){updateScene(dt);return;}
  if(!q('[data-ia-map]'))return;const p=world.player;
  const player=q('[data-ia-player]');player.setAttribute('transform',`translate(${p.x} ${p.y})`);player.style.display=world.driving?'none':'';player.querySelector('[data-ia-aim]')?.setAttribute('transform',`rotate(${p.angle*180/Math.PI})`);
  const pet=q('[data-ia-pet]');pet?.setAttribute('transform',`translate(${p.x-31} ${p.y+22})`);if(pet)pet.style.display=world.driving?'none':'';
  for(const car of world.cars)q(`[data-ia-car="${car.id}"]`)?.setAttribute('transform',`translate(${car.x} ${car.y}) rotate(${car.angle*180/Math.PI})`);
  for(const robot of world.robots){const node=q(`[data-ia-robot="${robot.id}"]`);if(node){node.style.display=robot.alive?'':'none';node.setAttribute('transform',`translate(${robot.x} ${robot.y})`);node.classList.toggle('ia-targeted',aimTarget===robot.id);node.classList.toggle('ia-enemy-hit',world.hitFlash?.enemyId===robot.id&&world.hitFlash.expiresAt>elapsed);node.dataset.iaEnemyHp=String(robot.hp);const hp=node.querySelector('[data-ia-enemy-health]');if(hp)hp.setAttribute('width',String(40*Math.max(0,robot.hp)/robot.maxHp));}}
  for(const loot of visibleLoot()){const node=q(`[data-ia-loot="${loot.id}"]`);if(node){const pos=arenaLootPosition(world,loot);node.style.display=loot.opened?'none':'';node.setAttribute('transform',`translate(${pos.x} ${pos.y})`);}}
  q('[data-ia-walls]').innerHTML=(inArenaCastle(world)?world.castleWalls:area()==='cave'?world.caveWalls||[]:world.walls).map(b=>`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" data-ia-wall-material="${b.material||'wood'}" fill="${b.material==='brick'?'#b96f59':'#b88b5a'}" stroke="${b.material==='brick'?'#7d4d41':'#694e3a'}" stroke-width="3"/>`).join('');
  for(const node of dialog.querySelectorAll('g[data-ia-resource][transform]'))node.removeAttribute('transform');
  if(world.harvestFlash?.expiresAt>elapsed){const node=q(`g[data-ia-resource="${world.harvestFlash.id}"]`);node?.setAttribute('transform',`translate(${Math.sin((world.harvestFlash.expiresAt-elapsed)*50)*3} 0)`);}
  const marker=q('[data-ia-destination]');marker.toggleAttribute('hidden',!world.destination);if(world.destination){marker.setAttribute('cx',world.destination.x);marker.setAttribute('cy',world.destination.y);}
  const shot=q('[data-ia-shot]');if(shot){const active=world.shots.filter(s=>(s.startsAt??0)<=elapsed&&s.expiresAt>elapsed);shot.toggleAttribute('hidden',!active.length);shot.innerHTML=arenaShotsSVG(active,elapsed);}
  const enemy=q('g[data-ia-enemy-shots]');if(enemy)enemy.innerHTML=(world.enemyShots||[]).filter(s=>s.expiresAt>elapsed).map(s=>`<path data-ia-enemy-shot d="M${s.from.x} ${s.from.y}L${s.to.x} ${s.to.y}" stroke="#e96b36" stroke-width="6" stroke-linecap="round" fill="none"/>`).join('');
 }
 function bindMap(){
  const viewport=q('[data-ia-viewport]');
  const map=q('[data-ia-map]');map?.addEventListener('pointerdown',event=>{
   if(viewMode!=='2d'||!checkAccess()||!canMove())return;event.preventDefault();const point=map.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const pos=point.matrixTransform(map.getScreenCTM().inverse());
   const robotId=event.target.closest('[data-ia-robot]')?.dataset.iaRobot;
   if(robotId){const robot=world.robots.find(r=>r.id===robotId);aimTarget=robot.id;world.player.angle=Math.atan2(robot.y-world.player.y,robot.x-world.player.x);world.destination=null;status('Robot mirato. Avvicinati se serve, poi premi Colpisci.');}
   else{const b=bounds(),inset=indoors()?12:0;world.destination={x:clamp(pos.x,b.minX+inset,b.maxX-inset),y:clamp(pos.y,b.minY+inset,b.maxY-inset)};aimTarget=null;}
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
  const fireButton=q('[data-ia-action="fire"]');let firePrevious=null;
  if(viewMode==='3d'&&fireButton){
   fireButton.addEventListener('pointerdown',event=>{if(firePointer!==null||!checkAccess()||!canMove()||world.driving||indoors())return;event.preventDefault();firePointer=event.pointerId;firePrevious={x:event.clientX,y:event.clientY};fireHeld=true;fireButton.setPointerCapture(event.pointerId);fire();animate();});
   fireButton.addEventListener('pointermove',event=>{if(event.pointerId!==firePointer||!firePrevious||!canMove()||!scene3D)return;event.preventDefault();scene3D.look(event.clientX-firePrevious.x,event.clientY-firePrevious.y);firePrevious={x:event.clientX,y:event.clientY};paintActors();});
   for(const type of ['pointerup','pointercancel','lostpointercapture'])fireButton.addEventListener(type,event=>{if(event.pointerId!==firePointer)return;fireHeld=false;firePointer=null;firePrevious=null;});
  }
 }
 function resizeScene(){if(scene3D&&sceneHost?.isConnected){try{scene3D.resize();updateScene();}catch{fallback3D('Il 3D è stato sospeso. Puoi continuare nella visuale dall’alto.');}}}
 const keyMap={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
 function keydown(event){
  if(event.target.closest('input,textarea,select,button,summary,a,[contenteditable="true"]')||!checkAccess()||!canMove())return;
  if(keyMap[event.key]){event.preventDefault();keys.add(keyMap[event.key]);animate();}
  else if(event.key==='Shift'){event.preventDefault();keys.add('sprint');}
  else if(event.code==='Space'){event.preventDefault();if(!event.repeat){if(viewMode==='3d'&&!world.driving){jumpQueued=true;animate();}else if(viewMode==='2d')fire();}}
  else if((event.key==='r'||event.key==='R')&&!event.repeat){event.preventDefault();reload();}
  else if((event.key==='t'||event.key==='T')&&!event.repeat){event.preventDefault();harvest();}
  else if(event.key==='f'||event.key==='F'){event.preventDefault();if(!event.repeat){fireHeld=true;fire();animate();}}
  else if((event.key==='q'||event.key==='Q')&&!event.repeat){event.preventDefault();toggleAim();}
  else if((event.key==='e'||event.key==='E')&&!event.repeat){event.preventDefault();interact();}
 }
 function keyup(event){if(keyMap[event.key])keys.delete(keyMap[event.key]);if(event.key==='Shift')keys.delete('sprint');if(event.key==='f'||event.key==='F')fireHeld=false;}
 function blur(){keys.clear();stop();if(run&&canPlay()){paused=true;render();}}
 function visibility(){if(!checkAccess())return;if(document.hidden)blur();}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('submit',event=>{if(event.target.matches('[data-ia-summary-form]')){event.preventDefault();saveSummary(event.target);}});
 dialog.addEventListener('input',event=>{if(event.target.matches('[data-ia-summary]'))lastSummary=event.target.value;});
 dialog.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.iaAction==='close'){close();return;}if(button.dataset.iaAction==='unlock'){unlock().catch(error);return;}if(!checkAccess())return;
  if(pendingEncounter&&!['pause','resume'].includes(button.dataset.iaAction)){status('Attendi l’incontro con il robot oppure metti in pausa.');return;}
  if(button.dataset.iaTab){if(quest||summaryOpen||buildOpen){status('Chiudi la domanda o la scelta del riparo prima di cambiare sezione.');return;}tab=button.dataset.iaTab;render();return;}
  if(button.hasAttribute('data-ia-answer')){respond(Number(button.dataset.iaAnswer));return;}
  const action=button.dataset.iaAction;
  if(action==='close'){close();return;}if(action==='retry'){retry();return;}if(saving||store.hasPending||loading)return;
  if(action==='source')changeSource();else if(action==='start')start();else if(action==='view-2d'||action==='view-3d'){viewMode=action==='view-3d'?'3d':'2d';if(world){world.destination=null;world.jumpHeight=0;}jumpState={height:0,velocity:0,grounded:true};render();if(run&&!quest&&!summaryOpen&&!buildOpen)dialog.scrollTo(0,0);}else if(action==='build-on'||action==='build-off'){buildMode=action==='build-on';render();}
  else if(action==='equip')transact(p=>equipArenaItem(p,button.dataset.item));else if(action==='buy')transact(p=>buyArenaItem(p,button.dataset.item),()=>{if(ARENA_CATALOG.find(item=>item.id===button.dataset.item)?.type==='pet')status('Compagno aggiunto all’Armadietto. Aprilo e premi Scegli per portarlo con te.');});else if(action==='claim')transact(p=>claimArenaMission(p,button.dataset.mission));
  else if(action==='pause'||action==='resume'){if(world?.exploration.pending&&!quest){resumeStudy();return;}paused=action==='resume'?false:!paused;render();}else if(action==='lobby'){if(!confirm('Tornare alla lobby? Crediti e oggetti già ottenuti restano salvati.'))return;disposeScene();run=null;quest=null;summaryOpen=false;buildOpen=false;tab='Gioca';render();}
  else if(action==='run'){if(world.driving)return;sprintEnabled=!sprintEnabled;button.textContent=sprintEnabled?'Ferma corsa':'Corri';button.setAttribute('aria-pressed',String(sprintEnabled));button.classList.toggle('selected',sprintEnabled);animate();}else if(action==='jump'){if(canMove()&&!world.driving){jumpQueued=true;animate();}}else if(action==='cave-exit')changeCaveArea(false);else if(action==='study')resumeStudy();else if(action==='castle-exit')changeCastleArea(false);else if(action==='interact')interact();else if(action==='fire'){if(event.detail>0&&viewMode==='3d')return;fire();}else if(action==='reload')reload();else if(action==='aim')toggleAim();else if(action==='harvest')harvest();else if(action==='build')build();else if(action==='place-build')placeBuild(button.dataset.iaBuildKind);else if(action==='cancel-build'){buildOpen=false;render();}else if(action==='next')nextQuestion();else if(action==='cancel-quest'){if(quest?.discovery){discoveryQuest=quest;paused=true;status('Ripasso in pausa. Il giro e il tempo restano fermi finché premi Riprendi il ripasso.');}if(quest?.kind==='robot'&&!quest.discovery)robotChallenges.set(quest.item.id,quest);quest=null;render();}
  else if(action==='summary'){if(quest||buildOpen||paused)return;if(run?.phase!=='active'){status('Riparti con energia nuova prima di usare il medikit.');return;}summaryOpen=true;render();}else if(action==='cancel-summary'){summaryOpen=false;render();}
  else if(action==='restart'){jumpState={height:0,velocity:0,grounded:true};world.jumpHeight=0;world.enemyShots=[];world.shots=[];world.harvestFlash=null;buildOpen=false;shotUntil=0;run=restartArenaRun(run);if(inArenaCastle(world))world=leaveArenaCastle(world);if(area()==='cave')world=leaveArenaCave(world);world.player.x=495;world.player.y=320;if(viewMode==='3d')world.player.angle=(scene3D?.getYaw()||0)-Math.PI/2;world.driving=null;world.destination=null;updateSurface();render();}
  if(event.detail>0&&canMove())q('[data-ia-viewport]')?.focus({preventScroll:true});
 });
 document.body.append(dialog);dialog.showModal();window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);window.addEventListener('focus',checkAccess);window.addEventListener('storage',checkAccess);document.addEventListener('visibilitychange',visibility);document.addEventListener('skooling:game-access-changed',checkAccess);window.addEventListener('resize',resizeScene);watch=setInterval(checkAccess,1000);
 try{profile=await store.load();if(checkAccess())render();}catch(e){error(e);q('[data-ia-content]').innerHTML='<p>Non riesco ad aprire il profilo del gioco. I dati precedenti restano conservati. Chiudi e riapri l’isola per riprovare.</p>';}
}
