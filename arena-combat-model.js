import {arenaWeapon} from './arena-weapons.js';

const CAPACITY=12,RELOAD_SECONDS=1.2;
const damageByWeapon=Object.freeze({base:1,noncomune:1,comune:1,rara:2,epica:2,leggendaria:3});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value;

function checkedCombat(state){
 if(!record(state)||state.version!==1||!Object.hasOwn(damageByWeapon,state.weaponId)||state.capacity!==CAPACITY||!count(state.ammo)||state.ammo>CAPACITY||!finite(state.reloadRemaining)||state.reloadRemaining<0||state.reloadRemaining>RELOAD_SECONDS||!count(state.shots)||!count(state.hits))throw Error('Le munizioni del giro non sono leggibili. Torna alla lobby e riprova.');
 arenaWeapon(state.weaponId);return state;
}
export function newArenaCombat(){return{version:1,weaponId:'base',ammo:CAPACITY,capacity:CAPACITY,reloadRemaining:0,shots:0,hits:0};}
export function equipArenaCombat(state,weaponId){
 checkedCombat(state);if(!Object.hasOwn(damageByWeapon,weaponId))throw Error('Scegli un’arma disponibile nel giro.');arenaWeapon(weaponId);
 return{...state,weaponId,ammo:CAPACITY,reloadRemaining:0};
}
export function startArenaReload(state){
 checkedCombat(state);if(state.ammo===CAPACITY||state.reloadRemaining>0)return state;
 return{...state,reloadRemaining:RELOAD_SECONDS};
}
export function advanceArenaCombat(state,{dt=0,active=false}={}){
 checkedCombat(state);if(!finite(dt)||dt<0||typeof active!=='boolean')throw Error('Il tempo della ricarica non è valido.');
 if(!active||dt===0||state.reloadRemaining===0)return state;
 const remaining=Math.max(0,state.reloadRemaining-Math.min(dt,.1));
 return remaining<1e-9?{...state,ammo:CAPACITY,reloadRemaining:0}:{...state,reloadRemaining:remaining};
}
export function takeArenaCombatShot(state){
 checkedCombat(state);
 if(state.reloadRemaining>0)return{state,fired:false,rounds:0,damage:0};
 if(state.ammo===0)return{state:startArenaReload(state),fired:false,rounds:0,damage:0};
 if(!Number.isSafeInteger(state.shots+1))throw Error('Avvia un nuovo giro prima di continuare a sparare.');
 const rounds=Math.min(state.ammo,state.weaponId==='comune'?3:1);
 // shots counts triggers. Only the controller knows whether an impact happened.
 return{state:{...state,ammo:state.ammo-rounds,shots:state.shots+1},fired:true,rounds,damage:rounds*damageByWeapon[state.weaponId]};
}

export function withArenaEnemyHealth(enemy){
 if(!record(enemy)||!id(enemy.id)||!['robot','drone'].includes(enemy.kind)||typeof enemy.alive!=='boolean')throw Error('Questo nemico non è disponibile nel giro.');
 const maxHp=enemy.kind==='drone'?4:3,hp=enemy.hp===undefined?(enemy.alive?maxHp:0):enemy.hp;
 if(enemy.maxHp!==undefined&&enemy.maxHp!==maxHp||!count(hp)||hp>maxHp)throw Error('La resistenza del nemico non è valida.');
 return{...enemy,maxHp,hp:enemy.alive?hp:0};
}
export function hitArenaEnemy(enemy,{damage}={}){
 const next=withArenaEnemyHealth(enemy);
 if(!Number.isSafeInteger(damage)||damage<0||damage>100)throw Error('Il danno del colpo non è valido.');
 if(damage===0||!next.alive||next.hp===0)return{enemy:next,defeated:false,hit:false};
 next.hp=Math.max(0,next.hp-damage);
 // Zero HP disables combat. The verified study activity resolves alive later.
 return{enemy:next,defeated:next.hp===0,hit:true};
}

const expeditionKeys=Object.freeze({robot:'robots',chest:'chests',discovery:'discoveries'});
const expeditionTargets=Object.freeze({robot:3,chest:1,discovery:1});
function checkedExpedition(state){
 if(!record(state)||state.version!==1||Object.values(expeditionKeys).some(key=>!Array.isArray(state[key])||new Set(state[key]).size!==state[key].length||state[key].some(value=>!id(value))))throw Error('Gli obiettivi del giro non sono leggibili.');
 return state;
}
export function createArenaExpedition(){return{version:1,robots:[],chests:[],discoveries:[]};}
export function recordArenaExpedition(state,event={}){
 checkedExpedition(state);if(!record(event)||!Object.hasOwn(expeditionKeys,event.kind)||!id(event.id))throw Error('Questo obiettivo non è disponibile.');
 const key=expeditionKeys[event.kind];if(state[key].includes(event.id))return state;
 // Caller records this event only after the existing receipt was verified.
 // This RAM checklist never grants credits, items or persistent rewards.
 return{...state,[key]:[...state[key],event.id]};
}
export function arenaExpeditionProgress(state){
 checkedExpedition(state);
 const tasks=Object.entries(expeditionKeys).map(([kind,key])=>({kind,target:expeditionTargets[kind],current:state[key].length,complete:state[key].length>=expeditionTargets[kind]}));
 return{tasks,complete:tasks.every(task=>task.complete)};
}
