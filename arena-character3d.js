import * as THREE from './vendor/three-r187.module.min.js';
import {arenaWeapon} from './arena-weapons.js';

const outfits={
 'skin-esploratore':{coat:0xe97a35,trim:0xffdea0,pack:0x287d91},
 'skin-pilota':{coat:0x7562c4,trim:0xe0d0ff,pack:0xdc9954},
 'skin-cartografo':{coat:0x258c81,trim:0xbcebd5,pack:0x93664b},
 'skin-clown':{coat:0x6257b7,trim:0xffe6a0,pack:0x32a7b3},
 'skin-banana':{coat:0xe8b931,trim:0xffe68b,pack:0x427e67,pants:0x6c6d3d},
 'skin-cane':{coat:0xad754b,trim:0xffe0ae,pack:0x467e9f,pants:0x73523b},
 'skin-drago':{coat:0x4c9d85,trim:0xc1ecc4,pack:0xbf8955},
};
const wraps={'wrap-azzurro':0x3bbfe0,'wrap-aurora':0xb480e2,'wrap-solare':0xffcb50};

// The explorer is an original articulated model built from local geometry.
// Its origin is at the feet, and its forward direction is negative Z.
export function createArenaCharacter3D(){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let disposed=false,appearance='',phase=0,stride=0,aimWeight=0,petEnabled=false,selectedSkin='skin-esploratore',selectedPet='pet-nessuno',selectedWeapon='';
 const costumes=new Map(),petModels=new Map(),petLegs=new Map(),petWings=new Map(),skinTails=new Map();
 const geometry=value=>(geometries.add(value),value);
 const mat=(color,extra={})=>{const value=new THREE.MeshStandardMaterial({color,roughness:.68,metalness:0,...extra});materials.add(value);return value;};
 const box=geometry(new THREE.BoxGeometry(1,1,1)),ball=geometry(new THREE.SphereGeometry(1,12,10)),cylinder=geometry(new THREE.CylinderGeometry(1,1,1,10)),bootGeo=geometry(new THREE.BoxGeometry(1,1,1));
 const coat=mat(0xe97a35),trim=mat(0xffdea0),pack=mat(0x287d91),pants=mat(0x25465c),dark=mat(0x18364b),skin=mat(0xeac19c),glove=mat(0xf8dfb1),white=mat(0xf5f5e7);
 const glass=mat(0x63e2ee,{roughness:.2,metalness:.42,emissive:0x126c80,emissiveIntensity:.22}),weaponColor=mat(0x3bbfe0,{metalness:.2,roughness:.45}),axeMetal=mat(0xc2e0e8,{metalness:.38,roughness:.4}),wood=mat(0x8b6549);
 function mesh(parent,shape,material,x,y,z,sx=1,sy=1,sz=1){const m=new THREE.Mesh(shape,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m;}
 const cone=geometry(new THREE.ConeGeometry(1,1,8));
 function curve(points,radius=.05){return geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),18,radius,7,false));}
 const body=new THREE.Group();body.name='arena-character-body';group.add(body);
 const jacket=geometry(new THREE.CylinderGeometry(.29,.235,.65,10));
 mesh(body,jacket,coat,0,1.16,0);mesh(body,ball,coat,0,1.43,0,.29,.15,.24);
 mesh(body,cylinder,dark,0,.855,0,.245,.095,.22);
 mesh(body,box,trim,0,1.17,-.247,.035,.55,.025);
 mesh(body,box,trim,-.14,1.30,-.245,.12,.09,.025);
 mesh(body,box,dark,.15,1.11,-.242,.105,.16,.035);
 mesh(body,box,white,.15,1.14,-.265,.06,.018,.012);
 const collar=geometry(new THREE.TorusGeometry(.15,.055,6,16));
 mesh(body,collar,trim,0,1.495,0).rotation.x=Math.PI/2;
 mesh(body,cylinder,skin,0,1.55,0,.11,.17,.11);
 const head=new THREE.Group();head.position.y=1.79;body.add(head);
 mesh(head,ball,skin,0,0,0,.265,.29,.25);
 mesh(head,ball,skin,-.262,-.015,.008,.055,.085,.045);mesh(head,ball,skin,.262,-.015,.008,.055,.085,.045);
 const hairGeo=geometry(new THREE.SphereGeometry(1,14,10,0,Math.PI*2,0,Math.PI*.58));
 mesh(head,hairGeo,dark,0,.025,.025,.285,.30,.275);
 mesh(head,box,dark,0,.075,-.22,.49,.07,.09);
 mesh(head,ball,dark,0,.02,-.245,.255,.105,.065);
 mesh(head,ball,glass,0,.025,-.277,.237,.074,.04);
 mesh(head,box,white,-.09,.044,-.314,.095,.012,.009);
 mesh(head,ball,skin,0,-.07,-.248,.045,.045,.052);
 const smileGeo=geometry(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.06,-.14,-.219),new THREE.Vector3(0,-.17,-.239),new THREE.Vector3(.06,-.14,-.219)),8,.009,4,false));
 mesh(head,smileGeo,dark,0,0,0);
 mesh(body,ball,pack,0,1.17,.277,.275,.365,.155);
 mesh(body,box,trim,0,1.10,.409,.34,.19,.025);
 mesh(body,ball,dark,0,1.29,.405,.19,.12,.045);mesh(body,box,trim,0,1.30,.448,.11,.035,.015);
 for(const sign of[-1,1]){mesh(body,ball,dark,sign*.245,1.13,.29,.075,.16,.085);mesh(body,box,trim,sign*.245,1.15,.36,.085,.055,.025);mesh(body,box,pack,sign*.22,.87,.06,.14,.13,.12);}
 mesh(body,cylinder,trim,.18,1.47,.32,.065,.35,.065).rotation.z=Math.PI/2;
 mesh(body,box,dark,-.20,1.23,-.175,.055,.49,.05);mesh(body,box,dark,.20,1.23,-.175,.055,.49,.05);
 const pickaxe=new THREE.Group();pickaxe.position.set(-.26,1.22,.38);pickaxe.rotation.z=-.45;body.add(pickaxe);
 mesh(pickaxe,cylinder,wood,0,0,0,.025,.8,.025);
 const axeHead=mesh(pickaxe,box,axeMetal,0,.37,0,.43,.09,.1);axeHead.rotation.z=.18;
 const axeTip=mesh(pickaxe,geometry(new THREE.ConeGeometry(.085,.22,4)),axeMetal,-.25,.36,0);axeTip.rotation.z=Math.PI/2;
 const leftArm=new THREE.Group(),rightArm=new THREE.Group(),forearms=[];leftArm.name='arena-character-left-arm';rightArm.name='arena-character-right-arm';
 for(const [arm,sign]of[[leftArm,-1],[rightArm,1]]){
  arm.position.set(sign*.34,1.43,0);body.add(arm);
  mesh(arm,ball,coat,0,-.035,0,.145,.15,.145);
  mesh(arm,cylinder,coat,0,-.20,0,.10,.32,.10);
  mesh(arm,ball,dark,0,-.36,0,.10,.105,.10);
  const forearm=new THREE.Group();forearm.position.y=-.36;arm.add(forearm);forearms.push(forearm);
  mesh(forearm,cylinder,coat,0,-.10,-.015,.09,.21,.09);
  mesh(forearm,cylinder,trim,0,-.21,-.015,.095,.055,.095);
  mesh(forearm,ball,glove,0,-.27,-.02,.095,.11,.095);
  mesh(arm,ball,trim,sign*.035,-.01,-.025,.12,.055,.13);
 }
 const leftLeg=new THREE.Group(),rightLeg=new THREE.Group();
 for(const [leg,sign]of[[leftLeg,-1],[rightLeg,1]]){
  leg.position.set(sign*.145,.83,0);body.add(leg);
  mesh(leg,cylinder,pants,0,-.19,0,.115,.38,.115);
  mesh(leg,ball,dark,0,-.39,-.01,.115,.115,.115);
  mesh(leg,cylinder,pants,0,-.56,0,.10,.30,.105);
  mesh(leg,ball,dark,0,-.73,-.075,.135,.105,.205);mesh(leg,bootGeo,dark,0,-.80,-.07,.24,.045,.33);
  mesh(leg,box,trim,0,-.66,-.14,.17,.035,.07);
 }
 const weapon=new THREE.Group();weapon.name='arena-character-weapon';weapon.position.set(.23,1.09,-.43);body.add(weapon);
 mesh(weapon,box,weaponColor,0,0,0,.16,.16,.43);mesh(weapon,box,dark,0,-.13,.075,.10,.22,.11);
 mesh(weapon,cylinder,dark,0,0,-.25,.062,.16,.062).rotation.x=Math.PI/2;
 mesh(weapon,cylinder,glass,0,0,-.337,.045,.022,.045).rotation.x=Math.PI/2;
 mesh(weapon,box,white,0,.09,-.035,.06,.025,.23);
 mesh(weapon,box,dark,0,.015,.23,.13,.11,.18);mesh(weapon,box,weaponColor,0,-.11,-.04,.11,.18,.13).rotation.x=-.22;
 const muzzleMaterial=new THREE.MeshBasicMaterial({color:0xffdfa0,transparent:true,opacity:.95,depthWrite:false});materials.add(muzzleMaterial);
 const muzzleFlash=mesh(weapon,geometry(new THREE.OctahedronGeometry(1,0)),muzzleMaterial,0,0,-.66,.14,.11,.25);muzzleFlash.name='arena-player-muzzle-flash';muzzleFlash.visible=false;muzzleFlash.castShadow=false;
 const weaponAccent=mat(0x65dce8,{emissive:0x65dce8,emissiveIntensity:.35,roughness:.25}),weaponForms=new Map();
 for(const kind of['burst','orb','arc','beam']){const value=new THREE.Group();value.name='weapon-form-'+kind;value.visible=false;weapon.add(value);weaponForms.set(kind,value);}
 for(const x of[-.11,0,.11]){const barrel=mesh(weaponForms.get('burst'),cylinder,dark,x,-.01,-.36,.042,.27,.042);barrel.rotation.x=Math.PI/2;mesh(weaponForms.get('burst'),ball,weaponAccent,x,-.01,-.50,.034,.034,.025);}
 mesh(weaponForms.get('orb'),ball,weaponAccent,0,.04,-.18,.18,.18,.21);mesh(weaponForms.get('orb'),geometry(new THREE.TorusGeometry(.19,.025,5,16)),dark,0,.04,-.18).rotation.x=Math.PI/2;
 for(const x of[-.14,.14]){mesh(weaponForms.get('arc'),box,weaponAccent,x,.01,-.32,.045,.10,.38);mesh(weaponForms.get('arc'),ball,glass,x,.01,-.52,.07,.07,.055);}
 mesh(weaponForms.get('beam'),cylinder,weaponAccent,0,0,-.50,.07,.57,.07).rotation.x=Math.PI/2;mesh(weaponForms.get('beam'),box,dark,0,.15,-.10,.08,.12,.33);
 function costume(id){const value=new THREE.Group();value.name='costume-'+id;value.visible=false;body.add(value);costumes.set(id,value);return value;}
 const red=mat(0xe84d55),blue=mat(0x4095d4),yellow=mat(0xffd541),bananaShade=mat(0xe7ab32),brown=mat(0x79553b),dogBrown=mat(0xa9744c),cream=mat(0xffe0ae),dragonGreen=mat(0x4f9e83),dragonMembrane=mat(0x9ed5ac,{side:THREE.DoubleSide});
 const clown=costume('skin-clown');
 for(const sign of[-1,1]){mesh(clown,ball,sign<0?red:blue,sign*.30,1.90,.025,.17,.22,.18);mesh(clown,ball,sign<0?blue:red,sign*.33,2.06,.07,.13,.14,.13);}
 mesh(clown,ball,red,0,1.715,-.34,.095,.085,.08);
 for(let i=0;i<10;i++){const a=i/10*Math.PI*2;mesh(clown,ball,i%2?white:cream,Math.cos(a)*.25,1.49,Math.sin(a)*.25,.105,.065,.10);}
 for(const y of[1.23,1.02])mesh(clown,ball,red,0,y,-.28,.065,.065,.035);
 mesh(clown,cone,blue,-.09,1.49,-.25,.09,.15,.08).rotation.z=-Math.PI/2;mesh(clown,cone,blue,.09,1.49,-.25,.09,.15,.08).rotation.z=Math.PI/2;
 const banana=costume('skin-banana'),bananaPath=new THREE.CatmullRomCurve3([new THREE.Vector3(-.19,.71,.04),new THREE.Vector3(-.30,1.15,0),new THREE.Vector3(-.17,1.72,0),new THREE.Vector3(.15,2.14,.03),new THREE.Vector3(.34,2.23,.04)]);
 const bananaPositions=[],bananaIndices=[],bananaSegments=22,bananaSides=12;
 for(let i=0;i<=bananaSegments;i++){const t=i/bananaSegments,p=bananaPath.getPoint(t),tangent=bananaPath.getTangent(t),normal=new THREE.Vector3(-tangent.y,tangent.x,0).normalize(),radius=.04+.245*Math.pow(Math.sin(Math.PI*t),.6);for(let j=0;j<=bananaSides;j++){const a=j/bananaSides*Math.PI*2;bananaPositions.push(p.x+normal.x*Math.cos(a)*radius,p.y+normal.y*Math.cos(a)*radius,p.z+Math.sin(a)*radius*.85);if(i<bananaSegments&&j<bananaSides){const n=i*(bananaSides+1)+j;bananaIndices.push(n,n+1,n+bananaSides+1,n+1,n+bananaSides+2,n+bananaSides+1);}}}
 const bananaGeometry=geometry(new THREE.BufferGeometry());bananaGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bananaPositions,3));bananaGeometry.setIndex(bananaIndices);bananaGeometry.computeVertexNormals();mesh(banana,bananaGeometry,yellow,0,0,0);
 mesh(banana,cylinder,brown,.35,2.26,.04,.055,.15,.055).rotation.z=-.65;mesh(banana,ball,brown,-.19,.73,.04,.07,.06,.06);
 for(const sign of[-1,1]){mesh(banana,ball,white,-.11+sign*.095,1.80,-.21,.07,.10,.035);mesh(banana,ball,dark,-.11+sign*.095,1.80,-.24,.031,.052,.016);}
 mesh(banana,smileGeo,dark,-.10,1.79,-.01);
 for(const sign of[-1,1])mesh(banana,curve([[-.22,1.11,.06],[sign*.40,1.35,.02],[sign*.55,1.27,.04]],.065),bananaShade,0,0,0);
 const dog=costume('skin-cane');mesh(dog,ball,dogBrown,0,1.81,0,.31,.34,.29);mesh(dog,ball,cream,0,1.68,-.29,.21,.14,.17);mesh(dog,ball,dark,0,1.72,-.44,.07,.05,.04);
 for(const sign of[-1,1]){mesh(dog,ball,dogBrown,sign*.28,1.72,.015,.11,.28,.085).rotation.z=sign*.15;mesh(dog,ball,white,sign*.105,1.91,-.265,.065,.08,.025);mesh(dog,ball,dark,sign*.105,1.91,-.29,.03,.045,.014);}
 const dogTail=mesh(dog,curve([[0,.91,.33],[.11,1.00,.58],[.20,1.17,.68]],.065),dogBrown,0,0,0);skinTails.set('skin-cane',dogTail);
 const dragon=costume('skin-drago');mesh(dragon,hairGeo,dragonGreen,0,1.81,.025,.34,.36,.32);
 for(const sign of[-1,1])mesh(dragon,cone,cream,sign*.18,2.15,.02,.065,.28,.065).rotation.z=-sign*.3;
 const wingShape=new THREE.Shape();wingShape.moveTo(0,0);wingShape.lineTo(.50,.42);wingShape.lineTo(.37,-.02);wingShape.lineTo(.65,-.25);wingShape.lineTo(.18,-.12);wingShape.lineTo(0,-.35);wingShape.closePath();const wingGeometry=geometry(new THREE.ShapeGeometry(wingShape));
 for(const sign of[-1,1]){const wing=mesh(dragon,wingGeometry,dragonMembrane,sign*.27,1.32,.39,sign,1,1);wing.rotation.y=sign*.22;}
 const dragonTail=mesh(dragon,curve([[0,.84,.32],[.12,.77,.64],[.19,.94,.94]],.075),dragonGreen,0,0,0);skinTails.set('skin-drago',dragonTail);
 const companion=new THREE.Group(),classicPet=new THREE.Group();classicPet.name='companion-classic';companion.add(classicPet);
 const petColor=mat(0xffd46e),petAccent=mat(0xe9a949);
 mesh(classicPet,ball,petColor,0,.33,0,.24,.26,.22);
 mesh(classicPet,ball,petAccent,0,.16,.10,.18,.12,.17);
 const earGeo=geometry(new THREE.ConeGeometry(.095,.25,5));
 mesh(classicPet,earGeo,petAccent,-.14,.61,.01).rotation.z=.3;mesh(classicPet,earGeo,petAccent,.14,.61,.01).rotation.z=-.3;
 for(const sign of [-1,1]){mesh(classicPet,ball,white,sign*.085,.37,-.184,.060,.067,.025);mesh(classicPet,ball,dark,sign*.085,.37,-.207,.027,.037,.013);mesh(classicPet,ball,petAccent,sign*.12,.115,-.05,.067,.065,.085);}
 mesh(classicPet,ball,dark,0,.28,-.22,.032,.025,.025);
 const tail=mesh(classicPet,ball,petAccent,.18,.26,.20,.11,.10,.20);tail.rotation.y=-.6;
 function animal(id,color){const value=new THREE.Group();value.name='companion-'+id;value.visible=false;companion.add(value);petModels.set(id,value);return{root:value,color:mat(color),legs:[]};}
 function petFace(parent,y,z,snoutMaterial){for(const sign of[-1,1]){mesh(parent,ball,white,sign*.085,y,z,.055,.065,.025);mesh(parent,ball,dark,sign*.085,y,z-.024,.027,.039,.014);}mesh(parent,ball,snoutMaterial,0,y-.10,z-.02,.13,.075,.09);mesh(parent,ball,dark,0,y-.08,z-.10,.035,.026,.025);}
 function fourLegs(pet){for(const x of[-.16,.16])for(const z of[-.20,.22]){const pivot=new THREE.Group();pivot.position.set(x,.25,z);pet.root.add(pivot);mesh(pivot,cylinder,pet.color,0,-.10,0,.055,.20,.055);mesh(pivot,ball,cream,0,-.20,-.025,.068,.055,.085);pet.legs.push(pivot);}petLegs.set(pet.root.name.slice(10),pet.legs);}
 const puppy=animal('pet-cane',0xb67c50);mesh(puppy.root,ball,puppy.color,0,.34,.035,.24,.22,.36);mesh(puppy.root,ball,puppy.color,0,.55,-.29,.225,.23,.22);petFace(puppy.root,.59,-.47,cream);for(const sign of[-1,1])mesh(puppy.root,ball,puppy.color,sign*.205,.51,-.27,.085,.22,.07);mesh(puppy.root,curve([[0,.40,.32],[.09,.49,.55],[.12,.67,.62]],.045),puppy.color,0,0,0);fourLegs(puppy);
 const cat=animal('pet-gatto',0x8a9aaf);mesh(cat.root,ball,cat.color,0,.32,.04,.205,.21,.30);mesh(cat.root,ball,cat.color,0,.56,-.23,.215,.215,.195);petFace(cat.root,.59,-.40,white);for(const sign of[-1,1])mesh(cat.root,cone,cat.color,sign*.135,.79,-.24,.105,.24,.085).rotation.z=-sign*.15;mesh(cat.root,curve([[0,.34,.28],[.21,.50,.46],[.19,.79,.44],[.05,.84,.38]],.035),cat.color,0,0,0);fourLegs(cat);
 const fox=animal('pet-volpe',0xe8823e);mesh(fox.root,ball,fox.color,0,.35,.04,.22,.22,.34);mesh(fox.root,ball,fox.color,0,.57,-.28,.21,.20,.24);petFace(fox.root,.61,-.47,cream);for(const sign of[-1,1])mesh(fox.root,cone,fox.color,sign*.14,.81,-.25,.105,.28,.085).rotation.z=-sign*.2;mesh(fox.root,ball,fox.color,.11,.39,.46,.16,.16,.33).rotation.y=.25;mesh(fox.root,ball,white,.18,.39,.74,.12,.12,.16);fourLegs(fox);
 const drake=animal('pet-drago',0x57a58c);mesh(drake.root,ball,drake.color,0,.36,.04,.23,.28,.27);mesh(drake.root,ball,drake.color,0,.70,-.15,.235,.24,.21);petFace(drake.root,.74,-.33,cream);for(const sign of[-1,1]){mesh(drake.root,cone,cream,sign*.135,.96,-.10,.04,.22,.045);mesh(drake.root,ball,drake.color,sign*.17,.085,-.06,.10,.08,.16);mesh(drake.root,ball,drake.color,sign*.25,.42,-.08,.07,.14,.07);}
 const smallWings=[];for(const sign of[-1,1]){const wing=mesh(drake.root,wingGeometry,dragonMembrane,sign*.18,.53,.20,sign*.65,.65,.65);wing.rotation.y=sign*.18;smallWings.push(wing);}petWings.set('pet-drago',smallWings);mesh(drake.root,curve([[0,.30,.24],[.15,.24,.48],[.17,.39,.66]],.055),drake.color,0,0,0);for(const z of[.12,.23,.34])mesh(drake.root,cone,bananaShade,0,.63,z,.055,.15,.055);
 function setAppearance(equipped={}){
  const key=JSON.stringify([equipped.skin,equipped.pickaxe,equipped.pet,equipped.wrap]);if(key===appearance)return;appearance=key;
  selectedSkin=equipped.skin||'skin-esploratore';selectedPet=equipped.pet||'pet-nessuno';for(const[id,value]of costumes)value.visible=id===selectedSkin;head.visible=!['skin-banana','skin-cane'].includes(selectedSkin);
  const outfit=outfits[equipped.skin]||outfits['skin-esploratore'];coat.color.setHex(outfit.coat);trim.color.setHex(outfit.trim);pack.color.setHex(outfit.pack);weaponColor.color.setHex(wraps[equipped.wrap]||wraps['wrap-azzurro']);
  pants.color.setHex(outfit.pants||0x25465c);
  axeMetal.color.setHex(equipped.pickaxe==='pickaxe-cometa'?0xffc65b:equipped.pickaxe==='pickaxe-cristallo'?0xbda5ec:0xc2e0e8);
  const orbit=equipped.pet==='pet-orbit';petColor.color.setHex(orbit?0xbcb6f0:0xffd46e);petAccent.color.setHex(orbit?0x8584ce:0xe9a949);classicPet.visible=['pet-luma','pet-orbit'].includes(selectedPet);for(const[id,value]of petModels)value.visible=id===selectedPet;petEnabled=classicPet.visible||petModels.has(selectedPet);companion.visible=petEnabled;
 }
 function update({moving=false,dt=0,driving=false,aiming=false,movementMode='walk',weaponId='base',reloadRemaining=0,firing=false,reducedMotion=false}={}){
  const delta=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
  const swimming=movementMode==='swim',climbing=movementMode==='climb',reloading=Number.isFinite(reloadRemaining)&&reloadRemaining>0,reload=reloading?Math.sin(Math.min(1,reloadRemaining/1.2)*Math.PI):0;
  stride+=(Number(moving)-stride)*Math.min(1,delta*10);aimWeight+=(Number(aiming)-aimWeight)*Math.min(1,delta*13);phase+=delta*(swimming||climbing?5:moving?10:0);
  leftLeg.rotation.x=swimming?Math.sin(phase*1.8)*.24:climbing?.35+Math.sin(phase)*.35:Math.sin(phase)*.64*stride;rightLeg.rotation.x=swimming?-leftLeg.rotation.x:climbing?.35-Math.sin(phase)*.35:-leftLeg.rotation.x;
  leftArm.rotation.x=swimming?.5+Math.sin(phase)*.9:climbing?1.4+Math.sin(phase)*.45:.83+aimWeight*.16-reload*.55;rightArm.rotation.x=swimming?.5-Math.sin(phase)*.9:climbing?1.4-Math.sin(phase)*.45:.86+aimWeight*.16;
  leftArm.rotation.z=swimming||climbing?0:.82+aimWeight*.08-reload*.5;rightArm.rotation.z=swimming||climbing?0:-.12;
  forearms[0].rotation.x=swimming||climbing?0:-.18-reload*.65;forearms[1].rotation.x=swimming||climbing?0:-.12;
  body.position.y=swimming?-.9:Math.abs(Math.sin(phase))*stride*(reducedMotion?.018:.045);body.rotation.x=swimming?-.65:climbing?-.12:-.04*stride;body.rotation.z=swimming?Math.sin(phase)*.025:Math.sin(phase)*stride*(reducedMotion?0:.015);head.rotation.z=Math.sin(phase*.5)*stride*.012;
  weapon.position.set(.23-aimWeight*.035,1.09+aimWeight*.09+reload*.05,-.43-aimWeight*.05+(firing&&!reducedMotion?.035:0));weapon.rotation.set(reload*.28-(firing&&!reducedMotion?.045:0),-.035+aimWeight*.035,reload*.45);muzzleFlash.visible=Boolean(firing&&!swimming&&!climbing&&!reloading&&!driving);muzzleFlash.scale.set(.13,.11,reducedMotion?.15:.25);muzzleFlash.rotation.z=phase;
  if(weaponId!==selectedWeapon){const definition=arenaWeapon(weaponId);selectedWeapon=weaponId;for(const[kind,form]of weaponForms)form.visible=kind===definition.kind;weaponAccent.color.set(definition.color);weaponAccent.emissive.set(definition.color);muzzleMaterial.color.set(definition.color);}
  const skinTail=skinTails.get(selectedSkin);if(skinTail)skinTail.rotation.y=Math.sin(phase*.65)*stride*.13;
  for(const[order,leg]of(petLegs.get(selectedPet)||[]).entries())leg.rotation.x=Math.sin(phase+(order===0||order===3?0:Math.PI))*.35*stride;
  for(const[order,wing]of(petWings.get(selectedPet)||[]).entries())wing.rotation.y=(order?1:-1)*(.18+Math.sin(phase*.7)*.16*stride);
  group.visible=!driving;companion.visible=petEnabled&&!driving;
 }
 function dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.removeFromParent();companion.removeFromParent();}
 setAppearance({skin:'skin-esploratore',pickaxe:'pickaxe-vettore',pet:'pet-nessuno',wrap:'wrap-azzurro'});
 return{group,companion,setAppearance,update,dispose};
}
