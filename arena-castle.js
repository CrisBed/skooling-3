function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

export const CASTLE_ROOM=freeze({
 bounds:{minX:240,maxX:760,minY:100,maxY:540},
 entry:{x:500,y:450,angle:-Math.PI/2},
 exit:{x:500,y:510},
 treasure:{x:500,y:180},
 pillars:[{x:315,y:235,w:30,h:30},{x:655,y:235,w:30,h:30},{x:315,y:380,w:30,h:30},{x:655,y:380,w:30,h:30}],
});

const finite=value=>typeof value==='number'&&Number.isFinite(value);
function checkPosition(value){
 if(!value||typeof value!=='object'||!finite(value.x)||!finite(value.y)||(value.angle!==undefined&&!finite(value.angle)))throw Error('La posizione del castello non è valida. Torna alla lobby e riprova.');
}
function checkWorld(world){
 if(!world||typeof world!=='object'||Array.isArray(world))throw Error('L’isola non è disponibile. Torna alla lobby e riprova.');
 checkPosition(world.player);
}

export function inArenaCastle(world){return world?.area==='castle';}
export function enterArenaCastle(world){
 checkWorld(world);
 if(world.driving)throw Error('Scendi dall’auto prima di entrare nel castello.');
 if(inArenaCastle(world)){checkPosition(world.castleReturn);return world;}
 if(world.castleWalls!=null&&!Array.isArray(world.castleWalls))throw Error('I ripari del castello non sono leggibili. Torna alla lobby e riprova.');
 return{...world,castleReturn:{...world.player},area:'castle',player:{...CASTLE_ROOM.entry},destination:null,shots:[],enemyShots:[],jumpHeight:0,castleWalls:world.castleWalls||[]};
}
export function leaveArenaCastle(world){
 checkWorld(world);if(!inArenaCastle(world))return world;
 checkPosition(world.castleReturn);
 return{...world,player:{...world.castleReturn},area:'island',castleReturn:null,destination:null,shots:[],enemyShots:[],jumpHeight:0};
}
export function castleLoot(world){return Array.isArray(world?.loot)?world.loot.find(item=>item?.rarity==='leggendaria')||null:null;}
export function arenaLootPosition(world,item){
 checkPosition(item);
 return inArenaCastle(world)&&item.rarity==='leggendaria'?CASTLE_ROOM.treasure:{x:item.x,y:item.y};
}
export function visibleArenaLoot(world){
 if(!Array.isArray(world?.loot))return[];
 return world.loot.filter(item=>inArenaCastle(world)?item?.rarity==='leggendaria':item?.rarity!=='leggendaria');
}
