import {DB,DB_NAME} from './db.js';
import {activeDatabaseName} from './students.js';
import {readGameAccess,ensureGameAccess} from './game-access.js';
import {chooseGameQuestions,assertGameSelectionAvailable} from './game-source-picker.js';
import {newGameRun,hitTarget,answerQuestion,resumeArena,movePilot,dronePositions,alignedTarget} from './study-game-model.js';

const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const droneSVG='<svg viewBox="0 0 96 64" aria-hidden="true"><path d="M12 26 0 16v26l22-6m62-10 12-10v26l-22-6" fill="#816ff0"/><path d="m18 18 20-12h20l20 12v28L58 58H38L18 46Z" fill="#5bdcd6" stroke="#e2ffff" stroke-width="2"/><path d="m27 27 14-8h14l14 8v13l-14 8H41L27 40Z" fill="#182b55"/><path d="M36 33h24" stroke="#f9d680" stroke-width="5" stroke-linecap="round"/></svg>';
const shipSVG='<svg viewBox="0 0 90 94" aria-hidden="true"><path d="m45 2 18 43 24 24-27-4-15 22-15-22-27 4 24-24Z" fill="#fff7d9" stroke="#6ce4e5" stroke-width="3"/><path d="m45 17 9 32-9 17-9-17Z" fill="#8b82ff"/><path d="m35 76 10 16 10-16" fill="#ffbc6d"/></svg>';

export async function openStudyGame(requestedTopic=null){
 if(!await ensureGameAccess())return;
 if(document.querySelector('.study-game-dialog[open],.island-arena-dialog[open],.game-source-dialog[open]')||!readGameAccess().allowed)return;
 const returnFocus=document.activeElement,session=DB.session,reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 let closed=false,epoch=0,selection=null,lastQuestionIds=[],run=null,pilot=.5,elapsed=0,frame=null,lastFrame=0,direction=0,paused=false,checking=false,impactTimer=null,accessWatch=null,loading=false;
 const dialog=document.createElement('dialog');dialog.className='study-game-dialog';dialog.setAttribute('aria-label','Missione Orbita, gioca e ripassa');
 dialog.innerHTML=`<header class="sg-header"><div><p class="sg-kicker">Gioca e ripassa</p><h2>Missione Orbita</h2></div><button class="sg-close" type="button" aria-label="Chiudi il gioco" data-sg-close>×</button></header><main class="sg-main"><section data-sg-setup><div class="sg-intro"><div><span class="sg-tag">Un bersaglio, una domanda</span><h3>La prossima scoperta è in orbita.</h3><p>Pilota la navicella e colpisci un drone. Il volo si ferma: rispondi con calma e riparti.</p><ol><li>Scegli l’argomento.</li><li>Tocca un drone oppure usa navicella e laser.</li><li>Risolvi la domanda per proseguire. Puoi riprovare.</li></ol></div><div class="sg-orbit-art" aria-hidden="true"><i></i><i></i><div>${shipSVG}</div><b>${droneSVG}</b></div></div><div class="sg-config"><p class="sg-note">Scegli la materia, il libro e le pagine da ripassare. Puoi usare anche argomenti e quiz già salvati.</p><div class="sg-start-row"><button type="button" class="sg-action sg-primary" data-sg-start>Scegli cosa ripassare</button><button type="button" class="sg-action" data-sg-demo>Prova le frazioni</button></div></div><p class="sg-note">La prova delle frazioni è separata dai tuoi libri. Le fonti personali usano quiz salvati o parole realmente presenti nelle pagine scelte.</p></section><section data-sg-play hidden><div class="sg-hud"><span data-sg-label></span><strong data-sg-progress></strong><button type="button" class="sg-action" data-sg-pause>Pausa</button></div><div class="sg-arena" data-sg-arena tabindex="0" role="group" aria-label="Arena spaziale. Tocca un drone, oppure sposta la navicella e premi Laser."><div class="sg-planet" aria-hidden="true"></div><div class="sg-orbit-line" aria-hidden="true"></div><p class="sg-arena-hint" data-sg-arena-hint>Un drone è un accesso alla prossima domanda.</p><div class="sg-drones">${[0,1,2].map(i=>`<button type="button" class="sg-drone" data-sg-target="${i}" aria-label="Colpisci drone ${i+1}">${droneSVG}</button>`).join('')}</div><div class="sg-laser" data-sg-laser hidden aria-hidden="true"></div><div class="sg-pilot" data-sg-pilot aria-label="La tua navicella">${shipSVG}</div><div class="sg-pause-screen" data-sg-pause-screen hidden><h3>Missione in pausa</h3><p>Riparti quando vuoi.</p><button type="button" class="sg-action sg-primary" data-sg-resume>Riprendi</button></div></div><div class="sg-flight-controls" data-sg-flight-controls><button type="button" class="sg-action" data-sg-left aria-label="Sposta la navicella a sinistra">←</button><button type="button" class="sg-action sg-primary" data-sg-fire>Laser</button><button type="button" class="sg-action" data-sg-right aria-label="Sposta la navicella a destra">→</button></div><p class="sg-control-note" data-sg-control-note>Tablet: tocca un drone. Computer: frecce o A/D, poi spazio per il laser.</p><article class="sg-question" data-sg-question hidden></article><section class="sg-finish" data-sg-finish hidden></section></section><p role="status" aria-live="polite" data-sg-status class="sg-status"></p><p role="alert" data-sg-error class="sg-error"></p></main><footer class="sg-footer">Una missione breve, senza cronometro o voti. I risultati di questo giro restano qui finché il gioco è aperto.</footer>`;
 const q=s=>dialog.querySelector(s),targets=[...dialog.querySelectorAll('[data-sg-target]')];
 const current=()=>{try{return !closed&&dialog.isConnected&&DB.session===session&&activeDatabaseName()===DB_NAME;}catch{return false;}};
 function checkAccess(){
  if(closed)return false;
  if(!current()){close();return false;}
  if(readGameAccess().allowed)return true;
  close();Promise.resolve().then(()=>ensureGameAccess()).catch(()=>{});return false;
 }
 function stop(){cancelAnimationFrame(frame);frame=null;lastFrame=0;direction=0;}
 function report(error){if(current()){q('[data-sg-error]').textContent=error.message||'Non riesco ad aprire questa missione. Scegli un altro materiale o la demo.';}}
 function busy(value){loading=value;q('[data-sg-start]').disabled=value;q('[data-sg-demo]').disabled=value;}
 function resetFeedback(){q('[data-sg-error]').textContent='';q('[data-sg-status]').textContent='';}
 async function available(){
  if(!checkAccess()||!current())throw Error('Il gioco è sospeso oppure il profilo è cambiato.');
  if(!selection)throw Error('Scegli prima la fonte da ripassare.');await assertGameSelectionAvailable(selection);if(!checkAccess())throw Error('Il gioco è sospeso durante la scuola.');
 }
 async function begin(demo=false){
  if(!checkAccess()||loading)return;const operation=++epoch;resetFeedback();busy(true);
  try{
   const prepared=await chooseGameQuestions({count:5,allowFewer:true,previousIds:lastQuestionIds,initialMode:demo?'demo':null,initialTopic:demo?null:requestedTopic});
   if(!prepared||!current()||operation!==epoch||!checkAccess())return;
   selection=prepared.selection;await assertGameSelectionAvailable(selection);if(!current()||operation!==epoch||!checkAccess())return;
   lastQuestionIds=prepared.questions.map(question=>question.id);run=newGameRun(prepared.questions);pilot=.5;elapsed=0;paused=false;
   q('[data-sg-label]').textContent=`${selection.materia} · ${selection.title}${selection.rangeLabel?' · '+selection.rangeLabel:''}`;
   q('[data-sg-setup]').hidden=true;q('[data-sg-play]').hidden=false;paint();q('[data-sg-arena]').focus();
  }catch(error){if(current()&&operation===epoch)report(error);}finally{if(current()&&operation===epoch)busy(false);}
 }
 function tick(time){
  frame=null;if(!current()||!run||run.phase!=='arena'||paused||document.hidden)return;
  const dt=lastFrame?Math.min(.05,(time-lastFrame)/1000):0;lastFrame=time;elapsed+=dt;pilot=movePilot(pilot,direction,dt);
  positions().forEach((x,i)=>targets[i].style.left=`${x*100}%`);q('[data-sg-pilot]').style.left=`${pilot*100}%`;
  if(!reduced||direction)frame=requestAnimationFrame(tick);
 }
 function positions(){return reduced?[.22,.5,.78]:dronePositions(elapsed);}
 function animate(){if(frame===null&&current()&&run?.phase==='arena'&&!paused&&!document.hidden)frame=requestAnimationFrame(tick);}
 function paint(){
  if(!checkAccess()||!run)return;stop();
  q('[data-sg-progress]').textContent=`${run.solved.length} / ${run.questions.length} scoperte`;
  const arena=run.phase==='arena';q('[data-sg-arena]').hidden=!arena;q('[data-sg-flight-controls]').hidden=!arena;q('[data-sg-control-note]').hidden=!arena;q('[data-sg-question]').hidden=run.phase!=='question';q('[data-sg-finish]').hidden=run.phase!=='complete';q('[data-sg-pause]').hidden=!arena;
  if(arena){q('[data-sg-pause]').textContent=paused?'Riprendi':'Pausa';q('[data-sg-laser]').hidden=true;q('[data-sg-pause-screen]').hidden=!paused;targets.forEach(t=>{t.disabled=false;t.classList.remove('sg-hit');});positions().forEach((x,i)=>targets[i].style.left=`${x*100}%`);q('[data-sg-pilot]').style.left=`${pilot*100}%`;animate();}
  if(run.phase==='question')question();
  if(run.phase==='complete'){
   q('[data-sg-finish]').innerHTML=`<span class="sg-tag">Giro completato</span><h3>Orbita esplorata.</h3><p>Hai attraversato ${run.solved.length} ${run.solved.length===1?'domanda':'domande'}. I tentativi servono a ritrovare le idee.</p><div class="sg-recap">${run.questions.map(v=>`<details><summary>${h(v.prompt.split('\n')[0])}</summary><p>${h(v.options[v.correct])}</p><p>${h(v.explanation)}</p><small>${h(v.sourceLabel)}</small></details>`).join('')}</div><button type="button" class="sg-action sg-primary" data-sg-again>Scegli un’altra missione</button>`;
   q('[data-sg-again]').onclick=back;q('[data-sg-finish] h3').tabIndex=-1;q('[data-sg-finish] h3').focus({preventScroll:true});
  }
 }
 function question(){
  const item=run.questions[run.index],correct=run.feedback?.correct;q('[data-sg-question]').dataset.sgQuestionId=item.id;
  q('[data-sg-question]').innerHTML=`<span class="sg-tag">Drone raggiunto · il volo è fermo</span><h3 tabindex="-1">${h(item.prompt)}</h3><div class="sg-answers">${item.options.map((v,i)=>`<button type="button" class="sg-action ${correct&&i===item.correct?'sg-answer-correct':''}" data-sg-answer="${i}" ${correct?'disabled':''}>${h(v)}</button>`).join('')}</div>${run.feedback?`<p role="status" class="sg-feedback ${correct?'sg-correct':''}">${h(run.feedback.message)}</p>`:'<p>Hai tutto il tempo. Se sbagli puoi leggere l’indizio e riprovare.</p>'}<details ${run.feedback&&!correct?'open':''}><summary>Guarda la fonte / indizio</summary>${item.quote?`<blockquote>${h(item.quote)}</blockquote>`:''}<p>${h(item.sourceLabel)}</p></details>${correct?'<button type="button" class="sg-action sg-primary" data-sg-continue>Riparti</button>':''}`;
  for(const button of q('[data-sg-question]').querySelectorAll('[data-sg-answer]'))button.onclick=()=>respond(Number(button.dataset.sgAnswer));
  q('[data-sg-continue]')?.addEventListener('click',()=>{if(!checkAccess())return;run=resumeArena(run);resetFeedback();paint();if(run.phase==='arena')q('[data-sg-arena]').focus();});
 }
 async function hit(index){
  if(!checkAccess()||run?.phase!=='arena'||paused||checking||impactTimer!==null)return;
  checking=true;
  try{
   await available();if(!checkAccess()||run?.phase!=='arena'||paused)return;
   stop();targets.forEach(t=>t.disabled=true);targets[index].classList.add('sg-hit');
   const laser=q('[data-sg-laser]'),arenaRect=q('[data-sg-arena]').getBoundingClientRect(),targetRect=targets[index].getBoundingClientRect();
   const dx=targetRect.left+targetRect.width/2-arenaRect.left-pilot*arenaRect.width,dy=arenaRect.height-76-(targetRect.top+targetRect.height/2-arenaRect.top);
   laser.hidden=false;laser.style.left=`${pilot*100}%`;laser.style.height=`${Math.hypot(dx,dy)}px`;laser.style.setProperty('--laser-angle',`${Math.atan2(dx,dy)*180/Math.PI}deg`);
   q('[data-sg-status]').textContent='Bersaglio raggiunto. Ecco la domanda.';
   impactTimer=setTimeout(()=>{impactTimer=null;if(!checkAccess()||run?.phase!=='arena')return;run=hitTarget(run);paint();q('[data-sg-question] h3').focus({preventScroll:true});},reduced?0:170);
  }catch(error){report(error);}finally{checking=false;}
 }
 async function respond(answer){
  if(!checkAccess()||checking)return;checking=true;
  try{await available();if(!checkAccess()||run?.phase!=='question')return;run=answerQuestion(run,answer);question();if(run.feedback.correct)q('[data-sg-continue]').focus({preventScroll:true});}
  catch(error){report(error);}finally{checking=false;}
 }
 function fire(){if(!checkAccess()||run?.phase!=='arena'||paused||checking||impactTimer!==null)return;const target=alignedTarget(pilot,positions());if(target<0){q('[data-sg-status]').textContent='Spostati sotto un drone, oppure toccalo direttamente.';return;}hit(target);}
 function pause(){if(!checkAccess()||run?.phase!=='arena')return;paused=!paused;clearTimeout(impactTimer);impactTimer=null;paint();}
 function back(){if(!checkAccess())return;stop();clearTimeout(impactTimer);impactTimer=null;run=null;paused=false;epoch++;q('[data-sg-play]').hidden=true;q('[data-sg-setup]').hidden=false;resetFeedback();}
 function close(){if(closed)return;closed=true;epoch++;stop();clearTimeout(impactTimer);clearInterval(accessWatch);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);window.removeEventListener('focus',checkAccess);window.removeEventListener('storage',checkAccess);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('skooling:game-access-changed',checkAccess);dialog.close();dialog.remove();returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:game-closed'));}
 function keydown(event){if(!checkAccess()||run?.phase!=='arena'||paused||checking||impactTimer!==null||event.target.closest('input,select,textarea,button,summary,a,[contenteditable="true"]'))return;if(['ArrowLeft','a','A'].includes(event.key)){event.preventDefault();direction=-1;animate();}if(['ArrowRight','d','D'].includes(event.key)){event.preventDefault();direction=1;animate();}if(event.code==='Space'){event.preventDefault();if(!event.repeat)fire();}}
 function keyup(event){if(['ArrowLeft','ArrowRight','a','A','d','D'].includes(event.key))direction=0;}
 function blur(){direction=0;if(run?.phase==='arena'&&!paused)pause();}
 function visibility(){if(!checkAccess())return;if(document.hidden){direction=0;stop();if(run?.phase==='arena'&&!paused)pause();}}
 q('[data-sg-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 q('[data-sg-start]').onclick=()=>begin();q('[data-sg-demo]').onclick=()=>begin(true);q('[data-sg-fire]').onclick=fire;q('[data-sg-pause]').onclick=pause;q('[data-sg-resume]').onclick=pause;
 targets.forEach((target,i)=>target.onclick=()=>hit(i));
 for(const[selector,value]of[['[data-sg-left]',-1],['[data-sg-right]',1]]){
  const button=q(selector);button.onpointerdown=event=>{if(!checkAccess()||run?.phase!=='arena'||paused)return;event.preventDefault();button.setPointerCapture(event.pointerId);direction=value;animate();};for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{direction=0;});
 }
 document.body.append(dialog);dialog.showModal();window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);window.addEventListener('focus',checkAccess);window.addEventListener('storage',checkAccess);document.addEventListener('visibilitychange',visibility);document.addEventListener('skooling:game-access-changed',checkAccess);accessWatch=setInterval(checkAccess,1000);
 checkAccess();
}
