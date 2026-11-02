import {arenaExpeditionProgress,createArenaExpedition} from './arena-combat-model.js';
import {ARENA_WORLD_BOUNDS,ARENA_LANDMARKS,CAVE_ROOMS} from './arena-world-model.js';
import {visibleArenaLoot,arenaLootPosition,CASTLE_ROOM} from './arena-castle.js';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const nearest=(player,items)=>items.filter(Boolean).sort((a,b)=>distance(player,a)-distance(player,b))[0]||null;
const taskTitles={chest:'Apri un rifornimento',robot:'Completa tre incontri',discovery:'Studia un reperto'};

export function arenaMissionObjective(world){
 if(!world?.player)return null;
 const area=world.area||'island',progress=arenaExpeditionProgress(world.expedition||createArenaExpedition()),task=kind=>progress.tasks.find(t=>t.kind===kind),room=CAVE_ROOMS.find(r=>r.id===world.caveId);
 if(area==='cave'){
  const site=nearest(world.player,ARENA_LANDMARKS.filter(p=>p.area==='cave'&&p.caveId===world.caveId&&!world.exploration?.finds.includes(p.id)));
  return site?{...site,label:'Scopri il reperto della grotta'}:room?{...room.exit,kind:'exit',label:'Torna all’isola'}:null;
 }
 if(area==='castle'){
  const item=visibleArenaLoot(world).find(l=>!l.opened);
  return item?{...arenaLootPosition(world,item),id:item.id,kind:'chest',label:'Apri il tesoro del castello'}:{...CASTLE_ROOM.exit,kind:'exit',label:'Torna all’isola'};
 }
 if(progress.complete)return null;
 if(!task('chest').complete){const loot=nearest(world.player,visibleArenaLoot(world).filter(l=>!l.opened));if(loot)return{...loot,kind:'chest',label:'Trova il primo rifornimento'};}
 if(!task('robot').complete){const enemy=nearest(world.player,(world.robots||[]).filter(e=>e.alive));if(enemy)return{...enemy,kind:'robot',label:enemy.hp===0?'Completa le domande del guardiano':enemy.kind==='drone'?'Affronta il drone':'Affronta il guardiano'};}
 if(!task('discovery').complete){
  const options=ARENA_LANDMARKS.filter(p=>p.area==='island'&&['find','dig'].includes(p.kind)&&!world.exploration?.finds.includes(p.id)).map(p=>({...p,label:p.kind==='dig'?'Scava e studia il reperto':'Scopri un reperto'}));
  if(!world.exploration?.finds.includes('find-cave-01'))for(const cave of CAVE_ROOMS)options.push({...cave.portal,id:cave.id,kind:'cave',label:'Cerca il reperto nella grotta'});
  return nearest(world.player,options);
 }
 return null;
}

export function arenaMissionHUD(world,selection={}){
 const progress=arenaExpeditionProgress(world.expedition||createArenaExpedition()),b=ARENA_WORLD_BOUNDS;
 return `<aside class="ia-expedition-hud" data-ia-expedition aria-label="Obiettivi della spedizione"><div class="ia-expedition-heading"><span class="ia-expedition-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 8 5v10l-8 5-8-5V7Z"/><path d="m7 12 3 3 7-7"/></svg></span><div><strong data-ia-expedition-title>La tua spedizione</strong><small title="${h(selection.title)}">${h(selection.rangeLabel||selection.chapterTitle||selection.title||'Esplora, affronta, scopri')}</small><button type="button" class="ia-study-scope" data-ia-action="source" aria-label="Cambia materia, libro o pagine">Cambia studio</button></div></div><ol>${['chest','robot','discovery'].map(kind=>{const t=progress.tasks.find(t=>t.kind===kind);return`<li data-ia-expedition-task="${kind}"><span>${taskTitles[kind]}</span><strong data-ia-expedition-count="${kind}">${Math.min(t.current,t.target)}/${t.target}</strong></li>`;}).join('')}</ol><p data-ia-next-objective></p><p class="ia-expedition-finished" data-ia-expedition-finished hidden>Missione compiuta! I crediti delle risposte sono disponibili nello Shop. Puoi continuare a esplorare o iniziare una nuova spedizione dalla lobby.</p></aside><div class="ia-minimap" data-ia-minimap aria-label="Minimappa e prossimo obiettivo"><svg viewBox="${b.minX} ${b.minY} ${b.maxX-b.minX} ${b.maxY-b.minY}" aria-hidden="true"><rect x="${b.minX}" y="${b.minY}" width="3000" height="2200" rx="250" fill="#244d69"/><ellipse cx="500" cy="300" rx="1300" ry="850" fill="#487d77"/><path d="M30 320H970M500 30V615" stroke="#e2c79b" stroke-width="30"/><path d="m400-150 250-270 260 210" fill="none" stroke="#9fae9a" stroke-width="50"/><ellipse cx="1450" cy="330" rx="260" ry="210" fill="#6bc4d0"/><circle data-ia-mini-target r="70" fill="#ffdc7a" stroke="#fff9dd" stroke-width="18"/><g data-ia-mini-player><circle r="54" fill="#fff"/><path d="m60-35 100 35-100 35Z" fill="#fff"/></g></svg><span>Nord ↑</span></div>`;
}

export function updateArenaMissionHUD(root,world){
 const pane=root.querySelector('[data-ia-expedition]');if(!pane||!world?.expedition)return;
 const progress=arenaExpeditionProgress(world.expedition),objective=arenaMissionObjective(world);
 pane.dataset.iaExpeditionComplete=String(progress.complete);pane.classList.toggle('ia-expedition-complete',progress.complete);
 for(const t of progress.tasks){const item=pane.querySelector(`[data-ia-expedition-task="${t.kind}"]`),value=pane.querySelector(`[data-ia-expedition-count="${t.kind}"]`),text=`${Math.min(t.current,t.target)}/${t.target}`;if(value.textContent!==text)value.textContent=text;item.classList.toggle('done',t.complete);pane.dataset['iaExpedition'+({robot:'Robots',chest:'Chests',discovery:'Discoveries'}[t.kind])]=String(t.current);}
 const title=pane.querySelector('[data-ia-expedition-title]'),next=pane.querySelector('[data-ia-next-objective]'),done=pane.querySelector('[data-ia-expedition-finished]');title.textContent=progress.complete?'Spedizione completata':'La tua spedizione';done.hidden=!progress.complete;
 const message=objective?`${objective.label} · ${Math.round(distance(world.player,objective)*.08)} m`:progress.complete?'Scegli tu la prossima avventura.':'Esplora e usa Interagisci vicino agli oggetti.';if(next.textContent!==message)next.textContent=message;
 const mini=root.querySelector('[data-ia-minimap]');if(!mini)return;mini.hidden=(world.area||'island')!=='island';const player=mini.querySelector('[data-ia-mini-player]'),target=mini.querySelector('[data-ia-mini-target]');player.setAttribute('transform',`translate(${world.player.x} ${world.player.y}) rotate(${world.player.angle*180/Math.PI})`);target.toggleAttribute('hidden',!objective);if(objective){target.setAttribute('cx',objective.x);target.setAttribute('cy',objective.y);}
}
