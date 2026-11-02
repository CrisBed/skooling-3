const nodes=[];
const tree=(id,x,y)=>({id,kind:'tree',x,y,w:12,h:12,health:3});
for(let i=0;i<=10;i++){nodes.push(tree(`tree-west-${i}`,27.5,45+i*55),tree(`tree-east-${i}`,972.5,45+i*55));}
for(let i=0;i<=11;i++){nodes.push(tree(`tree-north-${i}`,100+i*72.5,1.25),tree(`tree-south-${i}`,100+i*72.5,638.75));}
nodes.push(tree('tree-start',430,365),tree('tree-grove',410,150),tree('tree-east-grove',580,380),tree('tree-north-grove',600,90),{id:'brick-start',kind:'brick',x:555,y:395,w:58,h:16,health:3},{id:'brick-north',kind:'brick',x:550,y:130,w:60,h:16,health:3});
nodes.push(tree('tree-world-beach-1',-500,220),tree('tree-world-beach-2',-400,420),tree('tree-world-beach-3',-450,540),tree('tree-world-refuge-1',-280,-180),tree('tree-world-refuge-2',-400,-250),tree('tree-world-mountain-1',300,-240),tree('tree-world-mountain-2',900,-280),tree('tree-world-meadow-1',1180,500),tree('tree-world-meadow-2',1300,700),tree('tree-world-meadow-3',1200,820),tree('tree-world-south-1',900,900),tree('tree-world-south-2',300,900));
export const ARENA_RESOURCE_NODES=Object.freeze(nodes.map(node=>Object.freeze(node)));
export const ARENA_BUILD_OPTIONS=Object.freeze([
 {id:'wood-wall',resource:'wood',cost:10,label:'Parete di legno'},
 {id:'brick-wall',resource:'brick',cost:10,label:'Muro di mattoni'},
 {id:'wood-corner',resource:'wood',cost:15,label:'Riparo di legno ad angolo'},
 {id:'brick-corner',resource:'brick',cost:15,label:'Riparo di mattoni ad angolo'},
].map(option=>Object.freeze(option)));
const byId=new Map(ARENA_RESOURCE_NODES.map(node=>[node.id,node]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const point=value=>Boolean(value&&finite(value.x)&&finite(value.y));
const center=node=>node.kind==='tree'?{x:node.x,y:node.y}:{x:node.x+node.w/2,y:node.y+node.h/2};
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const nodeRect=node=>({id:node.id,kind:node.kind,x:node.kind==='tree'?node.x-6:node.x,y:node.kind==='tree'?node.y-6:node.y,w:node.w,h:node.h});
function checked(materials){
 if(!materials||!count(materials.wood)||!count(materials.brick)||!count(materials.builtCount)||materials.builtCount>24||!Array.isArray(materials.nodes)||materials.nodes.length!==ARENA_RESOURCE_NODES.length)throw Error('I materiali del giro non sono validi. Torna alla lobby prima di ripartire.');
 const seen=new Set();
 for(const node of materials.nodes){const original=byId.get(node?.id);if(!original||seen.has(node.id)||!Number.isInteger(node.health)||node.health<0||node.health>3||['kind','x','y','w','h'].some(key=>node[key]!==original[key]))throw Error('Un albero o un muro del giro non è valido. Nessuna risorsa è stata cambiata.');seen.add(node.id);}
 return materials;
}
const copied=materials=>({...materials,nodes:materials.nodes.map(node=>({...node}))});
export function createArenaMaterials(){return{wood:0,brick:0,nodes:ARENA_RESOURCE_NODES.map(node=>({...node})),builtCount:0};}
export function nearestArenaNode(materials,player,radius=60){
 checked(materials);if(!point(player)||!finite(radius)||radius<0)return null;
 let chosen=null,distance=radius;
 for(const node of materials.nodes){if(node.health<=0)continue;const at=center(node),current=Math.hypot(at.x-player.x,at.y-player.y);if(current<=distance){if(current<distance||chosen===null){chosen=node;distance=current;}}}
 return chosen;
}
export function arenaMaterialObstacles(materials){return checked(materials).nodes.filter(node=>node.health>0).map(nodeRect);}
export function strikeArenaNode(materials,id,{player}={}){
 checked(materials);if(!point(player))throw Error('Avvicinati a un albero o a un muro per usare il piccone.');
 const node=materials.nodes.find(value=>value.id===id);if(!node)throw Error('Scegli un albero o un muro presente nel giro.');
 const at=center(node);if(Math.hypot(at.x-player.x,at.y-player.y)>60)throw Error('Sei troppo lontano. Avvicinati prima di usare il piccone.');
 if(node.health===0)throw Error('Questo elemento è già stato raccolto. Scegline un altro.');
 const remaining=node.health-1,gained={wood:0,brick:0};if(remaining===0)gained[node.kind==='tree'?'wood':'brick']=node.kind==='tree'?20:15;
 if(!count(materials.wood+gained.wood)||!count(materials.brick+gained.brick))throw Error('Non riesco ad aggiornare i materiali del giro.');
 const next=copied(materials);next.nodes.find(value=>value.id===id).health=remaining;next.wood+=gained.wood;next.brick+=gained.brick;
 return{materials:next,hit:{id:node.id,kind:node.kind,remaining,destroyed:remaining===0,gained}};
}
function rectangle(value){return Boolean(value&&point(value)&&finite(value.w)&&value.w>0&&finite(value.h)&&value.h>0&&finite(value.x+value.w)&&value.x+value.w>value.x&&finite(value.y+value.h)&&value.y+value.h>value.y);}
function crosses(from,to,rect,padding=12){
 let near=0,far=1;
 for(const[axis,size]of[['x','w'],['y','h']]){
  const min=rect[axis]-padding,max=rect[axis]+rect[size]+padding,delta=to[axis]-from[axis];
  if(delta===0){if(from[axis]<min||from[axis]>max)return false;continue;}
  let a=(min-from[axis])/delta,b=(max-from[axis])/delta;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return false;
 }
 return true;
}
function escapeAvailable(player,rects){
 for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
  const length=Math.hypot(dx,dy),to={x:player.x+dx/length*80,y:player.y+dy/length*80};
  if(rects.every(rect=>!crosses(player,to,rect)))return true;
 }
 return false;
}
export function placeArenaShelter(materials,{kind,player,existingWalls=[],canPlace}={}){
 checked(materials);const option=ARENA_BUILD_OPTIONS.find(value=>value.id===kind);
 if(!option)throw Error('Scegli un riparo disponibile.');
 if(!point(player)||!finite(player.angle)||!Array.isArray(existingWalls)||existingWalls.some(wall=>!rectangle(wall))||typeof canPlace!=='function')throw Error('Controlla lo spazio prima di costruire un riparo.');
 if(materials.builtCount>=24)throw Error('Hai già costruito 24 ripari in questo giro.');
 if(materials[option.resource]<option.cost)throw Error(`Servono ${option.cost} ${option.resource==='wood'?'legni':'mattoni'} per questo riparo.`);
 const angle=Math.round(Math.atan2(Math.sin(player.angle),Math.cos(player.angle))/(Math.PI/2))*(Math.PI/2),forward={x:Math.round(Math.cos(angle)),y:Math.round(Math.sin(angle))},right={x:-forward.y,y:forward.x},structureId=`arena-structure-${materials.builtCount+1}`;
 if(existingWalls.some(wall=>wall.structureId===structureId))throw Error('Questo riparo è già presente. Riapri la scelta prima di costruire.');
 const front={x:player.x+forward.x*48,y:player.y+forward.y*48},walls=[{x:front.x-(forward.x?7:28),y:front.y-(forward.x?28:7),w:forward.x?14:56,h:forward.x?56:14}];
 if(kind.endsWith('-corner')){const side={x:player.x+forward.x*27+right.x*28,y:player.y+forward.y*27+right.y*28};walls.push({x:side.x-(forward.x?28:7),y:side.y-(forward.x?7:28),w:forward.x?56:14,h:forward.x?14:56});}
 for(const wall of walls){
  if(!rectangle(wall)||existingWalls.some(other=>overlap(wall,other)))throw Error('Qui non c’è spazio: il riparo si sovrappone a un ostacolo.');
  let allowed=false;try{allowed=canPlace({...wall})===true;}catch{}if(!allowed)throw Error('Qui non c’è spazio per questo riparo. Scegli un’altra posizione.');
 }
 if(!escapeAvailable(player,[...existingWalls,...walls]))throw Error('Il riparo chiuderebbe il passaggio. Lascia uno spazio libero per uscire.');
 const next=copied(materials);next[option.resource]-=option.cost;next.builtCount++;
 return{materials:next,walls:walls.map(wall=>({...wall,material:option.resource,kind,structureId})),structureId};
}
