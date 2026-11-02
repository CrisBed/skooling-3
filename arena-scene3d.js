import * as THREE from './vendor/three-r187.module.min.js';
import {ARENA_BUILDINGS} from './arena-render.js';
import {createArenaCharacter3D} from './arena-character3d.js';

const scale=.08,position=(x,y)=>new THREE.Vector3((x-500)*scale,0,(y-320)*scale);
const rarity={noncomune:0x5bae6b,comune:0xb4bcb6,rara:0x3a9ee9,epica:0xb176e0,leggendaria:0xffbc3f};
const bounded=(value,min,max)=>Math.max(min,Math.min(max,value));

// One persistent scene. The controller owns the clock, input and all rewards.
export function createArenaScene3D(host,{onContextLost=()=>{}}={}){
 if(!host?.appendChild)throw Error('Non trovo lo spazio per aprire l’isola 3D.');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(56,1,.12,220);
 let renderer;
 try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}
 catch{throw Error('Il 3D non si è avviato su questo dispositivo. Puoi tornare alla mappa 2D.');}
 renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.4));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
 const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Isola 3D in terza persona. Muoviti con il joystick o la tastiera e trascina per guardarti intorno.');canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px';host.appendChild(canvas);
 scene.background=new THREE.Color(0x9ddff1);scene.fog=new THREE.Fog(0xbbe7ec,80,170);
 const hemisphere=new THREE.HemisphereLight(0xd9f3ff,0x809b62,2.2);scene.add(hemisphere);
 const sun=new THREE.DirectionalLight(0xfff0cf,3.1);sun.position.set(-24,40,24);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-52;sun.shadow.camera.right=52;sun.shadow.camera.top=42;sun.shadow.camera.bottom=-42;sun.shadow.camera.near=1;sun.shadow.camera.far=110;sun.shadow.bias=-.0004;sun.shadow.normalBias=.08;scene.add(sun);
 const geometries=new Set(),materials=new Set(),textures=new Set(),obstacles=[],robots=new Map(),cars=new Map(),loot=new Map(),covers=[],beams=[];
 let disposed=false,lost=false,yaw=0,pitch=.24,width=0,height=0,firstCamera=true,clock=0,previousPlayer=null,wallSignature='';
 const geo=g=>(geometries.add(g),g),material=(color,options={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.84,metalness:0,...options});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),sphere=geo(new THREE.SphereGeometry(1,12,8)),cylinder=geo(new THREE.CylinderGeometry(1,1,1,12)),cone=geo(new THREE.ConeGeometry(1,1,8)),ring=geo(new THREE.TorusGeometry(1,.04,5,30)),circle=geo(new THREE.CircleGeometry(1,24));
 const colors={grass:material(0x80c56e),sand:material(0xead5a0),road:material(0xecd9b2),line:material(0xfff1c9),stone:material(0xc9d7d8),roof:material(0x4d8194),clay:material(0xde8560),cream:material(0xffe8b8),wood:material(0xad7d4d),woodLight:material(0xd1a671),ink:material(0x24435c),glass:material(0x89d5ec,{roughness:.2,metalness:.25}),metal:material(0x839aa9,{metalness:.3,roughness:.45}),rubber:material(0x253a45),robot:material(0x777fc2),eye:material(0xffde6c,{emissive:0xe8b94b,emissiveIntensity:.35}),white:material(0xf1f4e8)};
 const blobMat=new THREE.MeshBasicMaterial({color:0x234b55,transparent:true,opacity:.17,depthWrite:false});materials.add(blobMat);
 const glowMat=new THREE.MeshBasicMaterial({color:0x6fe5ec,transparent:true,opacity:.75,depthWrite:false});materials.add(glowMat);
 function mesh(parent,g,m,x=0,y=0,z=0,sx=1,sy=1,sz=1,shadow=false){const value=new THREE.Mesh(g,m);value.position.set(x,y,z);value.scale.set(sx,sy,sz);value.castShadow=shadow;value.receiveShadow=true;parent.add(value);return value;}
 function blob(parent,w=1,d=1){const value=mesh(parent,circle,blobMat,0,.09,0,w,d,1);value.rotation.x=-Math.PI/2;return value;}
 function block(parent,m,x,y,z,w,h,d,shadow=false){return mesh(parent,box,m,x,y,z,w,h,d,shadow);}
 function roundedShape(w,d,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-d/2);s.lineTo(w/2-r,-d/2);s.quadraticCurveTo(w/2,-d/2,w/2,-d/2+r);s.lineTo(w/2,d/2-r);s.quadraticCurveTo(w/2,d/2,w/2-r,d/2);s.lineTo(-w/2+r,d/2);s.quadraticCurveTo(-w/2,d/2,-w/2,d/2-r);s.lineTo(-w/2,-d/2+r);s.quadraticCurveTo(-w/2,-d/2,-w/2+r,-d/2);return s;}
 function island(w,d,y,m){const g=geo(new THREE.ExtrudeGeometry(roundedShape(w,d,7),{depth:1.2,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.55,bevelThickness:.35,curveSegments:8}));g.computeBoundingBox();g.translate(0,0,-g.boundingBox.max.z);const value=mesh(scene,g,m,0,y,0);value.rotation.x=-Math.PI/2;return value;}
 const seaMat=new THREE.MeshPhongMaterial({color:0x41b7cb,specular:0xa7e7e9,shininess:75});materials.add(seaMat);
 mesh(scene,geo(new THREE.PlaneGeometry(300,240)),seaMat,0,-1.15,0).rotation.x=-Math.PI/2;
 island(85,59,-.25,colors.sand);island(80,54,0,colors.grass);
 block(scene,colors.road,0,.035,-.64,74,.065,5.2);block(scene,colors.road,.96,.035,0,5.2,.065,47);
 for(const b of ARENA_BUILDINGS){const p=position(b.door.x,b.door.y);if(b.id==='casa'||b.id==='castello'){block(scene,colors.road,p.x,.04,(p.z-.64)/2,3,.07,Math.abs(p.z+.64));}else block(scene,colors.road,(p.x+.96)/2,.04,p.z,Math.abs(p.x-.96),.07,3);}
 const dash=new THREE.InstancedMesh(box,colors.line,36);let dashIndex=0;const transform=new THREE.Object3D();
 for(let x=-34;x<=34;x+=4){transform.position.set(x,.076,-.64);transform.scale.set(1.4,.018,.075);transform.updateMatrix();dash.setMatrixAt(dashIndex++,transform.matrix);}
 for(let z=-21;z<=21;z+=3){transform.position.set(.96,.076,z);transform.scale.set(.075,.018,1.1);transform.updateMatrix();dash.setMatrixAt(dashIndex++,transform.matrix);}
 dash.count=dashIndex;dash.receiveShadow=true;scene.add(dash);
 const treePositions=[];for(let i=0;i<11;i++){treePositions.push([-37.8,-22+i*4.4],[37.8,-22+i*4.4]);}for(let i=0;i<12;i++)treePositions.push([-32+i*5.8,-25.5],[-32+i*5.8,25.5]);
 const trunkMat=material(0x916741),leafMat=material(0x39996e),leafTop=material(0x68bc70);
 const trunks=new THREE.InstancedMesh(cylinder,trunkMat,treePositions.length),crowns=new THREE.InstancedMesh(sphere,leafMat,treePositions.length),tops=new THREE.InstancedMesh(sphere,leafTop,treePositions.length);
 treePositions.forEach(([x,z],i)=>{const k=.9+(i%4)*.12;for(const [object,px,py,pz,sx,sy,sz]of[[trunks,x,1.0,z,.18,2,.18],[crowns,x,2.7*k,z,1.35*k,1.65*k,1.3*k],[tops,x-.25,3.6*k,z-.12,1.05*k,1.05*k,1.05*k]]){transform.position.set(px,py,pz);transform.scale.set(sx,sy,sz);transform.updateMatrix();object.setMatrixAt(i,transform.matrix);}});
 for(const value of [trunks,crowns,tops]){value.castShadow=true;value.receiveShadow=true;scene.add(value);}
 for(const[x,z,s]of[[-33,-27,4],[29,-28,5],[-31,27,3],[35,24,3]])mesh(scene,sphere,colors.grass,x,.0,z,s,s*.58,s*.7);
 const rocks=new THREE.InstancedMesh(geo(new THREE.DodecahedronGeometry(1,0)),colors.stone,18);
 for(let i=0;i<18;i++){const angle=i/18*Math.PI*2;transform.position.set(Math.cos(angle)*42,-.65,Math.sin(angle)*29);transform.rotation.set(i*.13,i*.7,0);transform.scale.set(1.2+(i%3)*.3,.9,1);transform.updateMatrix();rocks.setMatrixAt(i,transform.matrix);}scene.add(rocks);
 function sign(parent,text,y,w=5){
  const image=document.createElement('canvas');image.width=512;image.height=96;const ctx=image.getContext('2d');if(!ctx)return;
  ctx.fillStyle='#fff4d5';ctx.beginPath();ctx.roundRect(5,5,502,86,24);ctx.fill();ctx.strokeStyle='#34566a';ctx.lineWidth=6;ctx.stroke();ctx.fillStyle='#24435c';ctx.font='700 37px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,49,470);
  const texture=new THREE.CanvasTexture(image);texture.colorSpace=THREE.SRGBColorSpace;textures.add(texture);const m=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});materials.add(m);const value=new THREE.Sprite(m);value.position.y=y;value.scale.set(w,w*96/512,1);parent.add(value);
 }
 const triangle=new THREE.Shape();triangle.moveTo(-.5,0);triangle.lineTo(.5,0);triangle.lineTo(0,1);triangle.closePath();const roofGeo=geo(new THREE.ExtrudeGeometry(triangle,{depth:1,bevelEnabled:false}));roofGeo.translate(0,0,-.5);
 function door(parent,b,w,d,h){
  const center={x:b.x+b.w/2,y:b.y+b.h/2},dx=b.door.x-center.x,dy=b.door.y-center.y,side=Math.abs(dx)>Math.abs(dy),face=new THREE.Group();
  face.position.set(side?Math.sign(dx)*(w/2+.025):0,0,side?0:Math.sign(dy)*(d/2+.025));face.rotation.y=side?Math.sign(dx)*Math.PI/2:dy<0?Math.PI:0;parent.add(face);
  block(face,colors.ink,0,1.1,.025,1.28,2.2,.12);block(face,colors.wood,0,1.04,.10,1.03,2.05,.07);block(face,colors.cream,-.36,1.05,.145,.06,1.9,.025);mesh(face,sphere,colors.eye,.29,1.05,.18,.055,.055,.04);
  const faceWidth=side?d:w;for(const x of[-faceWidth*.29,faceWidth*.29]){block(face,colors.white,x,h*.55,.07,1.25,1.45,.1);block(face,colors.glass,x,h*.55,.13,1.06,1.24,.04);block(face,colors.white,x,h*.55,.16,.06,1.24,.04);}
  if(b.id==='negozio')for(let i=0;i<8;i++)block(face,i%2?colors.cream:colors.roof,-2.8+i*.8,2.75,.75,.8,.15,1.5);
 }
 for(const b of ARENA_BUILDINGS){
  const building=new THREE.Group(),p=position(b.x+b.w/2,b.y+b.h/2),w=b.w*scale,d=b.h*scale,h=b.id==='castello'?5.5:b.id==='benzinaio'?3.6:4.4;building.position.copy(p);scene.add(building);
  const body=block(building,b.id==='castello'?colors.stone:colors.cream,0,h/2,0,w,h,d,true);obstacles.push(body);door(building,b,w,d,h);
  if(b.id==='castello'){
   const battlements=new THREE.InstancedMesh(box,colors.stone,40);let n=0;
   for(const x of[-w/2+.65,w/2-.65])for(const z of[-d/2+.65,d/2-.65]){const tower=mesh(building,cylinder,colors.stone,x,3.5,z,1.1,7,1.1,true);obstacles.push(tower);mesh(building,cone,colors.roof,x,7.8,z,1.5,2.2,1.5,true);block(building,colors.ink,x,5,z+1.06,.35,.9,.08);}
   for(let x=-w/2+.4;x<w/2;x+=1.3)for(const z of[-d/2,d/2]){transform.position.set(x,h+.35,z);transform.scale.set(.72,.72,.65);transform.rotation.set(0,0,0);transform.updateMatrix();battlements.setMatrixAt(n++,transform.matrix);}
   battlements.count=n;battlements.castShadow=true;building.add(battlements);
   mesh(building,cylinder,colors.ink,0,7.4,0,.045,3.6,.045);const flag=geo(new THREE.PlaneGeometry(1.5,.85));mesh(building,flag,material(0xe87958,{side:THREE.DoubleSide}),.77,8.65,0);
  }else{
   const roof=mesh(building,roofGeo,b.id==='casa'?colors.clay:colors.roof,0,h,0,w+.7,1.9,d+.8,true);obstacles.push(roof);
   if(b.id==='casa')block(building,colors.stone,w*.27,h+1.1,-d*.2,.8,2,.8,true);
   if(b.id==='benzinaio'){
    const pump=new THREE.Group();pump.position.set(-w/2-1.4,0,0);building.add(pump);block(pump,colors.clay,0,1,0,.8,2,.7);block(pump,colors.ink,0,1.45,-.365,.55,.4,.04);block(pump,colors.eye,0,1.45,-.39,.4,.19,.015);mesh(pump,ring,colors.rubber,.48,1.02,0,.35,.65,.35).rotation.y=Math.PI/2;
   }
  }
  sign(building,b.id==='casa'?'Casa del riposo':b.id==='castello'?'Castello delle Idee':b.id==='negozio'?'Negozio':'Benzinaio',h+(b.id==='castello'?4.5:2.9),b.id==='castello'?7:5.7);
 }
 const character=createArenaCharacter3D();scene.add(character.group,character.companion);character.group.traverse(object=>{if(object.isMesh)object.castShadow=false;});const playerShadow=new THREE.Group();blob(playerShadow,.48,.38);scene.add(playerShadow);
 function robotModel(){const group=new THREE.Group();blob(group,.52,.4);mesh(group,sphere,colors.robot,0,.80,0,.37,.44,.29);block(group,colors.metal,0,1.34,0,.65,.47,.51);block(group,colors.ink,0,1.35,-.27,.53,.18,.05);block(group,colors.eye,0,1.35,-.31,.39,.07,.025);mesh(group,cylinder,colors.metal,0,1.73,0,.025,.3,.025);mesh(group,sphere,colors.eye,0,1.90,0,.07,.07,.07);for(const s of[-1,1]){mesh(group,cylinder,colors.ink,s*.20,.29,0,.075,.55,.075);block(group,colors.metal,s*.2,.09,-.05,.22,.16,.33);mesh(group,cylinder,colors.metal,s*.46,.87,0,.065,.48,.065).rotation.z=s*.23;}scene.add(group);return group;}
 function carModel(color){
  const group=new THREE.Group(),paint=material(color||0xe38743,{roughness:.45,metalness:.15});blob(group,1.15,1.9);
  block(group,colors.ink,0,.4,0,1.7,.3,3.3);block(group,paint,0,.72,0,1.85,.55,3.45);block(group,paint,0,.93,-1.12,1.75,.20,1.05);block(group,colors.glass,0,1.23,.17,1.48,.67,1.45);block(group,paint,0,1.59,.2,1.5,.12,1.5);block(group,paint,0,1.2,.84,1.52,.65,.09);
  block(group,colors.ink,0,.55,-1.77,1.70,.14,.10);block(group,colors.ink,0,.55,1.77,1.70,.14,.10);
  for(const x of[-.58,.58]){block(group,colors.white,x,.79,-1.75,.33,.18,.035);block(group,colors.clay,x,.79,1.75,.33,.14,.035);}
  const wheels=[];for(const x of[-.93,.93])for(const z of[-1.05,1.05]){const wheel=mesh(group,cylinder,colors.rubber,x,.43,z,.40,.25,.40);wheel.rotation.z=Math.PI/2;wheels.push(wheel);mesh(group,cylinder,colors.metal,x*1.11,.43,z,.20,.025,.20).rotation.z=Math.PI/2;}
  scene.add(group);return{group,wheels,last:null};
 }
 function lootModel(r){const group=new THREE.Group(),color=material(rarity[r]||rarity.noncomune,{roughness:.45,metalness:.15});blob(group,.65,.55);block(group,color,0,.49,0,.94,.76,.82);block(group,colors.wood,0,.9,0,1.03,.13,.92);for(const x of[-.28,.28])block(group,colors.white,x,.55,0,.07,.9,.94);block(group,colors.eye,0,.60,-.44,.16,.22,.07);const halo=mesh(group,ring,color,0,.10,0,.8,.8,.8);halo.rotation.x=-Math.PI/2;const marker=mesh(group,geo(new THREE.OctahedronGeometry(.17,0)),color,0,1.65,0);scene.add(group);return{group,marker};}
 function coverModel(){const group=new THREE.Group();const body=block(group,colors.wood,0,.95,0,1,1.9,1,true);for(const x of[-.45,0,.45])block(group,colors.woodLight,x,1.05,-.51,.07,1.9,.03);scene.add(group);obstacles.push(body);return{group,body};}
 function beamModel(){const value=mesh(scene,cylinder,glowMat,0,0,0,.045,1,.045);value.visible=false;return value;}
 const ray=new THREE.Raycaster(),target=new THREE.Vector3(),desired=new THREE.Vector3(),candidate=new THREE.Vector3(),direction=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
 function clipCamera(from,to){direction.subVectors(to,from);const length=direction.length();if(length<.001)return to;direction.divideScalar(length);ray.set(from,direction);ray.far=length;const hits=ray.intersectObjects(obstacles.filter(o=>o.visible&&o.parent.visible),false);if(hits.length)to.copy(from).addScaledVector(direction,Math.max(.65,hits[0].distance-.27));to.y=Math.max(.65,to.y);return to;}
 function resize(){if(disposed)return;const rect=host.getBoundingClientRect(),w=Math.round(host.clientWidth||rect.width||width||960),h=Math.round(host.clientHeight||rect.height||height||540);if(w===width&&h===height)return;width=Math.max(1,w);height=Math.max(1,h);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
 function contextLost(event){event.preventDefault();lost=true;onContextLost(event);}
 function contextRestored(){if(disposed)return;lost=false;renderer.shadowMap.needsUpdate=true;resize();}
 canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;if(observer)observer.observe(host);window.addEventListener('resize',resize);resize();renderer.shadowMap.needsUpdate=true;
 function update(world,profile,{dt=0,elapsed=0,shotUntil=0,paused=false}={}){
  if(disposed||lost||!world?.player)return;resize();const delta=paused?0:Number.isFinite(dt)?bounded(dt,0,.1):0;clock+=delta;
  const player=position(world.player.x,world.player.y),jump=Number.isFinite(world.jumpHeight)?Math.max(0,world.jumpHeight):0;
  const moved=previousPlayer?player.distanceTo(previousPlayer):0,moving=delta>0&&moved>.002;previousPlayer=player.clone();character.setAppearance(profile?.equipped||{});character.group.position.copy(player);character.group.position.y=jump;character.group.rotation.y=-(world.player.angle||0)-Math.PI/2;character.update({moving,dt:delta,driving:Boolean(world.driving),aiming:elapsed<shotUntil});
  playerShadow.position.copy(player);playerShadow.children[0].material.opacity=.17;playerShadow.scale.setScalar(1+Math.min(jump,3)*.12);character.companion.position.copy(player).add(new THREE.Vector3(-Math.cos(yaw)*.8,.08+Math.sin(clock*3)*.05,-Math.sin(yaw)*.8));character.companion.rotation.y=character.group.rotation.y;
  for(const item of world.robots||[]){let group=robots.get(item.id);if(!group){group=robotModel();robots.set(item.id,group);}group.visible=item.alive!==false;group.position.copy(position(item.x,item.y));group.rotation.y=Math.atan2(group.position.x-player.x,group.position.z-player.z);if(delta)group.children[1].rotation.z=Math.sin(clock*4+group.position.x)*.035;}
  for(const item of world.cars||[]){let car=cars.get(item.id);if(!car){car=carModel(item.color);cars.set(item.id,car);}const p=position(item.x,item.y);if(car.last&&delta){const turn=p.distanceTo(car.last)/.4;for(const wheel of car.wheels)wheel.rotateY(turn);}car.last=p.clone();car.group.position.copy(p);car.group.rotation.y=-(item.angle||0)-Math.PI/2;}
  for(const item of world.loot||[]){let value=loot.get(item.id);if(!value){value=lootModel(item.rarity);loot.set(item.id,value);}value.group.visible=!item.opened;value.group.position.copy(position(item.x,item.y));value.marker.position.y=1.65+Math.sin(clock*2.5+value.group.position.x)*.11;if(delta)value.marker.rotation.y+=delta*.8;}
  const activeRobots=new Set((world.robots||[]).map(v=>v.id)),activeCars=new Set((world.cars||[]).map(v=>v.id)),activeLoot=new Set((world.loot||[]).map(v=>v.id));for(const[id,value]of robots)if(!activeRobots.has(id))value.visible=false;for(const[id,value]of cars)if(!activeCars.has(id))value.group.visible=false;for(const[id,value]of loot)if(!activeLoot.has(id))value.group.visible=false;
  const walls=world.walls||[];for(let i=0;i<Math.max(covers.length,walls.length);i++){if(!covers[i])covers[i]=coverModel();const value=covers[i],wall=walls[i];value.group.visible=Boolean(wall);if(wall){value.group.position.copy(position(wall.x+wall.w/2,wall.y+wall.h/2));value.group.scale.set(wall.w*scale,1,wall.h*scale);}}
  const signature=JSON.stringify(walls);if(signature!==wallSignature){wallSignature=signature;renderer.shadowMap.needsUpdate=true;}
  const shots=elapsed<shotUntil&&!paused?(world.shots||[]):[];for(let i=0;i<Math.max(beams.length,shots.length);i++){if(!beams[i])beams[i]=beamModel();const beam=beams[i],shot=shots[i];beam.visible=Boolean(shot);if(shot){const from=position(shot.from.x,shot.from.y),to=position(shot.to.x,shot.to.y);from.y=1.2+jump;to.y=1.15;direction.subVectors(to,from);beam.position.copy(from).add(to).multiplyScalar(.5);beam.scale.set(.055,direction.length(),.055);beam.quaternion.setFromUnitVectors(up,direction.normalize());}}
  target.copy(player);target.y=1.42+jump*.7;const distance=world.driving?8.4:6.1,horizontal=Math.cos(pitch)*distance;desired.set(target.x-Math.sin(yaw)*horizontal,target.y+Math.sin(pitch)*distance,target.z+Math.cos(yaw)*horizontal);
  scene.updateMatrixWorld(true);clipCamera(target,desired);const teleport=firstCamera||camera.position.distanceTo(desired)>18;
  candidate.copy(camera.position);if(teleport)candidate.copy(desired);else if(delta)candidate.lerp(desired,1-Math.exp(-delta*9));else if(paused===false)candidate.copy(desired);clipCamera(target,candidate);camera.position.copy(candidate);camera.lookAt(target);firstCamera=false;
  renderer.render(scene,camera);host.dataset.sceneCalls=String(renderer.info.render.calls);host.dataset.sceneTriangles=String(renderer.info.render.triangles);
 }
 function look(dx,dy){if(disposed)return;if(Number.isFinite(dx))yaw=Math.atan2(Math.sin(yaw+bounded(dx,-350,350)*.004),Math.cos(yaw+bounded(dx,-350,350)*.004));if(Number.isFinite(dy))pitch=bounded(pitch+bounded(dy,-350,350)*.003,.06,.95);}
 function dispose(){if(disposed)return;disposed=true;observer?.disconnect();window.removeEventListener('resize',resize);canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);character.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();scene.clear();sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();delete host.dataset.sceneCalls;delete host.dataset.sceneTriangles;}
 return{update,look,getYaw:()=>yaw,resize,dispose};
}
