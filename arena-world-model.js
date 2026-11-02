import {validateArenaProfile} from './arena-game-model.js';
import {CASTLE_ROOM} from './arena-castle.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function position(value){if(!record(value)||!finite(value.x)||!finite(value.y)||(value.angle!==undefined&&!finite(value.angle)))throw Error('La posizione del mondo non è valida. Torna alla lobby e riprova.');}
function inside(x,y,b){return x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY;}
function hash(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

export const ARENA_WORLD_BOUNDS=freeze({minX:-1000,maxX:2000,minY:-800,maxY:1400});
export const ARENA_TERRAIN_GRID=freeze({cols:128,rows:96,bounds:ARENA_WORLD_BOUNDS});
export const CAVE_ROOMS=freeze([{id:'cave-north',kind:'cave',x:400,y:-150,portal:{x:400,y:-150},bounds:{minX:200,maxX:800,minY:80,maxY:560},entry:{x:500,y:480,angle:-Math.PI/2},exit:{x:500,y:520}}]);
export const ARENA_LANDMARKS=freeze([
 {id:'mountain-north',kind:'mountain',x:650,y:-420,height:18},
 {id:'mountain-path',kind:'path',x:400,y:-150,width:150,points:[{x:400,y:-150},{x:520,y:-290},{x:650,y:-420}]},
 {id:'lake-east',kind:'lake',x:1450,y:330,rx:260,ry:210,waterLevel:-.8},
 {id:'waterfall-east',kind:'waterfall',x:1500,y:-200,width:18,waterLevel:5,baseLevel:-.8,top:{x:1500,y:-230,height:5},bottom:{x:1500,y:-205,height:-.8},upperPool:{x:1500,y:-285,rx:65,ry:55,waterLevel:5},lowerPool:{x:1500,y:-155,rx:100,ry:85,waterLevel:-.8}},
 {id:'beach-west',kind:'beach',x:-450,y:300,waterLevel:-1.15},
 {id:'house-west',kind:'house',x:-350,y:-100,w:110,h:90,door:{x:-350,y:-30},anchor:{x:-295,y:-55}},
 {id:'house-north',kind:'house',x:1050,y:-350,w:120,h:95,door:{x:1050,y:-277.5},anchor:{x:1110,y:-302.5}},
 {id:'cave-north',kind:'cave',x:400,y:-150},
 {id:'dig-beach-01',kind:'dig',x:-250,y:450,area:'island'},
 {id:'find-meadow-01',kind:'find',x:1200,y:650,area:'island'},
 {id:'find-mountain-01',kind:'find',x:650,y:-420,area:'island'},
 {id:'find-cave-01',kind:'find',x:620,y:200,area:'cave',caveId:'cave-north'},
]);

const STEP_X=3000/128,STEP_Y=2200/96,WORLD_SCALE=.08;
const roomById=new Map(CAVE_ROOMS.map(room=>[room.id,room]));
const discoveryById=new Map(ARENA_LANDMARKS.filter(p=>p.kind==='dig'||p.kind==='find').map(p=>[p.id,p]));
const lake=ARENA_LANDMARKS.find(p=>p.kind==='lake');
const waterfall=ARENA_LANDMARKS.find(p=>p.kind==='waterfall');
const plateau=(x,y)=>x>=-100-STEP_X&&x<=1100+STEP_X&&y>=-100-STEP_Y&&y<=740+STEP_Y;
function vertexHeight(x,y){
 // One extra grid cell keeps the full original village plateau exactly flat.
 if(plateau(x,y))return 0;
 const islandRadius=Math.hypot((x-500)/1350,(y-300)/900);
 let height=1.1+.35*Math.sin(x/155)*Math.cos(y/140);
 if(islandRadius> .9)height-=Math.min(8,(islandRadius-.9)*18);
 const mountain=Math.max(0,1-Math.hypot((x-650)/410,(y+420)/300));if(mountain>0)height=Math.max(height,18*mountain);
 const basin=Math.hypot((x-lake.x)/lake.rx,(y-lake.y)/lake.ry);
 if(basin<1.15)height=Math.min(height,-3.5+Math.max(0,basin-.55)*8);
 const upper=Math.hypot((x-waterfall.upperPool.x)/waterfall.upperPool.rx,(y-waterfall.upperPool.y)/waterfall.upperPool.ry),lower=Math.hypot((x-waterfall.lowerPool.x)/waterfall.lowerPool.rx,(y-waterfall.lowerPool.y)/waterfall.lowerPool.ry);
 // The upper water sits in a depression on a broad, walkable raised shelf.
 // Keep its rim above 5 m; only the narrow waterfall channel drains south.
 if(upper<3.2)height=Math.max(height,5.8*clamp((3.2-upper)/1.85,0,1));
 if(upper<.95)height=Math.min(height,5.8-2.3*clamp((.95-upper)/.3,0,1));
 if(lower<1.2&&y>=waterfall.bottom.y-10)height=Math.min(height,-2.8+Math.max(0,lower-.65)*8);
 if(Math.abs(x-waterfall.top.x)<waterfall.width&&y>=waterfall.top.y-20&&y<=waterfall.bottom.y+5){const t=clamp((y-waterfall.top.y)/(waterfall.bottom.y-waterfall.top.y),0,1);height=Math.min(height,waterfall.top.height+(waterfall.bottom.height-waterfall.top.height)*t-1);}
 // Dry approach to the cave remains traversable before the climb.
 if(Math.hypot(x-400,y+150)<85)height=Math.min(height,1.2);
 // Blend the outer terrain from the protected flat village over 90 world units.
 // Apply this at vertices so the sampler and the rendered triangles share the ramp.
 const outside=Math.hypot(Math.max(-100-STEP_X-x,0,x-1100-STEP_X),Math.max(-100-STEP_Y-y,0,y-740-STEP_Y)),t=clamp(outside/90,0,1);
 return height*t*t*(3-2*t);
}
export function terrainVertexHeight(ix,iy){
 if(!Number.isInteger(ix)||!Number.isInteger(iy)||ix<0||ix>128||iy<0||iy>96)throw Error('Il vertice del terreno non è disponibile.');
 return vertexHeight(-1000+ix*STEP_X,-800+iy*STEP_Y);
}
function pathDistance(x,y){const points=ARENA_LANDMARKS.find(p=>p.kind==='path').points;let distance=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy),0,1);distance=Math.min(distance,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));}return distance;}
export function sampleArenaSurface(x,y,{area='island',caveId=null}={}){
 if(!finite(x)||!finite(y))return null;
 if(area==='cave'||area==='castle'){
  const bounds=area==='castle'?CASTLE_ROOM.bounds:roomById.get(caveId)?.bounds;
  return bounds&&inside(x,y,bounds)?{height:0,waterLevel:null,kind:'rock',slope:0,climbable:true}:null;
 }
 if(area!=='island'||!inside(x,y,ARENA_WORLD_BOUNDS))return null;
 const gx=(x+1000)/STEP_X,gy=(y+800)/STEP_Y,ix=Math.min(127,Math.floor(gx)),iy=Math.min(95,Math.floor(gy)),fx=gx-ix,fy=gy-iy;
 const a=terrainVertexHeight(ix,iy),b=terrainVertexHeight(ix+1,iy),c=terrainVertexHeight(ix,iy+1),d=terrainVertexHeight(ix+1,iy+1);
 let height,dx,dy;
 // Mesh triangles are [a,c,b,b,c,d], split along fx + fy = 1.
 if(fx+fy<=1){height=a+(b-a)*fx+(c-a)*fy;dx=(b-a)/STEP_X;dy=(c-a)/STEP_Y;}
 else{height=d+(c-d)*(1-fx)+(b-d)*(1-fy);dx=(d-c)/STEP_X;dy=(d-b)/STEP_Y;}
 const slope=Math.atan(Math.hypot(dx,dy)/WORLD_SCALE),basin=Math.hypot((x-lake.x)/lake.rx,(y-lake.y)/lake.ry);
 const upper=Math.hypot((x-waterfall.upperPool.x)/waterfall.upperPool.rx,(y-waterfall.upperPool.y)/waterfall.upperPool.ry),lower=Math.hypot((x-waterfall.lowerPool.x)/waterfall.lowerPool.rx,(y-waterfall.lowerPool.y)/waterfall.lowerPool.ry);
 const inFall=Math.abs(x-waterfall.top.x)<=waterfall.width/2&&y>=waterfall.top.y&&y<=waterfall.bottom.y,fallLevel=y===waterfall.bottom.y?waterfall.bottom.height:waterfall.top.height+(waterfall.bottom.height-waterfall.top.height)*(y-waterfall.top.y)/(waterfall.bottom.y-waterfall.top.y);
 const waterLevel=upper<=1.02&&height<5?5:inFall&&height<fallLevel?fallLevel:lower<1.1&&height<-.8?-.8:basin<1.1&&height<lake.waterLevel?lake.waterLevel:height< -1.15?-1.15:null;
 const kind=waterLevel!==null?'water':height>7||slope>.4?'rock':'land';
 // height is always the ground/seabed. Swimming body height is decided by the pose/controller.
 return{height,waterLevel,kind,slope,climbable:kind!=='water'&&(slope<=.6||pathDistance(x,y)<=75&&slope<=1.05)};
}

function checkedWorld(world){if(!record(world))throw Error('Il mondo non è disponibile.');position(world.player);return world;}
export function enterArenaCave(world,id){
 checkedWorld(world);const room=roomById.get(id);if(!room)throw Error('Questa grotta non è disponibile.');
 if(world.driving)throw Error('Scendi dall’auto prima di entrare nella grotta.');
 if(world.area==='cave'){if(world.caveId!==id)throw Error('Esci dalla grotta prima di entrare altrove.');position(world.caveReturn);return world;}
 if(world.area&&world.area!=='island')throw Error('Torna sull’isola prima di entrare nella grotta.');
 const surface=sampleArenaSurface(world.player.x,world.player.y);
 if(!surface||surface.kind==='water'||Math.hypot(world.player.x-room.portal.x,world.player.y-room.portal.y)>70)throw Error('Avvicinati all’ingresso della grotta.');
 if(world.caveWalls!=null&&!Array.isArray(world.caveWalls))throw Error('I ripari della grotta non sono leggibili.');
 return{...world,area:'cave',caveId:id,caveReturn:{...world.player},player:{...room.entry},destination:null,shots:[],enemyShots:[],jumpHeight:0,groundHeight:0,caveWalls:world.caveWalls||[]};
}
export function leaveArenaCave(world){
 checkedWorld(world);if(world.area!=='cave')return world;
 if(!roomById.has(world.caveId))throw Error('L’uscita della grotta non è disponibile.');position(world.caveReturn);const surface=sampleArenaSurface(world.caveReturn.x,world.caveReturn.y);
 if(!surface||surface.kind==='water')throw Error('Il punto di ritorno non è disponibile. Conserva il giro e riprova.');
 return{...world,area:'island',caveId:null,caveReturn:null,player:{...world.caveReturn},destination:null,shots:[],enemyShots:[],jumpHeight:0,groundHeight:surface.height};
}

export function createArenaExploration(runId){
 if(!validId(runId))throw Error('Riapri il giro prima di esplorare.');
 return{version:1,runId,sequence:0,activeSeconds:0,nextStudy:30,pending:null,completed:[],dig:Object.fromEntries([...discoveryById.values()].filter(p=>p.kind==='dig').map(p=>[p.id,0])),finds:[]};
}
function questionIds(ids){if(!Array.isArray(ids)||ids.length!==2||new Set(ids).size!==2||ids.some(id=>!validId(id,1024)))throw Error('Prepara due domande diverse della fonte scelta.');return [...ids];}
function checkedExploration(value){
 if(!record(value)||value.version!==1||!validId(value.runId)||!integer(value.sequence)||!finite(value.activeSeconds)||value.activeSeconds<0||value.activeSeconds>30||value.nextStudy!==30||!Array.isArray(value.completed)||new Set(value.completed).size!==value.completed.length||value.completed.some(id=>!validId(id))||!record(value.dig)||!Array.isArray(value.finds)||new Set(value.finds).size!==value.finds.length||value.finds.some(id=>!discoveryById.has(id)))throw Error('Lo stato dell’esplorazione non è leggibile. Torna alla lobby.');
 const digs=[...discoveryById.values()].filter(p=>p.kind==='dig');if(Object.keys(value.dig).length!==digs.length||digs.some(p=>!integer(value.dig[p.id])||value.dig[p.id]>3))throw Error('Lo scavo non è leggibile.');
 const p=value.pending;
 if(p!==null){
  if(!record(p)||!validId(p.activityId)||value.completed.includes(p.activityId)||!['periodic','discovery'].includes(p.kind)||p.count!==2||!Array.isArray(p.questionIds))throw Error('Il ripasso in attesa non è leggibile.');
  if(p.kind==='periodic'){if(p.activityKind!=='robot'||p.siteId!==null||value.activeSeconds!==30)throw Error('Il ripasso periodico non è leggibile.');}
  else if(p.activityKind!=='loot'||p.rarity!=='noncomune'||!discoveryById.has(p.siteId)||value.finds.includes(p.siteId))throw Error('Il ritrovamento in attesa non è leggibile.');
  if(p.questionIds.length)questionIds(p.questionIds);else if(p.kind!=='periodic')throw Error('Mancano le domande del ritrovamento.');
 }
 return value;
}
function nextActivity(state){if(state.sequence===Number.MAX_SAFE_INTEGER)throw Error('Avvia un nuovo giro per continuare.');const sequence=state.sequence+1,full=`study:${state.runId}:${sequence}`;return{sequence,activityId:full.length<=256?full:`study:${hash(state.runId).toString(16)}:${sequence}`};}
export function advanceArenaStudyClock(state,{dt=0,active=false}={}){
 checkedExploration(state);if(!finite(dt)||dt<0||typeof active!=='boolean')throw Error('Il tempo di esplorazione non è valido.');
 if(state.pending)return{state,request:structuredClone(state.pending)};
 if(!active||dt===0)return{state,request:null};
 const activeSeconds=Math.min(30,state.activeSeconds+Math.min(dt,.1));
 if(activeSeconds<30-1e-9)return{state:{...state,activeSeconds},request:null};
 const{sequence,activityId}=nextActivity(state),pending={activityId,kind:'periodic',activityKind:'robot',siteId:null,count:2,questionIds:[]};
 return{state:{...state,sequence,activeSeconds:30,pending},request:structuredClone(pending)};
}
function siteAt(world,id){
 const site=discoveryById.get(id);if(!site)throw Error('Questo punto di ricerca non è disponibile.');
 if((world.area||'island')!==site.area||site.area==='cave'&&world.caveId!==site.caveId||world.driving||Math.hypot(world.player.x-site.x,world.player.y-site.y)>70)throw Error('Avvicinati al punto di ricerca a piedi.');return site;
}
export function beginArenaDiscovery(world,{siteId,questionIds:ids}={}){
 checkedWorld(world);const state=checkedExploration(world.exploration),questions=questionIds(ids);
 if(siteId==='periodic'){
  if(state.pending?.kind!=='periodic')throw Error('Non c’è un ripasso periodico in attesa.');
  if(state.pending.questionIds.length){if(state.pending.questionIds.some((id,i)=>id!==questions[i]))throw Error('Concludi le domande già scelte.');return world;}
  return{...world,exploration:{...state,pending:{...state.pending,questionIds:questions}}};
 }
 const site=siteAt(world,siteId);if(state.finds.includes(siteId))throw Error('Hai già completato questo ritrovamento.');
 if(state.pending){if(state.pending.siteId===siteId&&state.pending.questionIds.every((id,i)=>id===questions[i]))return world;throw Error('Concludi prima il ripasso in attesa.');}
 if(site.kind==='dig'&&state.dig[siteId]!==3)throw Error('Scava tre volte per scoprire il reperto.');
 const{sequence,activityId}=nextActivity(state),pending={activityId,kind:'discovery',activityKind:'loot',siteId,count:2,questionIds:questions,rarity:'noncomune'};
 return{...world,exploration:{...state,sequence,pending}};
}
export function completeArenaDiscovery(world,{activityId,profile}={}){
 checkedWorld(world);const state=checkedExploration(world.exploration),checked=validateArenaProfile(profile);
 if(!validId(activityId))throw Error('Il ritrovamento non è valido.');
 if(state.completed.includes(activityId))return world;
 const pending=state.pending;if(!pending||pending.activityId!==activityId)throw Error('Concludi l’attività in attesa prima di raccogliere il risultato.');
 const expected=questionIds(pending.questionIds),receipt=checked.receipts.activities[JSON.stringify([state.runId,activityId])];
 if(!receipt||receipt.kind!==pending.activityKind||pending.activityKind==='loot'&&receipt.rarity!=='noncomune'||!Array.isArray(receipt.questionIds)||receipt.questionIds.length!==2||!expected.every(id=>receipt.questionIds.includes(id)&&checked.receipts.answers[JSON.stringify([state.runId,id])]===true))throw Error('Completa e salva le due risposte di questa attività.');
 return{...world,exploration:{...state,activeSeconds:0,pending:null,completed:[...state.completed,activityId],finds:pending.kind==='discovery'?[...state.finds,pending.siteId]:state.finds}};
}
export function strikeArenaDig(world,siteId){
 checkedWorld(world);const state=checkedExploration(world.exploration),site=siteAt(world,siteId);
 if(site.kind!=='dig'||state.pending||state.dig[siteId]>=3||state.finds.includes(siteId))throw Error('Lo scavo non è disponibile. Completa prima l’attività in attesa.');
 return{...world,exploration:{...state,dig:{...state.dig,[siteId]:state.dig[siteId]+1}}};
}

export function createArenaEnemyRoster(seed){
 if(!(validId(seed)||Number.isSafeInteger(seed)))throw Error('Il seme del giro non è valido.');const h=hash(String(seed)),palettes=['#7688b8','#c48663','#688f91','#9876ac'];
 return[[585,225],[365,405],[660,440],[1320,450],[670,-300]].map(([x,y],i)=>({id:i<3?`robot-${i+1}`:`drone-${i-2}`,kind:i<3?'robot':'drone',x,y,homeX:x,homeY:y,alive:true,altitude:i<3?0:3+((h+i)%3),palette:palettes[(h+i)%4],variant:(h+i)%3,behavior:'patrol',motionTime:0,angle:0}));
}
export function advanceArenaEnemies(world,{dt=0,active=false,isFree=()=>false,lineClear=()=>false}={}){
 checkedWorld(world);if(!finite(dt)||dt<0||typeof active!=='boolean')throw Error('Il movimento dei robot non è valido.');
 if(!Array.isArray(world.robots)||new Set(world.robots.map(e=>e?.id)).size!==world.robots.length)throw Error('La pattuglia non è leggibile.');
 for(const enemy of world.robots){position(enemy);if(!validId(enemy.id)||!finite(enemy.homeX)||!finite(enemy.homeY)||typeof enemy.alive!=='boolean'||!['robot','drone'].includes(enemy.kind)||!finite(enemy.altitude)||enemy.altitude<0||!finite(enemy.motionTime))throw Error('La pattuglia non è leggibile.');}
 if(!active||dt===0||world.area&&world.area!=='island')return world;
 const step=Math.min(dt,.1),robots=world.robots.map(enemy=>{
  if(!enemy.alive)return enemy;
  const distance=Math.hypot(world.player.x-enemy.x,world.player.y-enemy.y),motionTime=enemy.motionTime+step;let sees=false;
  try{sees=lineClear({...enemy},{...world.player})===true;}catch{}
  let behavior='patrol',targetX,targetY,speed=enemy.kind==='drone'?38:26;
  if(sees&&distance<330){
   behavior=distance>155?'approach':'strafe';
   if(behavior==='approach'){targetX=world.player.x;targetY=world.player.y;}
   else{const angle=Math.atan2(enemy.y-world.player.y,enemy.x-world.player.x)+.12;targetX=world.player.x+Math.cos(angle)*155;targetY=world.player.y+Math.sin(angle)*155;}
  }else{targetX=enemy.homeX+Math.cos(motionTime*.45+hash(enemy.id)%7)*48;targetY=enemy.homeY+Math.sin(motionTime*.45+hash(enemy.id)%7)*38;speed*=.65;}
  const dx=targetX-enemy.x,dy=targetY-enemy.y,length=Math.hypot(dx,dy),move=Math.min(speed*step,length),x=enemy.x+(length?dx/length*move:0),y=enemy.y+(length?dy/length*move:0),surface=sampleArenaSurface(x,y);let free=false;
  if(surface&&(enemy.kind==='drone'||surface.kind!=='water'&&surface.climbable))try{free=isFree(x,y,{...enemy})===true;}catch{}
  return{...enemy,x:free?x:enemy.x,y:free?y:enemy.y,angle:length?Math.atan2(dy,dx):enemy.angle,motionTime,behavior};
 });
 return{...world,robots};
}
