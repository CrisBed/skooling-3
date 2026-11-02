import {ARENA_WORLD_BOUNDS,ARENA_TERRAIN_GRID,ARENA_LANDMARKS,CAVE_ROOMS,terrainVertexHeight,sampleArenaSurface} from './arena-world-model.js';

const SCALE=.08,clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

// Owns geometry, materials and textures, never a renderer, input or clock.
// Add both groups to the existing scene. Camera obstacles are split by area.
export function createArenaWorldVisual(THREE){
 const islandGroup=new THREE.Group(),caveGroup=new THREE.Group();islandGroup.name='arena-world-island';caveGroup.name='arena-world-caves';caveGroup.visible=false;
 const obstacles={island:[],cave:[]},geometries=new Set(),materials=new Set(),textures=new Set(),rooms=new Map(),falls=[],sites=[];
 let disposed=false,clock=0;
 const geometry=g=>(geometries.add(g),g),material=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.9,metalness:0,...extra});materials.add(m);return m;};
 const box=geometry(new THREE.BoxGeometry(1,1,1)),rock=geometry(new THREE.DodecahedronGeometry(1,0)),ball=geometry(new THREE.SphereGeometry(1,10,6)),cone=geometry(new THREE.ConeGeometry(1,1,8)),circle=geometry(new THREE.CircleGeometry(1,40)),cylinder=geometry(new THREE.CylinderGeometry(1,1,1,10));
 const palette={stone:material(0x89908e,{flatShading:true}),stoneLight:material(0xb1b6aa,{flatShading:true}),earth:material(0xb39366),sand:material(0xe4cd95),wood:material(0x9c724a),cream:material(0xffe3ad),roof:material(0x568795),ink:material(0x203d50),glass:material(0x99d9e8,{emissive:0x438795,emissiveIntensity:.16}),gold:material(0xf0c56c,{metalness:.25,roughness:.5}),crystal:material(0x8dded7,{emissive:0x42a69e,emissiveIntensity:.28})};
 function point(x,y,h=0){return new THREE.Vector3((x-500)*SCALE,h,(y-320)*SCALE);}
 function height(x,y,area='island',caveId=null){return sampleArenaSurface(x,y,{area,caveId})?.height??0;}
 function mesh(parent,g,m,x=0,y=0,z=0,sx=1,sy=1,sz=1,shadow=false){const value=new THREE.Mesh(g,m);value.position.set(x,y,z);value.scale.set(sx,sy,sz);value.receiveShadow=true;value.castShadow=shadow;parent.add(value);return value;}
 const block=(parent,m,x,y,z,w,h,d,shadow=false)=>mesh(parent,box,m,x,y,z,w,h,d,shadow);
 const pose=new THREE.Object3D(),dropPoint=new THREE.Vector3();
 function matrix(instances,index,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){pose.position.set(x,y,z);pose.rotation.set(rx,ry,rz);pose.scale.set(sx,sy,sz);pose.updateMatrix();instances.setMatrixAt(index,pose.matrix);}
 function sign(parent,text,x,y,z,width=5){
  const group=new THREE.Group();group.name='arena-world-sign';group.position.set(x,y,z);group.userData.text=text;parent.add(group);
  if(typeof document==='undefined')return group;
  const image=document.createElement('canvas');image.width=512;image.height=100;const ctx=image.getContext('2d');if(!ctx)return group;
  ctx.fillStyle='#fff1cf';ctx.beginPath();ctx.roundRect(5,5,502,90,20);ctx.fill();ctx.strokeStyle='#375968';ctx.lineWidth=6;ctx.stroke();ctx.font='700 34px system-ui,sans-serif';ctx.fillStyle='#244351';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,52,470);
  const texture=new THREE.CanvasTexture(image);texture.colorSpace=THREE.SRGBColorSpace;textures.add(texture);const m=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});materials.add(m);const sprite=new THREE.Sprite(m);sprite.scale.set(width,width*100/512,1);group.add(sprite);return group;
 }

 const {cols,rows,bounds}=ARENA_TERRAIN_GRID,positions=new Float32Array((cols+1)*(rows+1)*3),colors=new Float32Array(positions.length),indices=[];
 const grass=new THREE.Color(0x80be72),meadow=new THREE.Color(0xa6c879),sand=new THREE.Color(0xdec893),stone=new THREE.Color(0xa6aba2),snow=new THREE.Color(0xe5e9db),tint=new THREE.Color();
 for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){
  const x=bounds.minX+(bounds.maxX-bounds.minX)*col/cols,y=bounds.minY+(bounds.maxY-bounds.minY)*row/rows,h=terrainVertexHeight(col,row),i=(row*(cols+1)+col)*3,p=point(x,y,h);
  positions.set([p.x,p.y,p.z],i);
  if(h<.25)tint.copy(sand).lerp(grass,clamp((h+1.1)/1.35,0,1));else if(h<7)tint.copy(grass).lerp(meadow,.18+.12*Math.sin(x/120)*Math.cos(y/140));else tint.copy(stone).lerp(snow,clamp((h-11)/6,0,1));
  colors.set([tint.r,tint.g,tint.b],i);
  if(col<cols&&row<rows){const a=row*(cols+1)+col,b=a+1,c=a+cols+1,d=c+1;indices.push(a,c,b,b,c,d);}
 }
 const terrainGeometry=geometry(new THREE.BufferGeometry());terrainGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));terrainGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));terrainGeometry.setIndex(indices);terrainGeometry.computeVertexNormals();
 const terrain=mesh(islandGroup,terrainGeometry,material(0xffffff,{vertexColors:true,flatShading:true}));terrain.name='arena-world-terrain';terrain.userData.grid=ARENA_TERRAIN_GRID;
 const waterMaterial=new THREE.MeshPhongMaterial({color:0x40afc8,specular:0xb5eee9,shininess:65,transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide});materials.add(waterMaterial);
 const waterWidth=(ARENA_WORLD_BOUNDS.maxX-ARENA_WORLD_BOUNDS.minX)*SCALE+240,waterDepth=(ARENA_WORLD_BOUNDS.maxY-ARENA_WORLD_BOUNDS.minY)*SCALE+240;
 const sea=mesh(islandGroup,geometry(new THREE.PlaneGeometry(waterWidth,waterDepth)),waterMaterial,0,-1.15,0);sea.rotation.x=-Math.PI/2;sea.name='arena-world-sea';
 function pool(descriptor,parent=islandGroup){const p=point(descriptor.x,descriptor.y,descriptor.waterLevel+.012),value=mesh(parent,circle,waterMaterial,p.x,p.y,p.z,descriptor.rx*SCALE,descriptor.ry*SCALE,1);value.rotation.x=-Math.PI/2;return value;}
 for(const lake of ARENA_LANDMARKS.filter(p=>p.kind==='lake'))pool(lake);

 function ribbon(points,width,parent=islandGroup){
  // Paint the existing heightmap vertices. A second strip would interpolate
  // across different terrain triangles and could float or disappear uphill.
  const value=new THREE.Group(),earth=new THREE.Color(0xc7aa7c),padding=(bounds.maxX-bounds.minX)/cols*.28;value.userData.path={points,width};parent.add(value);
  for(let i=0;i<positions.length;i+=3){
   const x=positions[i]/SCALE+500,y=positions[i+2]/SCALE+320;let distance=Infinity;
   for(let n=1;n<points.length;n++){const a=points[n-1],b=points[n],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?clamp(((x-a.x)*dx+(y-a.y)*dy)/length,0,1):0;distance=Math.min(distance,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));}
   if(distance<=width/2+padding)colors.set([earth.r,earth.g,earth.b],i);
  }
  terrainGeometry.attributes.color.needsUpdate=true;return value;
 }
 for(const path of ARENA_LANDMARKS.filter(p=>p.kind==='path')){const value=ribbon(path.points,Math.min(path.width,38));value.name='arena-world-path-'+path.id;}

 const roofShape=new THREE.Shape();roofShape.moveTo(-.5,0);roofShape.lineTo(.5,0);roofShape.lineTo(0,1);roofShape.closePath();const roofGeometry=geometry(new THREE.ExtrudeGeometry(roofShape,{depth:1,bevelEnabled:false}));roofGeometry.translate(0,0,-.5);
 for(const house of ARENA_LANDMARKS.filter(p=>p.kind==='house')){
  const p=point(house.x+house.w/2,house.y+house.h/2),w=house.w*SCALE,d=house.h*SCALE,ground=[height(house.x,house.y),height(house.x+house.w,house.y),height(house.x,house.y+house.h),height(house.x+house.w,house.y+house.h),height(house.x+house.w/2,house.y+house.h/2)],base=Math.max(...ground),h=3.6,group=new THREE.Group();group.position.set(p.x,base,p.z);group.name='arena-world-'+house.id;group.userData.footprint={x:house.x,y:house.y,w:house.w,h:house.h};islandGroup.add(group);
  const foundation=block(group,palette.stone,0,-(base-Math.min(...ground))/2-.08,0,w+.5,base-Math.min(...ground)+.16,d+.5,true);obstacles.island.push(foundation);
  const body=block(group,palette.cream,0,h/2,0,w,h,d,true),roof=mesh(group,roofGeometry,palette.roof,0,h,0,w+.7,1.7,d+.7,true);obstacles.island.push(body,roof);
  const door=new THREE.Group();door.position.set(-w/2-.04,0,(house.door.y-house.y-house.h/2)*SCALE);door.rotation.y=-Math.PI/2;group.add(door);block(door,palette.wood,0,1.15,0,1.2,2.3,.12);block(door,palette.gold,.35,1.1,.08,.07,.07,.07);
  for(const x of[-w*.29,w*.29]){block(group,palette.ink,x,2,d/2+.06,1.35,1.35,.10);block(group,palette.glass,x,2,d/2+.13,1.15,1.15,.05);block(group,palette.cream,x,2,d/2+.17,.06,1.2,.04);}
  block(group,palette.stone,w*.25,h+.8,-d*.2,.65,1.8,.65,true);sign(group,house.id==='house-west'?'Rifugio della costa':'Rifugio della montagna',0,h+2.5,0,6.0);
  const approach={x:house.x-50,y:house.door.y},turn={x:approach.x,y:house.y+house.h+50};ribbon([{x:clamp(turn.x,0,1000),y:clamp(turn.y,0,640)},turn,approach,house.door],34);
 }

 const foamMaterial=new THREE.MeshBasicMaterial({color:0xe5faf2,transparent:true,opacity:.68,depthWrite:false});materials.add(foamMaterial);
 const flowMaterial=new THREE.MeshBasicMaterial({color:0x82dce5,transparent:true,opacity:.72,depthWrite:false,side:THREE.DoubleSide});materials.add(flowMaterial);
 for(const descriptor of ARENA_LANDMARKS.filter(p=>p.kind==='waterfall')){
  pool(descriptor.upperPool);pool(descriptor.lowerPool);
  const top=point(descriptor.top.x,descriptor.top.y,descriptor.top.height),bottom=point(descriptor.bottom.x,descriptor.bottom.y,descriptor.bottom.height),direction=top.clone().sub(bottom),length=direction.length(),center=top.clone().add(bottom).multiplyScalar(.5),width=Math.max(.7,descriptor.width*SCALE),group=new THREE.Group();group.name='arena-world-'+descriptor.id;islandGroup.add(group);
  const curtain=mesh(group,geometry(new THREE.PlaneGeometry(width,length)),flowMaterial,center.x,center.y,center.z);curtain.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
  const drops=new THREE.InstancedMesh(cylinder,foamMaterial,18),foam=new THREE.InstancedMesh(ball,foamMaterial,16);drops.frustumCulled=false;foam.frustumCulled=false;group.add(drops,foam);falls.push({top,bottom,width,drops,foam});
  sign(group,'La cascata',bottom.x,bottom.y+1.8,bottom.z+1.4,4.4);
 }

 function caveArch(parent,x,y,z,width=3.2){
  const value=new THREE.Group();value.position.set(x,y,z);parent.add(value);const arch=mesh(value,geometry(new THREE.TorusGeometry(width/2,.42,6,18,Math.PI)),palette.stone,0,2.1,0);for(const sign of[-1,1])block(value,palette.stone,sign*width/2,1.05,0,.8,2.1,.9,true);return{value,arch};
 }
 for(const room of CAVE_ROOMS){
  const entry=point(room.portal.x,room.portal.y,height(room.portal.x,room.portal.y)),portal=caveArch(islandGroup,entry.x,entry.y,entry.z,3.2);portal.value.name='arena-world-portal-'+room.id;mesh(portal.value,geometry(new THREE.PlaneGeometry(2.5,3.3)),palette.ink,0,1.55,-.1);sign(portal.value,'Entra nella grotta',0,4.0,0,5.4);
  const group=new THREE.Group();group.name='arena-world-room-'+room.id;group.visible=false;caveGroup.add(group);rooms.set(room.id,group);
  const min=point(room.bounds.minX,room.bounds.minY),max=point(room.bounds.maxX,room.bounds.maxY),cx=(min.x+max.x)/2,cz=(min.z+max.z)/2,w=max.x-min.x,d=max.z-min.z,wallHeight=7.4;
  block(group,palette.stone,cx,-.12,cz,w+3.2,.24,d+3.2);
  for(const x of[min.x-.8,max.x+.8]){const wall=block(group,palette.stone,x,wallHeight/2,cz,1.6,wallHeight,d+3.2);obstacles.cave.push(wall);}
  for(const z of[min.z-.8,max.z+.8]){const wall=block(group,palette.stone,cx,wallHeight/2,z,w,wallHeight,1.6);obstacles.cave.push(wall);}
  const roughness=new THREE.InstancedMesh(rock,palette.stoneLight,20);let n=0;
  for(let i=0;i<10;i++){const z=min.z+(i+.5)*d/10;for(const x of[min.x,max.x])matrix(roughness,n++,x,3.7+(i%3)*.3,z,.7,3.8,1.8,0,i*.37,.04*(i%2));}roughness.receiveShadow=true;group.add(roughness);
  const exit=point(room.exit.x,room.exit.y),exitArch=caveArch(group,exit.x,0,max.z-.15,3.6);mesh(exitArch.value,geometry(new THREE.PlaneGeometry(2.8,3.1)),palette.glass,0,1.55,-.12);sign(group,'USCITA · Torna all’isola',exit.x,4.65,max.z-.2,7);
  for(const sign of[-1,1])for(let k=0;k<3;k++){const crystal=mesh(group,cone,palette.crystal,cx+sign*(w/2-.7),.8,cz+(k-1)*d*.26,.36,1.6,.36);crystal.rotation.z=-sign*.24;}
  const light=new THREE.PointLight(0xa4d6ec,95,48,2);light.position.set(cx,5.8,cz);group.add(light);group.userData.bounds=room.bounds;group.userData.exit=room.exit;
 }

 for(const site of ARENA_LANDMARKS.filter(p=>p.kind==='dig'||p.kind==='find')){
  const parent=site.area==='cave'?rooms.get(site.caveId):islandGroup;if(!parent)continue;
  const p=point(site.x,site.y,height(site.x,site.y,site.area||'island',site.caveId)),group=new THREE.Group();group.position.copy(p);group.name='arena-world-site-'+site.id;parent.add(group);
  const mound=mesh(group,ball,palette.earth,0,.08,0,1.3,.38,1.0),hole=mesh(group,circle,palette.ink,0,.025,0,1.1,.8,1);hole.rotation.x=-Math.PI/2;hole.visible=false;
  const artifact=mesh(group,geometry(new THREE.OctahedronGeometry(.28,0)),palette.gold,0,.52,0);artifact.visible=site.kind==='find';const label=sign(group,site.kind==='dig'?'Scava qui':'Un oggetto da scoprire',0,1.8,0,5.3);sites.push({site,group,mound,hole,artifact,label});
 }
 function update(world={}, {dt=0,paused=false}={}){
  if(disposed)return;const delta=paused?0:Number.isFinite(dt)?clamp(dt,0,.1):0;clock+=delta;const area=world.area||'island';islandGroup.visible=area==='island';caveGroup.visible=area==='cave';for(const[id,room]of rooms)room.visible=area==='cave'&&id===world.caveId;
  for(const fall of falls){
   for(let i=0;i<18;i++){const t=(clock*.70+i/18)%1,p=dropPoint.copy(fall.top).lerp(fall.bottom,t),column=(i%3-1)*fall.width*.24;matrix(fall.drops,i,p.x+column,p.y,p.z+.035,.035,.30+(i%4)*.08,.035);}
   for(let i=0;i<16;i++){const a=i/16*Math.PI*2,r=.3+(i%4)*.17,bob=Math.sin(clock*3+i)*.025;matrix(fall.foam,i,fall.bottom.x+Math.cos(a)*r,fall.bottom.y+.07+bob,fall.bottom.z+Math.sin(a)*r,.25+(i%3)*.04,.065,.19);}
   fall.drops.instanceMatrix.needsUpdate=true;fall.foam.instanceMatrix.needsUpdate=true;
  }
  const found=new Set(world.exploration?.finds||[]);
  for(const value of sites){
   const progress=clamp(world.exploration?.dig?.[value.site.id]||0,0,3),done=found.has(value.site.id),dig=value.site.kind==='dig',sameArea=area===(value.site.area||'island')&&(area!=='cave'||world.caveId===value.site.caveId),near=sameArea&&Number.isFinite(world.player?.x)&&Number.isFinite(world.player?.y)&&Math.hypot(world.player.x-value.site.x,world.player.y-value.site.y)<=70;
   value.mound.visible=dig&&progress<3;value.mound.scale.y=.38*(1-progress*.22);value.hole.visible=dig&&progress===3;value.artifact.visible=!done&&(!dig||progress===3);value.label.visible=!done&&!near;value.artifact.rotation.y=clock*.55;
  }
 }
 function dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();islandGroup.removeFromParent();caveGroup.removeFromParent();islandGroup.clear();caveGroup.clear();obstacles.island.length=0;obstacles.cave.length=0;falls.length=0;sites.length=0;rooms.clear();geometries.clear();materials.clear();textures.clear();}
 return{islandGroup,caveGroup,obstacles,update,dispose};
}
