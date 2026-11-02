const finite=value=>typeof value==='number'&&Number.isFinite(value);
const zero=()=>({x:0,y:0});
const ground=()=>({height:0,velocity:0,grounded:true});

function boundedVector(x,y,radius=1){
 // Scale before measuring the length to avoid overflow from large inputs.
 const scale=Math.max(Math.abs(x),Math.abs(y));if(!scale)return zero();
 const sx=x/scale,sy=y/scale,length=Math.hypot(sx,sy),amount=Math.min(1,(scale/radius)*length);
 return{x:sx/length*amount||0,y:sy/length*amount||0};
}

export function cameraRelativeMove(strafe,forward,yaw){
 if(!finite(strafe)||!finite(forward)||!finite(yaw))return zero();
 const input=boundedVector(strafe,forward),cos=Math.cos(yaw),sin=Math.sin(yaw);
 return boundedVector(cos*input.x+sin*input.y,sin*input.x-cos*input.y);
}

export function joystickVector(dx,dy,radius=48){
 if(!finite(dx)||!finite(dy)||!finite(radius)||radius<=0)return zero();
 const vector=boundedVector(dx,-dy,radius);
 return Math.hypot(vector.x,vector.y)<=.12?zero():vector;
}

export function advanceArenaJump(state={},dt,{trigger=false}={}){
 if(!state||typeof state!=='object'||Array.isArray(state))return ground();
 let{height=0,velocity=0,grounded=true}=state;
 if(!finite(height)||height<0||!finite(velocity)||typeof grounded!=='boolean')return ground();
 if(grounded){height=0;velocity=0;}
 if(!finite(dt))return{height,velocity,grounded};
 const seconds=Math.min(.1,Math.max(0,dt));
 // trigger is one press, consumed by the controller. A press in the air does
 // not reset either vertical speed or height.
 if(grounded){if(trigger!==true)return ground();velocity=5.4;grounded=false;}
 height+=velocity*seconds-7*seconds*seconds;velocity-=14*seconds;
 if(!finite(height)||!finite(velocity)||height<0||height===0&&velocity<=0)return ground();
 return{height,velocity,grounded};
}
