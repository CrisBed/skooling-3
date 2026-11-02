import * as THREE from './vendor/three-r187.module.min.js';
import {ARENA_BUILDINGS} from './arena-render.js';
import {createArenaCharacter3D} from './arena-character3d.js';
import {CASTLE_ROOM,inArenaCastle,visibleArenaLoot,arenaLootPosition} from './arena-castle.js';
import {ARENA_RESOURCE_NODES} from './arena-building.js';
import {createArenaWorldVisual} from './arena-world-render.js';
import {sampleArenaSurface,CAVE_ROOMS,ARENA_WORLD_BOUNDS} from './arena-world-model.js';

const scale=.08,position=(x,y)=>new THREE.Vector3((x-500)*scale,0,(y-320)*scale);
const rarity={noncomune:0x5bae6b,comune:0xb4bcb6,rara:0x3a9ee9,epica:0xb176e0,leggendaria:0xffbc3f};
const bounded=(value,min,max)=>Math.max(min,Math.min(max,value));

// One persistent scene. The controller owns the clock, input and all rewards.
export function createArenaScene3D(host,{onContextLost=()=>{}}={}){
 if(!host?.appendChild)throw Error('Non trovo lo spazio per aprire l’isola 3D.');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(56,1,.12,220);
 const islandGroup=new THREE.Group(),castleGroup=new THREE.Group(),lootGroup=new THREE.Group();islandGroup.name='arena-island';castleGroup.name='arena-castle-room';lootGroup.name='arena-loot';castleGroup.visible=false;scene.add(islandGroup,castleGroup,lootGroup);
 const worldVisual=createArenaWorldVisual(THREE);islandGroup.add(worldVisual.islandGroup);scene.add(worldVisual.caveGroup);
 let renderer;
 try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}
 catch{worldVisual.dispose();throw Error('Il 3D non si è avviato su questo dispositivo. Puoi tornare alla mappa 2D.');}
 renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.4));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
 const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Isola 3D in terza persona. Muoviti con il joystick o la tastiera e trascina per guardarti intorno.');canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px';host.appendChild(canvas);
 scene.background=new THREE.Color(0xe9c9ac);scene.fog=new THREE.Fog(0xe5c9ac,85,185);
 const hemisphere=new THREE.HemisphereLight(0xbfdcf4,0x6d7852,1.65);scene.add(hemisphere);
 const sun=new THREE.DirectionalLight(0xffd39b,3.4);sun.position.set(-32,30,24);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-52;sun.shadow.camera.right=52;sun.shadow.camera.top=42;sun.shadow.camera.bottom=-42;sun.shadow.camera.near=1;sun.shadow.camera.far=110;sun.shadow.bias=-.0004;sun.shadow.normalBias=.08;scene.add(sun);
 scene.add(sun.target);
 const geometries=new Set(),materials=new Set(),textures=new Set(),islandObstacles=[],castleObstacles=[],robots=new Map(),cars=new Map(),loot=new Map(),coversByArea={island:[],castle:[],cave:[]},beams=[],enemyBeams=[];
 let disposed=false,lost=false,yaw=0,pitch=.24,width=0,height=0,firstCamera=true,clock=0,previousPlayer=null,wallSignature='',currentArea=null,currentCaveId=null,petInitialized=false,previousPetId='',resourceSignature='',hadHarvestFlash=false,shadowCell='';
 const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)'),reducedMotion=()=>Boolean(motionPreference?.matches);
 const petPosition=new THREE.Vector3(),petTarget=new THREE.Vector3();
 const geo=g=>(geometries.add(g),g),material=(color,options={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.84,metalness:0,...options});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),sphere=geo(new THREE.SphereGeometry(1,12,8)),cylinder=geo(new THREE.CylinderGeometry(1,1,1,12)),cone=geo(new THREE.ConeGeometry(1,1,8)),ring=geo(new THREE.TorusGeometry(1,.04,5,30)),circle=geo(new THREE.CircleGeometry(1,24));
 function detailTexture(kind){
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const value=Math.sin(x*41.7+y*211.1)*12345.678,noise=value-Math.floor(value),seam=kind==='roof'?(y%12<1||((x+(Math.floor(y/12)%2)*12)%24<1)?-.22:0):kind==='stone'?(y%16<1||((x+(Math.floor(y/16)%2)*8)%16<1)?-.18:0):kind==='wood'?Math.sin(x*.65+Math.sin(y*.12)*.6)*.065:0,v=bounded(.88+noise*.12+seam,0,1);data.set([v*255,v*255,v*255,255],(y*size+x)*4);}
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;textures.add(texture);return texture;
 }
 const roadTexture=detailTexture('road'),stoneTexture=detailTexture('stone'),roofTexture=detailTexture('roof'),woodTexture=detailTexture('wood');
 const colors={grass:material(0x80c56e),sand:material(0xead5a0),road:material(0xc9b98d,{map:roadTexture}),line:material(0xfff1c9),stone:material(0xa4b1b1,{map:stoneTexture}),roof:material(0x425d75,{map:roofTexture}),clay:material(0xc16c50,{map:roofTexture}),cream:material(0xead3a2,{map:roadTexture}),wood:material(0xa4784b,{map:woodTexture}),woodLight:material(0xc6a474,{map:woodTexture}),ink:material(0x24435c),glass:material(0x72bfd5,{roughness:.18,metalness:.4,emissive:0x1e4b5c,emissiveIntensity:.12}),metal:material(0x839aa9,{metalness:.45,roughness:.35}),rubber:material(0x253a45),robot:material(0x777fc2),eye:material(0xffde6c,{emissive:0xe8b94b,emissiveIntensity:.35}),white:material(0xf1f4e8)};
 const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,uniforms:{topColor:{value:new THREE.Color(0x477eab)},horizonColor:{value:new THREE.Color(0xffd6ac)},sunDirection:{value:new THREE.Vector3(-.66,.30,.50).normalize()}},vertexShader:'varying vec3 arenaSkyDirection; void main(){ arenaSkyDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',fragmentShader:'varying vec3 arenaSkyDirection; uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDirection; void main(){ vec3 d=normalize(arenaSkyDirection); float up=clamp(d.y,0.0,1.0); vec3 color=mix(horizonColor,topColor,pow(up,.55)); float alignment=max(0.0,dot(d,sunDirection)); color+=vec3(1.0,.50,.18)*pow(alignment,13.0)*.22; color=mix(color,vec3(1.0,.93,.73),smoothstep(.9981,.9995,alignment)); gl_FragColor=vec4(color,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});materials.add(skyMaterial);
 const sky= new THREE.Mesh(geo(new THREE.SphereGeometry(190,24,16)),skyMaterial);sky.name='arena-sunset-sky';sky.renderOrder=-1000;sky.frustumCulled=false;scene.add(sky);
 const clouds=new THREE.InstancedMesh(sphere,material(0xffead6,{roughness:1}),60);clouds.name='arena-procedural-clouds';clouds.frustumCulled=false;islandGroup.add(clouds);
 const cloudTransform=new THREE.Object3D();for(let i=0;i<20;i++){const angle=i/20*Math.PI*2,r=68+(i%4)*13;for(let j=0;j<3;j++){cloudTransform.position.set(Math.cos(angle)*r+(j-1)*3,37+(i%5)*2,Math.sin(angle)*r);cloudTransform.scale.set(5-j*.6,1.6+(i%3)*.3,2.6);cloudTransform.rotation.y=angle;cloudTransform.updateMatrix();clouds.setMatrixAt(i*3+j,cloudTransform.matrix);}}clouds.instanceMatrix.needsUpdate=true;
 const blobMat=new THREE.MeshBasicMaterial({color:0x234b55,transparent:true,opacity:.17,depthWrite:false});materials.add(blobMat);
 const glowMat=new THREE.MeshBasicMaterial({color:0xffe66b,transparent:true,opacity:.85,depthWrite:false});materials.add(glowMat);
 const enemyGlowMat=new THREE.MeshBasicMaterial({color:0xff613b,transparent:true,opacity:.95,depthWrite:false});materials.add(enemyGlowMat);
 function mesh(parent,g,m,x=0,y=0,z=0,sx=1,sy=1,sz=1,shadow=false){const value=new THREE.Mesh(g,m);value.position.set(x,y,z);value.scale.set(sx,sy,sz);value.castShadow=shadow;value.receiveShadow=true;parent.add(value);return value;}
 function blob(parent,w=1,d=1){const value=mesh(parent,circle,blobMat,0,.09,0,w,d,1);value.rotation.x=-Math.PI/2;return value;}
 function block(parent,m,x,y,z,w,h,d,shadow=false){return mesh(parent,box,m,x,y,z,w,h,d,shadow);}
 const groundAt=(x,y,area='island',caveId=null)=>sampleArenaSurface(x,y,{area,caveId})?.height??0;
 block(islandGroup,colors.road,0,.035,-.64,74,.065,5.2);block(islandGroup,colors.road,.96,.035,0,5.2,.065,47);
 for(const b of ARENA_BUILDINGS){const p=position(b.door.x,b.door.y);if(b.id==='casa'||b.id==='castello'){block(islandGroup,colors.road,p.x,.04,(p.z-.64)/2,3,.07,Math.abs(p.z+.64));}else block(islandGroup,colors.road,(p.x+.96)/2,.04,p.z,Math.abs(p.x-.96),.07,3);}
 const dash=new THREE.InstancedMesh(box,colors.line,36);let dashIndex=0;const transform=new THREE.Object3D();
 for(let x=-34;x<=34;x+=4){transform.position.set(x,.076,-.64);transform.scale.set(1.4,.018,.075);transform.updateMatrix();dash.setMatrixAt(dashIndex++,transform.matrix);}
 for(let z=-21;z<=21;z+=3){transform.position.set(.96,.076,z);transform.scale.set(.075,.018,1.1);transform.updateMatrix();dash.setMatrixAt(dashIndex++,transform.matrix);}
 dash.count=dashIndex;dash.receiveShadow=true;islandGroup.add(dash);
 const treeDefinitions=ARENA_RESOURCE_NODES.filter(node=>node.kind==='tree'),brickDefinitions=ARENA_RESOURCE_NODES.filter(node=>node.kind==='brick');
 const trunkMat=material(0x805b3d,{map:woodTexture}),leafMat=material(0x377c56,{roughness:1}),leafTop=material(0x69a35b,{roughness:1});
 const trunks=new THREE.InstancedMesh(cylinder,trunkMat,treeDefinitions.length),crowns=new THREE.InstancedMesh(sphere,leafMat,treeDefinitions.length),tops=new THREE.InstancedMesh(sphere,leafTop,treeDefinitions.length);trunks.name='arena-resource-trunks';
 const pineCrowns=new THREE.InstancedMesh(cone,leafMat,treeDefinitions.length*2),branches=new THREE.InstancedMesh(cylinder,trunkMat,treeDefinitions.length*2);pineCrowns.name='arena-resource-pine-crowns';
 for(const value of [trunks,crowns,tops,pineCrowns,branches]){value.castShadow=true;value.receiveShadow=true;islandGroup.add(value);}
 const leafTint=new THREE.Color();for(let i=0;i<treeDefinitions.length;i++){leafTint.setHex([0xdce6ae,0xa6c59d,0xc9dca0,0x95bc9c][i%4]);crowns.setColorAt(i,leafTint);tops.setColorAt(i,leafTint);pineCrowns.setColorAt(i*2,leafTint);pineCrowns.setColorAt(i*2+1,leafTint);}
 const brickMaterial=material(0xb67b62),mortarMaterial=material(0x82796b),resourceBricks=new THREE.InstancedMesh(box,brickMaterial,brickDefinitions.length*7);resourceBricks.name='arena-resource-bricks';resourceBricks.castShadow=true;resourceBricks.receiveShadow=true;islandGroup.add(resourceBricks);islandObstacles.push(trunks,resourceBricks);
 const pipMaterial=new THREE.MeshBasicMaterial({color:0xffeb9f});materials.add(pipMaterial);const resourcePips=new THREE.InstancedMesh(geo(new THREE.OctahedronGeometry(1,0)),pipMaterial,ARENA_RESOURCE_NODES.length*3);islandGroup.add(resourcePips);
 const zeroInstance=new THREE.Matrix4().makeScale(0,0,0);
 function instance(object,index,x,y,z,sx,sy,sz,tilt=0){transform.position.set(x,y,z);transform.rotation.set(0,0,tilt);transform.scale.set(sx,sy,sz);transform.updateMatrix();object.setMatrixAt(index,transform.matrix);}
 function updateResources(world,elapsed,paused){
  const nodes=Array.isArray(world.materials?.nodes)?world.materials.nodes:ARENA_RESOURCE_NODES,byId=new Map(nodes.map(node=>[node.id,node])),signature=nodes.map(node=>node.id+':'+node.health).join('|'),flash=!paused&&world.harvestFlash?.expiresAt>elapsed?world.harvestFlash:null;
  if(signature===resourceSignature&&!flash&&!hadHarvestFlash)return;
  if(signature!==resourceSignature){resourceSignature=signature;renderer.shadowMap.needsUpdate=true;}hadHarvestFlash=Boolean(flash);
  treeDefinitions.forEach((definition,i)=>{
   const node=byId.get(definition.id);if(!node||node.health<=0){for(const object of[trunks,crowns,tops])object.setMatrixAt(i,zeroInstance);for(const object of[pineCrowns,branches]){object.setMatrixAt(i*2,zeroInstance);object.setMatrixAt(i*2+1,zeroInstance);}return;}
   const p=position(node.x,node.y),floor=groundAt(node.x,node.y),k=.9+(i%4)*.12,wobble=flash?.id===node.id?Math.sin(elapsed*48)*.055:0;
   const pine=i%4===1,broad=i%4===2;
   instance(trunks,i,p.x,floor+1.15,p.z,.18,2.3,.18,wobble);
   if(pine){crowns.setMatrixAt(i,zeroInstance);tops.setMatrixAt(i,zeroInstance);instance(pineCrowns,i*2,p.x+wobble,floor+2.35*k,p.z,1.5*k,2.8*k,1.5*k,wobble);instance(pineCrowns,i*2+1,p.x+wobble,floor+3.5*k,p.z,.95*k,2.2*k,.95*k,wobble);}
   else{pineCrowns.setMatrixAt(i*2,zeroInstance);pineCrowns.setMatrixAt(i*2+1,zeroInstance);instance(crowns,i,p.x+wobble*.9,floor+2.7*k,p.z,(broad?1.65:1.3)*k,(broad?1.08:1.48)*k,1.35*k,wobble);instance(tops,i,p.x-.40+wobble,floor+3.45*k,p.z-.25,1.08*k,.95*k,1.08*k,wobble);}
   for(let j=0;j<2;j++)instance(branches,i*2+j,p.x+(j?-.29:.29),floor+1.85+j*.35,p.z,.075,.85,.075,(j?1:-1)*.70+wobble);
  });
  brickDefinitions.forEach((definition,i)=>{
   const node=byId.get(definition.id),health=node?.health||0,p=position(definition.x+definition.w/2,definition.y+definition.h/2),w=definition.w*scale,d=definition.h*scale,remaining=health===3?7:health===2?5:health===1?3:0,wobble=flash?.id===definition.id?Math.sin(elapsed*48)*.05:0;
   const floor=groundAt(definition.x+definition.w/2,definition.y+definition.h/2);for(let j=0;j<7;j++){if(j>=remaining){resourceBricks.setMatrixAt(i*7+j,zeroInstance);continue;}const row=j<3?0:j<6?1:2,col=j<3?j:j<6?j-3:1;instance(resourceBricks,i*7+j,p.x+(col-1)*w/3+wobble,floor+.24+row*.46,p.z,w/3-.055,.43,d,wobble*.3);}
  });
  ARENA_RESOURCE_NODES.forEach((definition,i)=>{const node=byId.get(definition.id),health=node?.health||0,tree=definition.kind==='tree',x=definition.x+(tree?0:definition.w/2),y=definition.y+(tree?0:definition.h/2),p=position(x,y),treeIndex=tree?treeDefinitions.indexOf(definition):-1,h=groundAt(x,y)+(tree?4.95*(.9+(treeIndex%4)*.12):1.65);for(let j=0;j<3;j++){if(j>=health)resourcePips.setMatrixAt(i*3+j,zeroInstance);else instance(resourcePips,i*3+j,p.x+(j-1)*.29,h,p.z,.11,.11,.11);}});
  for(const object of[trunks,crowns,tops,pineCrowns,branches,resourceBricks,resourcePips]){object.instanceMatrix.needsUpdate=true;object.computeBoundingSphere();}
 }
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
  const building=new THREE.Group(),p=position(b.x+b.w/2,b.y+b.h/2),w=b.w*scale,d=b.h*scale,h=b.id==='castello'?5.5:b.id==='benzinaio'?3.6:4.4;building.position.copy(p);islandGroup.add(building);
  const body=block(building,b.id==='castello'?colors.stone:colors.cream,0,h/2,0,w,h,d,true);islandObstacles.push(body);door(building,b,w,d,h);
  const trim=new THREE.InstancedMesh(box,b.id==='castello'?colors.white:colors.wood,12);let trimIndex=0;
  for(const x of[-w/2+.075,w/2-.075])for(const z of[-d/2+.075,d/2-.075])instance(trim,trimIndex++,x,h/2,z,.15,h,.15);
  for(const z of[-d/2-.02,d/2+.02])for(const y of[.24,h-.12])instance(trim,trimIndex++,0,y,z,w,.18,.08);
  for(const x of[-w/2-.02,w/2+.02])for(const y of[.24,h-.12])instance(trim,trimIndex++,x,y,0,.08,.18,d);
  trim.castShadow=true;building.add(trim);
  if(b.id==='castello'){
   const battlements=new THREE.InstancedMesh(box,colors.stone,40);let n=0;
   for(const x of[-w/2+.65,w/2-.65])for(const z of[-d/2+.65,d/2-.65]){const tower=mesh(building,cylinder,colors.stone,x,3.5,z,1.1,7,1.1,true);islandObstacles.push(tower);mesh(building,cone,colors.roof,x,7.8,z,1.5,2.2,1.5,true);block(building,colors.ink,x,5,z+1.06,.35,.9,.08);}
   for(let x=-w/2+.4;x<w/2;x+=1.3)for(const z of[-d/2,d/2]){transform.position.set(x,h+.35,z);transform.scale.set(.72,.72,.65);transform.rotation.set(0,0,0);transform.updateMatrix();battlements.setMatrixAt(n++,transform.matrix);}
   battlements.count=n;battlements.castShadow=true;building.add(battlements);
   mesh(building,cylinder,colors.ink,0,7.4,0,.045,3.6,.045);const flag=geo(new THREE.PlaneGeometry(1.5,.85));mesh(building,flag,material(0xe87958,{side:THREE.DoubleSide}),.77,8.65,0);
  }else{
   const roof=mesh(building,roofGeo,b.id==='casa'?colors.clay:colors.roof,0,h,0,w+.7,1.9,d+.8,true);islandObstacles.push(roof);
   if(b.id==='casa')block(building,colors.stone,w*.27,h+1.1,-d*.2,.8,2,.8,true);
   if(b.id==='benzinaio'){
    const pump=new THREE.Group();pump.position.set(-w/2-1.4,0,0);building.add(pump);block(pump,colors.clay,0,1,0,.8,2,.7);block(pump,colors.ink,0,1.45,-.365,.55,.4,.04);block(pump,colors.eye,0,1.45,-.39,.4,.19,.015);mesh(pump,ring,colors.rubber,.48,1.02,0,.35,.65,.35).rotation.y=Math.PI/2;
   }
  }
  sign(building,b.id==='casa'?'Casa del riposo':b.id==='castello'?'Castello delle Idee':b.id==='negozio'?'Negozio':'Benzinaio',h+(b.id==='castello'?4.5:2.9),b.id==='castello'?7:5.7);
 }
 const roomMin=position(CASTLE_ROOM.bounds.minX,CASTLE_ROOM.bounds.minY),roomMax=position(CASTLE_ROOM.bounds.maxX,CASTLE_ROOM.bounds.maxY),roomWidth=roomMax.x-roomMin.x,roomDepth=roomMax.z-roomMin.z;
 const roomCenter=new THREE.Vector3((roomMin.x+roomMax.x)/2,0,(roomMin.z+roomMax.z)/2),roomStone=material(0xa9a393),roomTrim=material(0xd5c29d),gold=material(0xeab857,{metalness:.25,roughness:.5}),carpet=material(0xa54849),windowLight=material(0xaadce3,{emissive:0x4f959f,emissiveIntensity:.45,roughness:.35});
 block(castleGroup,roomStone,roomCenter.x,-.13,roomCenter.z,roomWidth+3.2,.26,roomDepth+3.2);
 const tiles=new THREE.InstancedMesh(box,material(0xffffff),80);let tileIndex=0;
 for(let row=0;row<8;row++)for(let col=0;col<10;col++){transform.position.set(roomMin.x+(col+.5)*roomWidth/10,.007,roomMin.z+(row+.5)*roomDepth/8);transform.rotation.set(0,0,0);transform.scale.set(roomWidth/10-.045,.014,roomDepth/8-.045);transform.updateMatrix();tiles.setMatrixAt(tileIndex,transform.matrix);tiles.setColorAt(tileIndex++,new THREE.Color((row+col)%2?0xc6beac:0xd5ccba));}
 tiles.receiveShadow=true;castleGroup.add(tiles);
 const roomHeight=6.8,wallThickness=1.6;
 for(const x of[roomMin.x-wallThickness/2,roomMax.x+wallThickness/2]){
  const wall=block(castleGroup,roomStone,x,roomHeight/2,roomCenter.z,wallThickness,roomHeight,roomDepth+3.2,true);castleObstacles.push(wall);
  for(const y of[.5,4.9])block(castleGroup,roomTrim,x,y,roomCenter.z,wallThickness+.1,.22,roomDepth+3.2);
 }
 for(const z of[roomMin.z-wallThickness/2,roomMax.z+wallThickness/2]){
  const wall=block(castleGroup,roomStone,roomCenter.x,roomHeight/2,z,roomWidth,roomHeight,wallThickness,true);castleObstacles.push(wall);
  for(const y of[.5,4.9])block(castleGroup,roomTrim,roomCenter.x,y,z,roomWidth,.22,wallThickness+.1);
 }
 const exitPosition=position(CASTLE_ROOM.exit.x,CASTLE_ROOM.exit.y),treasurePosition=position(CASTLE_ROOM.treasure.x,CASTLE_ROOM.treasure.y),rugLength=Math.abs(exitPosition.z-treasurePosition.z)+2.6,rugCenter=(exitPosition.z+treasurePosition.z)/2;
 block(castleGroup,gold,treasurePosition.x,.024,rugCenter,4.5,.018,rugLength);block(castleGroup,carpet,treasurePosition.x,.039,rugCenter,4.05,.018,rugLength-.3);
 for(const pillar of CASTLE_ROOM.pillars){
  const p=position(pillar.x+pillar.w/2,pillar.y+pillar.h/2),w=pillar.w*scale,d=pillar.h*scale;
  block(castleGroup,roomTrim,p.x,.18,p.z,w,.36,d,true);const shaft=mesh(castleGroup,cylinder,roomStone,p.x,3.2,p.z,w*.36,5.9,d*.36,true);castleObstacles.push(shaft);block(castleGroup,roomTrim,p.x,6.20,p.z,w,.5,d,true);
  mesh(castleGroup,cylinder,gold,p.x,1.5,p.z,w*.38,.12,d*.38);mesh(castleGroup,cylinder,gold,p.x,5.3,p.z,w*.38,.12,d*.38);
 }
 function castleWindow(x,z,rotation){
  const frame=new THREE.Group();frame.position.set(x,3.35,z);frame.rotation.y=rotation;castleGroup.add(frame);
  block(frame,roomTrim,0,0,0,2.6,3.55,.18);block(frame,windowLight,0,0,.12,2.15,3.10,.05);block(frame,gold,0,0,.16,.10,3.1,.05);block(frame,gold,0,.25,.17,2.15,.10,.05);
 }
 for(const z of[-11,0,11]){castleWindow(roomMin.x+.05,z,Math.PI/2);castleWindow(roomMax.x-.05,z,-Math.PI/2);}
 for(const x of[-11,11])castleWindow(x,roomMin.z+.05,0);
 const exitGate=new THREE.Group();exitGate.name='arena-castle-exit';exitGate.position.set(exitPosition.x,0,roomMax.z-.13);castleGroup.add(exitGate);
 block(exitGate,colors.ink,0,2.10,0,3.7,4.2,.12);block(exitGate,colors.wood,0,2.05,-.1,3.25,4.1,.12);for(const x of[-1.48,0,1.48])block(exitGate,gold,x,2.0,-.18,.10,3.9,.06);for(const y of[.8,2.75])block(exitGate,gold,0,y,-.18,3.2,.13,.08);mesh(exitGate,sphere,gold,.38,1.9,-.27,.12,.12,.07);sign(exitGate,'USCITA · Torna all’isola',5.0,6.4);
 const treasureMarker=new THREE.Group();treasureMarker.name='arena-castle-treasure-place';treasureMarker.position.copy(treasurePosition);castleGroup.add(treasureMarker);
 const treasureRing=mesh(treasureMarker,ring,gold,0,.045,0,2,2,2);treasureRing.rotation.x=-Math.PI/2;sign(treasureMarker,'Il tesoro del castello',3.3,6.2);
 const warmLight=new THREE.PointLight(0xffc17b,65,48,2);warmLight.position.set(roomCenter.x,5.5,roomCenter.z);castleGroup.add(warmLight);
 for(const x of[roomMin.x+1.8,roomMax.x-1.8])for(const z of[-10,10]){mesh(castleGroup,cylinder,gold,x,1.8,z,.12,2.0,.12);const flame=mesh(castleGroup,sphere,colors.eye,x,2.95,z,.22,.40,.22);flame.name='arena-castle-torch';}
 const character=createArenaCharacter3D();character.group.name='arena-player-model';character.companion.name='arena-player-companion';scene.add(character.group,character.companion);for(const root of[character.group,character.companion])root.traverse(object=>{if(object.isMesh)object.castShadow=false;});const playerMuzzle=character.group.getObjectByName('arena-player-muzzle-flash');blob(character.companion,.26,.38);const playerShadow=new THREE.Group();blob(playerShadow,.48,.38);scene.add(playerShadow);
 const healthBackMat=new THREE.MeshBasicMaterial({color:0x173747,transparent:true,opacity:.85,depthWrite:false}),healthFillMat=new THREE.MeshBasicMaterial({color:0x9ee39a,depthWrite:false}),hitMaterial=new THREE.MeshBasicMaterial({color:0xffe6a3,transparent:true,opacity:.95,depthWrite:false});for(const m of[healthBackMat,healthFillMat,hitMaterial])materials.add(m);
 const healthPlane=geo(new THREE.PlaneGeometry(1,1)),hitGroup=new THREE.Group();hitGroup.name='arena-enemy-hit-flash';hitGroup.visible=false;scene.add(hitGroup);
 const hitParticles=new THREE.InstancedMesh(geo(new THREE.OctahedronGeometry(1,0)),hitMaterial,8);hitParticles.frustumCulled=false;hitGroup.add(hitParticles);const hitRing=mesh(hitGroup,ring,hitMaterial);hitRing.scale.setScalar(.3);
 function robotModel(enemy={}){
  const group=new THREE.Group(),paint=material(enemy.palette||0x777fc2,{roughness:.47,metalness:.25}),variant=Number.isInteger(enemy.variant)?enemy.variant%3:0,drone=enemy.kind==='drone';group.userData.rotors=[];group.userData.kind=drone?'drone':'robot';group.userData.paint=paint;
  if(drone){
   mesh(group,variant===1?geo(new THREE.OctahedronGeometry(1,0)):variant===2?box:sphere,paint,0,0,0,.40,.23,.34);
   block(group,colors.ink,0,0,-.33,.42,.13,.06);block(group,colors.eye,0,0,-.37,.30,.055,.025);
   for(const x of[-.52,.52])for(const z of[-.41,.41]){
    const arm=block(group,paint,x/2,.07,z/2,.55,.07,.08);arm.rotation.y=x*z>0?-.68:.68;
    const rotor=new THREE.Group();rotor.position.set(x,.14,z);group.add(rotor);block(rotor,colors.ink,0,0,0,.65,.035,.07);block(rotor,colors.ink,0,0,0,.07,.035,.65);group.userData.rotors.push(rotor);mesh(group,ring,colors.glass,x,.14,z,.29,.29,.29).rotation.x=Math.PI/2;
   }
   mesh(group,sphere,colors.eye,0,.25,0,.09,.05,.09);
   block(group,colors.metal,0,-.15,.02,.32,.08,.25);mesh(group,cylinder,colors.ink,0,-.25,0,.08,.18,.08);mesh(group,sphere,colors.glass,0,-.35,-.025,.12,.12,.12);
  }else{
   blob(group,.52,.4);mesh(group,sphere,paint,0,.80,0,.37,.44,.29);mesh(group,variant===1?sphere:variant===2?cylinder:box,paint,0,1.34,0,variant===1?.39:.65,variant===1?.28:.47,variant===1?.31:.51);
   block(group,colors.ink,0,1.35,-.27,.53,.18,.05);block(group,colors.eye,0,1.35,-.31,.39,.07,.025);mesh(group,cylinder,colors.metal,0,1.73,0,.025,.3,.025);mesh(group,sphere,colors.eye,0,1.90,0,.07,.07,.07);
   for(const s of[-1,1]){mesh(group,cylinder,colors.ink,s*.20,.29,0,.075,.55,.075);block(group,colors.metal,s*.2,.09,-.05,.22,.16,.33);mesh(group,cylinder,colors.metal,s*.46,.87,0,.065,.48,.065).rotation.z=s*.23;}
   block(group,colors.ink,0,.83,-.30,.25,.22,.045);block(group,colors.eye,0,.83,-.34,.13,.07,.025);for(const s of[-1,1])mesh(group,sphere,paint,s*.38,1.02,0,.15,.13,.17);
  }
  const health=new THREE.Group();health.name='arena-enemy-health';health.position.y=drone?.88:2.27;group.add(health);const back=mesh(health,healthPlane,healthBackMat,0,0,0,.90,.105,1),fill=mesh(health,healthPlane,healthFillMat,0,0,.006,.84,.055,1);back.name='arena-enemy-health-back';fill.name='arena-enemy-health-fill';group.userData.health=health;group.userData.healthFill=fill;
  const muzzle=mesh(group,sphere,enemyGlowMat,0,drone?0:1.2,-.40,.17,.12,.09);muzzle.visible=false;group.userData.muzzle=muzzle;islandGroup.add(group);return group;
 }
 function carModel(color){
  const group=new THREE.Group(),paint=material(color||0xe38743,{roughness:.45,metalness:.15});blob(group,1.15,1.9);
  block(group,colors.ink,0,.4,0,1.7,.3,3.3);block(group,paint,0,.72,0,1.85,.55,3.45);block(group,paint,0,.93,-1.12,1.75,.20,1.05);block(group,colors.glass,0,1.23,.17,1.48,.67,1.45);block(group,paint,0,1.59,.2,1.5,.12,1.5);block(group,paint,0,1.2,.84,1.52,.65,.09);
  block(group,colors.ink,0,.55,-1.77,1.70,.14,.10);block(group,colors.ink,0,.55,1.77,1.70,.14,.10);
  for(const x of[-.58,.58]){block(group,colors.white,x,.79,-1.75,.33,.18,.035);block(group,colors.clay,x,.79,1.75,.33,.14,.035);}
  const wheels=[];for(const x of[-.93,.93])for(const z of[-1.05,1.05]){const wheel=mesh(group,cylinder,colors.rubber,x,.43,z,.40,.25,.40);wheel.rotation.z=Math.PI/2;wheels.push(wheel);mesh(group,cylinder,colors.metal,x*1.11,.43,z,.20,.025,.20).rotation.z=Math.PI/2;}
  islandGroup.add(group);return{group,wheels,last:null};
 }
 function lootModel(r){const group=new THREE.Group(),color=material(rarity[r]||rarity.noncomune,{roughness:.45,metalness:.15});blob(group,.65,.55);block(group,color,0,.49,0,.94,.76,.82);block(group,colors.wood,0,.9,0,1.03,.13,.92);for(const x of[-.28,.28])block(group,colors.white,x,.55,0,.07,.9,.94);block(group,colors.eye,0,.60,-.44,.16,.22,.07);const halo=mesh(group,ring,color,0,.10,0,.8,.8,.8);halo.rotation.x=-Math.PI/2;const marker=mesh(group,geo(new THREE.OctahedronGeometry(.17,0)),color,0,1.65,0);lootGroup.add(group);return{group,marker};}
 function coverModel(area){
  const group=new THREE.Group(),woodFaces=new THREE.InstancedMesh(box,colors.woodLight,6);group.add(woodFaces);const body=block(group,colors.wood,0,.95,0,1,1.9,1,true);let plank=0;
  for(const x of[-.45,0,.45])for(const z of[-.51,.51])instance(woodFaces,plank++,x,1.00,z,.035,1.8,.03);woodFaces.instanceMatrix.needsUpdate=true;
  const bricks=new THREE.InstancedMesh(box,brickMaterial,22);let n=0;
  for(let row=0;row<5;row++){
   const columns=row%2?[[-.4375,.125],[-.25,.25],[0,.25],[.25,.25],[.4375,.125]]:[[-.375,.25],[-.125,.25],[.125,.25],[.375,.25]];
   for(const[x,w]of columns)instance(bricks,n++,x,.19+row*.38,0,w-.014,.35,1.025);
  }
  bricks.receiveShadow=true;bricks.visible=false;bricks.instanceMatrix.needsUpdate=true;group.add(bricks);(area==='castle'?castleGroup:area==='cave'?worldVisual.caveGroup:islandGroup).add(group);(area==='castle'?castleObstacles:area==='cave'?worldVisual.obstacles.cave:islandObstacles).push(body);return{group,body,woodFaces,bricks};
 }
 function beamModel(m=glowMat){const value=mesh(scene,cylinder,m,0,0,0,.045,1,.045);value.visible=false;return value;}
 function shotModel(){const group=new THREE.Group(),paint=new THREE.MeshBasicMaterial({color:0xffe66b,transparent:true,opacity:.9,depthWrite:false});materials.add(paint);group.name='arena-player-shot';scene.add(group);const lines=Array.from({length:4},()=>{const value=mesh(group,cylinder,paint);value.visible=false;return value;}),orb=mesh(group,sphere,paint),halo=mesh(group,ring,paint);orb.visible=false;halo.visible=false;return{group,paint,lines,orb,halo};}
 const ray=new THREE.Raycaster(),target=new THREE.Vector3(),desired=new THREE.Vector3(),candidate=new THREE.Vector3(),direction=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
 const shotFrom=new THREE.Vector3(),shotTo=new THREE.Vector3(),shotDelta=new THREE.Vector3(),shotSide=new THREE.Vector3(),segmentFrom=new THREE.Vector3(),segmentTo=new THREE.Vector3();
 function shotLine(value,a,b,radius){shotDelta.subVectors(b,a);const length=shotDelta.length();value.visible=length>.001;if(!value.visible)return;value.position.copy(a).add(b).multiplyScalar(.5);value.scale.set(radius,length,radius);value.quaternion.setFromUnitVectors(up,shotDelta.divideScalar(length));}
 function paintShot(value,shot,elapsed,until,jump){
  const starts=Number.isFinite(shot?.startsAt)?shot.startsAt:0,ends=Number.isFinite(shot?.expiresAt)?shot.expiresAt:until;value.group.visible=Boolean(shot&&elapsed>=starts&&elapsed<ends);for(const line of value.lines)line.visible=false;value.orb.visible=false;value.halo.visible=false;if(!value.group.visible)return false;
  const kind=shot.kind||'pulse',radius=Number.isFinite(shot.width)?shot.width*.01:.055;value.group.userData.kind=kind;value.paint.color.set(shot.color||'#ffe66b');shotFrom.copy(position(shot.from.x,shot.from.y));shotTo.copy(position(shot.to.x,shot.to.y));shotFrom.y=Number.isFinite(shot.fromHeight)?shot.fromHeight:groundAt(shot.from.x,shot.from.y,currentArea,currentCaveId)+1.2+jump;shotTo.y=Number.isFinite(shot.toHeight)?shot.toHeight:groundAt(shot.to.x,shot.to.y,currentArea,currentCaveId)+1.15;
  if(kind==='orb'){
   const progress=bounded((elapsed-starts)/Math.max(.001,ends-starts),0,1);value.orb.visible=true;value.orb.position.lerpVectors(shotFrom,shotTo,progress);value.orb.scale.setScalar(radius*1.8);value.halo.visible=true;value.halo.position.copy(value.orb.position);value.halo.scale.setScalar(radius*3);shotDelta.subVectors(shotTo,shotFrom).normalize();value.halo.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),shotDelta);segmentFrom.lerpVectors(shotFrom,shotTo,Math.max(0,progress-.15));shotLine(value.lines[0],segmentFrom,value.orb.position,radius*.28);
  }else if(kind==='arc'){
   shotSide.subVectors(shotTo,shotFrom).cross(up);if(shotSide.lengthSq()<.001)shotSide.set(1,0,0);shotSide.normalize();segmentFrom.copy(shotFrom);
   for(let i=0;i<4;i++){segmentTo.lerpVectors(shotFrom,shotTo,(i+1)/4);if(i<3)segmentTo.addScaledVector(shotSide,(i%2?-.28:.28));shotLine(value.lines[i],segmentFrom,segmentTo,radius*.7);segmentFrom.copy(segmentTo);}
  }else{shotLine(value.lines[0],shotFrom,shotTo,kind==='beam'?radius*1.2:radius);if(kind==='beam')shotLine(value.lines[1],shotFrom,shotTo,radius*.4);}
  return true;
 }
 function areaBounds(){return currentArea==='castle'?CASTLE_ROOM.bounds:currentArea==='cave'?CAVE_ROOMS.find(room=>room.id===currentCaveId)?.bounds:ARENA_WORLD_BOUNDS;}
 function clipCamera(from,to){
  direction.subVectors(to,from);const length=direction.length();if(length<.001)return to;direction.divideScalar(length);ray.set(from,direction);ray.far=length;
  const obstacles=currentArea==='castle'?castleObstacles:currentArea==='cave'?worldVisual.obstacles.cave:[...islandObstacles,...worldVisual.obstacles.island],hits=ray.intersectObjects(obstacles.filter(o=>o.visible&&o.parent.visible),false);if(hits.length)to.copy(from).addScaledVector(direction,Math.max(.65,hits[0].distance-.27));
  if(currentArea==='island')for(let step=1;step<=10;step++){const t=step/10,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t,y=from.y+(to.y-from.y)*t,surface=sampleArenaSurface(x/scale+500,z/scale+320);if(surface&&y<surface.height+.28){to.lerpVectors(from,to,Math.max(.1,(step-1)/10));break;}}
  const bounds=areaBounds();if(currentArea!=='island'&&bounds){const min=position(bounds.minX,bounds.minY),max=position(bounds.maxX,bounds.maxY);to.x=bounded(to.x,min.x+.25,max.x-.25);to.z=bounded(to.z,min.z+.25,max.z-.25);}
  const surface=sampleArenaSurface(to.x/scale+500,to.z/scale+320,{area:currentArea||'island',caveId:currentCaveId}),floor=surface?(surface.waterLevel??surface.height):0;to.y=Math.max(floor+.45,to.y);return to;
 }
 function resize(){if(disposed)return;const rect=host.getBoundingClientRect(),w=Math.round(host.clientWidth||rect.width||width||960),h=Math.round(host.clientHeight||rect.height||height||540);if(w===width&&h===height)return;width=Math.max(1,w);height=Math.max(1,h);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
 function contextLost(event){event.preventDefault();lost=true;onContextLost(event);}
 function contextRestored(){if(disposed)return;lost=false;renderer.shadowMap.needsUpdate=true;resize();}
 canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;if(observer)observer.observe(host);window.addEventListener('resize',resize);resize();renderer.shadowMap.needsUpdate=true;
 function update(world,profile,{dt=0,elapsed=0,shotUntil=0,paused=false}={}){
  if(disposed||lost||!world?.player)return;resize();const delta=paused?0:Number.isFinite(dt)?bounded(dt,0,.1):0;clock+=delta;
  const area=inArenaCastle(world)?'castle':world.area==='cave'?'cave':'island',inside=area!=='island',caveId=area==='cave'?world.caveId:null;
  if(area!==currentArea||caveId!==currentCaveId){
   currentArea=area;currentCaveId=caveId;islandGroup.visible=!inside;castleGroup.visible=area==='castle';firstCamera=true;previousPlayer=null;petInitialized=false;wallSignature='';shadowCell='';yaw=(world.player.angle||0)+Math.PI/2;yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
   sky.visible=!inside;scene.background.setHex(inside?0x44464c:0xe9c9ac);scene.fog.color.setHex(inside?0x625d56:0xe5c9ac);scene.fog.near=inside?34:85;scene.fog.far=inside?75:185;hemisphere.color.setHex(inside?0xffe3ba:0xbfdcf4);hemisphere.groundColor.setHex(inside?0x8e7963:0x6d7852);sun.color.setHex(inside?0xffd09c:0xffd39b);sun.intensity=inside?1.45:3.4;renderer.shadowMap.needsUpdate=true;
   canvas.setAttribute('aria-label',area==='cave'?'Grotta 3D. Cerca il reperto oppure il passaggio con il cartello Uscita.':area==='castle'?'Sala 3D del castello. Cerca il tesoro oppure il portone con il cartello Uscita.':'Isola 3D in terza persona. Muoviti con il joystick o la tastiera e trascina per guardarti intorno.');
  }
  host.dataset.sceneArea=area;
  worldVisual.update(world,{dt:delta,elapsed,paused});
  updateResources(world,elapsed,paused);
  const equipped=profile?.equipped||{},petId=equipped.pet||'pet-nessuno';host.dataset.scenePet=petId;host.dataset.sceneSkin=equipped.skin||'skin-esploratore';if(petId!==previousPetId){previousPetId=petId;petInitialized=false;}
  const visibleRobots=inside?[]:world.robots||[],visibleCars=inside?[]:world.cars||[],visibleLoot=area==='cave'?[]:visibleArenaLoot(world),enemyShots=inside||paused?[]:(world.enemyShots||[]).filter(shot=>shot?.from&&shot?.to&&Number.isFinite(shot.expiresAt)&&elapsed<shot.expiresAt),firingRobots=new Set(enemyShots.map(shot=>shot.robotId));
  const player=position(world.player.x,world.player.y),jump=Number.isFinite(world.jumpHeight)?Math.max(0,world.jumpHeight):0,surface=sampleArenaSurface(world.player.x,world.player.y,{area,caveId}),movementMode=world.movementMode||'walk',baseHeight=Number.isFinite(world.groundHeight)?world.groundHeight:movementMode==='swim'&&surface?.waterLevel!==null?(surface?.waterLevel??0)-.2:surface?.height||0;
  const aiming=Boolean(world.aiming)&&!world.driving,flash=!paused&&(world.shots||[]).some(shot=>Number.isFinite(shot.startsAt)&&elapsed>=shot.startsAt&&elapsed-shot.startsAt<.075),moved=previousPlayer?player.distanceTo(previousPlayer):0,moving=delta>0&&moved>.002;
  previousPlayer=player.clone();character.setAppearance(equipped);character.group.position.copy(player);character.group.position.y=baseHeight+jump;character.group.rotation.y=-(world.player.angle||0)-Math.PI/2;character.update({moving,dt:delta,driving:!inside&&Boolean(world.driving),aiming:aiming||elapsed<shotUntil,movementMode,weaponId:world.weaponId||'base',reloadRemaining:world.combat?.reloadRemaining||0,firing:flash,reducedMotion:reducedMotion()});
  playerShadow.position.copy(player);playerShadow.position.y=surface?.height||0;playerShadow.visible=movementMode!=='swim';playerShadow.children[0].material.opacity=.17;playerShadow.scale.setScalar(1+Math.min(jump,3)*.12);
  const heading=world.player.angle||0;petTarget.set(player.x-Math.cos(heading)*.9-Math.sin(heading)*.75,0,player.z-Math.sin(heading)*.9+Math.cos(heading)*.75);
  const bounds=areaBounds();if(inside&&bounds){const min=position(bounds.minX,bounds.minY),max=position(bounds.maxX,bounds.maxY);petTarget.x=bounded(petTarget.x,min.x+.25,max.x-.25);petTarget.z=bounded(petTarget.z,min.z+.25,max.z-.25);}
  if(!petInitialized||petPosition.distanceTo(petTarget)>4||world.driving){petPosition.copy(petTarget);petInitialized=true;}else if(delta)petPosition.lerp(petTarget,1-Math.exp(-delta*4.8));
  const petSurface=sampleArenaSurface(petPosition.x/scale+500,petPosition.z/scale+320,{area,caveId}),petFloor=petSurface?.waterLevel!==null&&petSurface?.waterLevel!==undefined?petSurface.waterLevel-.2:petSurface?.height||0;
  character.companion.position.copy(petPosition);character.companion.position.y=petFloor+(['pet-luma','pet-orbit'].includes(petId)?.10+Math.sin(clock*3)*.04:.02);
  const followDirection=petTarget.clone().sub(petPosition);character.companion.rotation.y=followDirection.lengthSq()>.04?Math.atan2(-followDirection.x,-followDirection.z):character.group.rotation.y;
  // Drone altitude is above its support surface, including the water surface.
  for(const item of visibleRobots){
   let group=robots.get(item.id);if(!group){group=robotModel(item);group.name='arena-enemy-'+item.id;robots.set(item.id,group);}
   const enemySurface=sampleArenaSurface(item.x,item.y),floor=enemySurface?.height||0,support=item.kind==='drone'?Math.max(floor,enemySurface?.waterLevel??-Infinity):floor,maxHp=Number.isFinite(item.maxHp)&&item.maxHp>0?item.maxHp:item.kind==='drone'?4:3,hp=Number.isFinite(item.hp)?bounded(item.hp,0,maxHp):maxHp,hit=!paused&&world.hitFlash?.enemyId===item.id&&world.hitFlash.expiresAt>elapsed,fade=hit?bounded((world.hitFlash.expiresAt-elapsed)/.22,0,1):0;
   group.visible=item.alive!==false;group.userData.muzzle.visible=hp>0&&firingRobots.has(item.id);group.position.copy(position(item.x,item.y));group.position.y=support+(item.kind==='drone'?(item.altitude||0):0);group.rotation.y=Math.atan2(group.position.x-player.x,group.position.z-player.z);group.rotation.z=reducedMotion()?0:fade*.10;group.userData.paint.emissive.setHex(hit?0xffd099:0x000000);group.userData.paint.emissiveIntensity=fade*.75;
   const fill=group.userData.healthFill;fill.scale.x=.84*hp/maxHp;fill.position.x=-.42*(1-hp/maxHp);group.userData.health.visible=true;group.userData.hp=hp;group.userData.maxHp=maxHp;
   if(delta){if(item.kind==='drone'){for(const rotor of group.userData.rotors)rotor.rotation.y+=delta*30;}else group.children[1].rotation.z=Math.sin(clock*4+group.position.x)*.035;}
  }
  for(const item of visibleCars){let car=cars.get(item.id);if(!car){car=carModel(item.color);cars.set(item.id,car);}const p=position(item.x,item.y),angle=item.angle||0,c=Math.cos(angle),s=Math.sin(angle);p.y=groundAt(item.x,item.y);if(car.last&&delta){const turn=p.distanceTo(car.last)/.4;for(const wheel of car.wheels)wheel.rotateY(turn);}car.last=p.clone();car.group.position.copy(p);car.group.rotation.set(Math.atan2(groundAt(item.x+c*20,item.y+s*20)-groundAt(item.x-c*20,item.y-s*20),3.2),-angle-Math.PI/2,Math.atan2(groundAt(item.x-s*10,item.y+c*10)-groundAt(item.x+s*10,item.y-c*10),1.6));}
  for(const item of visibleLoot){let value=loot.get(item.id);if(!value){value=lootModel(item.rarity);value.group.name='arena-loot-'+item.id;loot.set(item.id,value);}const at=arenaLootPosition(world,item);value.group.visible=!item.opened;value.group.position.copy(position(at.x,at.y));value.group.position.y=groundAt(at.x,at.y,area,caveId);value.group.scale.setScalar(inside?1.35:1);value.marker.position.y=1.65+Math.sin(clock*2.5+value.group.position.x)*.11;if(delta)value.marker.rotation.y+=delta*.8;}
  const activeRobots=new Set(visibleRobots.map(v=>v.id)),activeCars=new Set(visibleCars.map(v=>v.id)),activeLoot=new Set(visibleLoot.map(v=>v.id));for(const[id,value]of robots)if(!activeRobots.has(id))value.visible=false;for(const[id,value]of cars)if(!activeCars.has(id))value.group.visible=false;for(const[id,value]of loot)if(!activeLoot.has(id))value.group.visible=false;
  const walls=((area==='castle'?world.castleWalls:area==='cave'?world.caveWalls:world.walls)||[]).slice(0,48),covers=coversByArea[area];for(let i=0;i<Math.max(covers.length,walls.length);i++){if(!covers[i])covers[i]=coverModel(area);const value=covers[i],wall=walls[i];value.group.visible=Boolean(wall);if(wall){const x=wall.x+wall.w/2,y=wall.y+wall.h/2;value.group.position.copy(position(x,y));value.group.position.y=groundAt(x,y,area,caveId);value.group.rotation.y=wall.h>wall.w?Math.PI/2:0;value.group.scale.set(Math.max(wall.w,wall.h)*scale,1,Math.min(wall.w,wall.h)*scale);const brick=wall.material==='brick'||wall.kind?.startsWith('brick-');value.body.material=brick?mortarMaterial:colors.wood;value.woodFaces.visible=!brick;value.bricks.visible=Boolean(brick);}}
  const signature=JSON.stringify(walls);if(signature!==wallSignature){wallSignature=signature;renderer.shadowMap.needsUpdate=true;}
  const shots=!paused?(world.shots||[]):[],shotKinds=[];for(let i=0;i<Math.max(beams.length,shots.length);i++){if(!beams[i])beams[i]=shotModel();const shot=shots[i];if(paintShot(beams[i],shot,elapsed,shotUntil,jump))shotKinds.push(shot.kind||'pulse');}
  for(let i=0;i<Math.max(enemyBeams.length,enemyShots.length);i++){if(!enemyBeams[i]){enemyBeams[i]=beamModel(enemyGlowMat);enemyBeams[i].name='arena-enemy-beam';}const beam=enemyBeams[i],shot=enemyShots[i];beam.visible=Boolean(shot);if(shot){const from=position(shot.from.x,shot.from.y),to=position(shot.to.x,shot.to.y);from.y=Number.isFinite(shot.fromHeight)?shot.fromHeight:groundAt(shot.from.x,shot.from.y)+1.2;to.y=Number.isFinite(shot.toHeight)?shot.toHeight:baseHeight+jump+1.2;shotLine(beam,from,to,.075);}}
  host.dataset.sceneShotKinds=[...new Set(shotKinds)].join(',');host.dataset.scenePlayerShots=String(shotKinds.length);host.dataset.sceneMovementMode=movementMode;host.dataset.sceneWeapon=world.weaponId||'base';host.dataset.sceneGround=String(baseHeight);
  const hit=world.hitFlash,showHit=!inside&&!paused&&hit&&Number.isFinite(hit.x)&&Number.isFinite(hit.y)&&Number.isFinite(hit.expiresAt)&&elapsed<hit.expiresAt;hitGroup.visible=Boolean(showHit);
  if(showHit){
   hitGroup.position.copy(position(hit.x,hit.y));hitGroup.position.y=Number.isFinite(hit.groundHeight)?hit.groundHeight:groundAt(hit.x,hit.y)+1.2;const progress=bounded(1-(hit.expiresAt-elapsed)/.22,0,1),spread=reducedMotion()?.16:.2+progress*.65;hitMaterial.opacity=.95*(1-progress*.65);
   for(let i=0;i<8;i++){const angle=i/8*Math.PI*2;instance(hitParticles,i,Math.cos(angle)*spread,Math.sin(angle)*spread,(i%2?1:-1)*spread*.3,.035,.035,.065,angle);}hitParticles.instanceMatrix.needsUpdate=true;hitRing.scale.setScalar(.18+progress*(reducedMotion()?.12:.5));
  }
  host.dataset.sceneEnemyBeams=String(enemyShots.length);host.dataset.sceneAiming=String(aiming);host.dataset.sceneHitFlash=String(Boolean(showHit));host.dataset.sceneMuzzleFlash=String(Boolean(playerMuzzle?.visible));
  target.copy(player);target.y=baseHeight+(movementMode==='swim'?.5:1.42)+jump*.7;if(aiming){target.x+=Math.cos(yaw)*.38;target.z+=Math.sin(yaw)*.38;}
  const distance=!inside&&world.driving?8.4:aiming?4.7:6.1,horizontal=Math.cos(pitch)*distance;desired.set(target.x-Math.sin(yaw)*horizontal,target.y+Math.sin(pitch)*distance,target.z+Math.cos(yaw)*horizontal);
  const desiredFov=aiming?49:56,nextFov=firstCamera?desiredFov:camera.fov+(desiredFov-camera.fov)*(delta?1-Math.exp(-delta*10):0);if(Math.abs(nextFov-camera.fov)>.001){camera.fov=nextFov;camera.updateProjectionMatrix();}
  const cell=inside?area:Math.round(player.x/24)+':'+Math.round(player.z/24);if(cell!==shadowCell){shadowCell=cell;sun.target.position.set(player.x,baseHeight,player.z);sun.target.updateMatrixWorld();sun.position.set(player.x-32,baseHeight+30,player.z+24);renderer.shadowMap.needsUpdate=true;}
  scene.updateMatrixWorld(true);clipCamera(target,desired);const teleport=firstCamera||camera.position.distanceTo(desired)>18;
  candidate.copy(camera.position);if(teleport)candidate.copy(desired);else if(delta)candidate.lerp(desired,1-Math.exp(-delta*9));else if(paused===false)candidate.copy(desired);clipCamera(target,candidate);camera.position.copy(candidate);camera.lookAt(target);firstCamera=false;sky.position.copy(camera.position);if(!reducedMotion())clouds.position.x=Math.sin(clock*.015)*1.4;
  for(const item of visibleRobots){const group=robots.get(item.id);group.userData.health.quaternion.copy(group.quaternion).invert().multiply(camera.quaternion);}if(showHit)hitRing.quaternion.copy(camera.quaternion);
  renderer.render(scene,camera);host.dataset.sceneCalls=String(renderer.info.render.calls);host.dataset.sceneTriangles=String(renderer.info.render.triangles);
 }
 function look(dx,dy){if(disposed)return;if(Number.isFinite(dx))yaw=Math.atan2(Math.sin(yaw+bounded(dx,-350,350)*.004),Math.cos(yaw+bounded(dx,-350,350)*.004));if(Number.isFinite(dy))pitch=bounded(pitch+bounded(dy,-350,350)*.003,.06,.95);}
 function dispose(){if(disposed)return;disposed=true;observer?.disconnect();window.removeEventListener('resize',resize);canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);character.dispose();worldVisual.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();scene.clear();sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();delete host.dataset.sceneCalls;delete host.dataset.sceneTriangles;delete host.dataset.sceneArea;delete host.dataset.sceneEnemyBeams;delete host.dataset.scenePet;delete host.dataset.sceneSkin;delete host.dataset.sceneShotKinds;delete host.dataset.sceneMovementMode;delete host.dataset.sceneWeapon;delete host.dataset.scenePlayerShots;delete host.dataset.sceneGround;delete host.dataset.sceneAiming;delete host.dataset.sceneHitFlash;delete host.dataset.sceneMuzzleFlash;}
 return{update,look,getYaw:()=>yaw,resize,dispose};
}
