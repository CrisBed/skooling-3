export const ARENA_WEAPONS=Object.freeze([
 {id:'base',name:'Impulso azzurro',kind:'pulse',color:'#65dce8',range:205,width:5,duration:.24,count:1,cooldown:.35},
 {id:'noncomune',name:'Impulso verde',kind:'pulse',color:'#6de58c',range:215,width:6,duration:.28,count:1,cooldown:.3},
 {id:'comune',name:'Raffica ambra',kind:'burst',color:'#ffbc68',range:220,width:4,duration:.3,count:3,cooldown:.5},
 {id:'rara',name:'Sfera cobalto',kind:'orb',color:'#70a7ff',range:240,width:12,duration:.55,count:1,cooldown:.6},
 {id:'epica',name:'Arco viola',kind:'arc',color:'#d79aff',range:260,width:8,duration:.44,count:1,cooldown:.55},
 {id:'leggendaria',name:'Raggio solare',kind:'beam',color:'#ffe58b',range:290,width:10,duration:.4,count:1,cooldown:.5},
].map(Object.freeze));
const byId=new Map(ARENA_WEAPONS.map(w=>[w.id,w])),finite=n=>typeof n==='number'&&Number.isFinite(n);
export function arenaWeapon(id='base'){const weapon=byId.get(id);if(!weapon)throw Error('Scegli un’arma disponibile nel giro.');return weapon;}
export function arenaWeaponForLoot(item){if(!item||item.rarity==='base')throw Error('Questo forziere non contiene un’arma disponibile.');return arenaWeapon(item.rarity);}
export function canFireArenaWeapon(id,elapsed,lastShot=null){const w=byId.get(id);return Boolean(w&&finite(elapsed)&&elapsed>=0&&(lastShot===null||finite(lastShot)&&lastShot>=0&&elapsed-lastShot>=w.cooldown));}
export function createArenaWeaponShots({weapon='base',from,to,elapsed}={}){
 const w=arenaWeapon(weapon);if(!from||!to||![from.x,from.y,to.x,to.y,elapsed,from.height??1.2,to.height??1.2].every(finite)||elapsed<0)throw Error('Il colpo non ha una posizione valida.');
 const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy)||1,side={x:-dy/length,y:dx/length};
 return Array.from({length:w.count},(_,i)=>{const offset=w.kind==='burst'?(i-1)*2.6:0,delay=w.kind==='burst'?i*.065:0;return{weaponId:w.id,kind:w.kind,color:w.color,width:w.width,from:{x:from.x+side.x*offset,y:from.y+side.y*offset},to:{x:to.x+side.x*offset,y:to.y+side.y*offset},fromHeight:from.height??1.2,toHeight:to.height??1.2,startsAt:elapsed+delay,expiresAt:elapsed+delay+w.duration};});
}
