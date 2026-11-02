const finite=n=>typeof n==='number'&&Number.isFinite(n);
const valid=v=>Boolean(v&&typeof v.id==='string'&&finite(v.x)&&finite(v.y)&&finite(v.angle??0));
const dot=(a,b)=>a.x*b.x+a.y*b.y;
function axes(angle){return[{x:Math.cos(angle),y:Math.sin(angle)},{x:-Math.sin(angle),y:Math.cos(angle)}];}
export function arenaCarsOverlap(a,b){
 if(!valid(a)||!valid(b))return true;
 const aa=axes(a.angle||0),bb=axes(b.angle||0),delta={x:b.x-a.x,y:b.y-a.y};
 for(const axis of [...aa,...bb]){
  const ra=27*Math.abs(dot(aa[0],axis))+18*Math.abs(dot(aa[1],axis));
  const rb=27*Math.abs(dot(bb[0],axis))+18*Math.abs(dot(bb[1],axis));
  if(Math.abs(dot(delta,axis))>=ra+rb+.5)return false;
 }
 return true;
}
export function resolveArenaCarMotion(car,cars,target){
 const stopped=()=>({x:finite(car?.x)?car.x:0,y:finite(car?.y)?car.y:0,angle:finite(car?.angle)?car.angle:0,blocked:true});
 if(!valid(car)||!Array.isArray(cars)||cars.some(c=>!valid(c))||!target||!finite(target.x)||!finite(target.y)||!finite(target.angle??car.angle??0))return stopped();
 const others=cars.filter(c=>c.id!==car.id),desiredAngle=target.angle??car.angle??0;
 const collides=(x,y,angle)=>others.some(c=>arenaCarsOverlap({...car,x,y,angle},c));
 let x=car.x,y=car.y,angle=collides(x,y,desiredAngle)?car.angle||0:desiredAngle;
 const steps=Math.max(1,Math.ceil(Math.hypot(target.x-x,target.y-y)/5));if(steps>2048)return stopped();
 const dx=(target.x-x)/steps,dy=(target.y-y)/steps;
 for(let i=0;i<steps;i++){if(!collides(x+dx,y,angle))x+=dx;if(!collides(x,y+dy,angle))y+=dy;}
 if(!collides(x,y,desiredAngle))angle=desiredAngle;
 return{x,y,angle,blocked:Math.hypot(x-target.x,y-target.y)>.001||Math.abs(Math.atan2(Math.sin(angle-desiredAngle),Math.cos(angle-desiredAngle)))>.001};
}
