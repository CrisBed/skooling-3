export const ROBOT_FIRE_RANGE=205;
export const ROBOT_FIRE_COOLDOWN=5;
export const ROBOT_SHOT_DURATION=.35;

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>finite(value)&&value>=0;
const position=value=>Boolean(value&&finite(value.x)&&finite(value.y));

export function nextArenaRobotAttack(world,options={}){
 const{elapsed=0,lastAttack=0,lineClear=()=>false}=options&&typeof options==='object'?options:{};
 const unchanged=()=>({damage:0,lastAttack:time(lastAttack)?lastAttack:0,shot:null});
 if(!time(elapsed)||!time(lastAttack)||elapsed<lastAttack||elapsed-lastAttack<ROBOT_FIRE_COOLDOWN||!world||world.area==='castle'||!position(world.player)||!Array.isArray(world.robots)||typeof lineClear!=='function')return unchanged();
 const expiresAt=elapsed+ROBOT_SHOT_DURATION;
 if(!finite(expiresAt)||expiresAt<=elapsed)return unchanged();
 const to={x:world.player.x,y:world.player.y};
 const candidates=world.robots.filter(robot=>robot?.alive===true&&typeof robot.id==='string'&&robot.id.trim().length>0&&position(robot)).map(robot=>({robotId:robot.id,from:{x:robot.x,y:robot.y},distance:Math.hypot(robot.x-to.x,robot.y-to.y)})).filter(robot=>robot.distance<=ROBOT_FIRE_RANGE).sort((a,b)=>a.distance-b.distance);
 for(const candidate of candidates){
  let clear=false;
  // Keep both the world and the immutable shot snapshot outside the callback.
  try{clear=lineClear({...candidate.from},{...to})===true;}catch{return unchanged();}
  if(clear)return{damage:5,lastAttack:elapsed,shot:{robotId:candidate.robotId,from:{...candidate.from},to:{...to},expiresAt}};
 }
 return unchanged();
}
