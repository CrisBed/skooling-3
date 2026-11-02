import * as THREE from './vendor/three-r187.module.min.js';

const outfits={
 'skin-esploratore':{coat:0xe97a35,trim:0xffdea0,pack:0x287d91},
 'skin-pilota':{coat:0x7562c4,trim:0xe0d0ff,pack:0xdc9954},
 'skin-cartografo':{coat:0x258c81,trim:0xbcebd5,pack:0x93664b},
};
const wraps={'wrap-azzurro':0x3bbfe0,'wrap-aurora':0xb480e2,'wrap-solare':0xffcb50};

// The explorer is an original articulated model built from local geometry.
// Its origin is at the feet, and its forward direction is negative Z.
export function createArenaCharacter3D(){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let disposed=false,appearance='',phase=0,stride=0,petEnabled=false;
 const geometry=value=>(geometries.add(value),value);
 const mat=(color,extra={})=>{const value=new THREE.MeshStandardMaterial({color,roughness:.76,metalness:0,...extra});materials.add(value);return value;};
 const box=geometry(new THREE.BoxGeometry(1,1,1)),ball=geometry(new THREE.SphereGeometry(1,12,10)),cylinder=geometry(new THREE.CylinderGeometry(1,1,1,10)),bootGeo=geometry(new THREE.BoxGeometry(1,1,1));
 const coat=mat(0xe97a35),trim=mat(0xffdea0),pack=mat(0x287d91),pants=mat(0x25465c),dark=mat(0x18364b),skin=mat(0xeac19c),glove=mat(0xf8dfb1),white=mat(0xf5f5e7);
 const glass=mat(0x63e2ee,{roughness:.2,metalness:.42,emissive:0x126c80,emissiveIntensity:.22}),weaponColor=mat(0x3bbfe0,{metalness:.2,roughness:.45}),axeMetal=mat(0xc2e0e8,{metalness:.38,roughness:.4}),wood=mat(0x8b6549);
 function mesh(parent,shape,material,x,y,z,sx=1,sy=1,sz=1){const m=new THREE.Mesh(shape,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m;}
 const body=new THREE.Group();group.add(body);
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
 mesh(body,box,dark,-.20,1.23,-.175,.055,.49,.05);mesh(body,box,dark,.20,1.23,-.175,.055,.49,.05);
 const pickaxe=new THREE.Group();pickaxe.position.set(-.26,1.22,.38);pickaxe.rotation.z=-.45;body.add(pickaxe);
 mesh(pickaxe,cylinder,wood,0,0,0,.025,.8,.025);
 const axeHead=mesh(pickaxe,box,axeMetal,0,.37,0,.43,.09,.1);axeHead.rotation.z=.18;
 const axeTip=mesh(pickaxe,geometry(new THREE.ConeGeometry(.085,.22,4)),axeMetal,-.25,.36,0);axeTip.rotation.z=Math.PI/2;
 const leftArm=new THREE.Group(),rightArm=new THREE.Group();
 for(const [arm,sign]of[[leftArm,-1],[rightArm,1]]){
  arm.position.set(sign*.34,1.43,0);body.add(arm);
  mesh(arm,ball,coat,0,-.035,0,.145,.15,.145);
  mesh(arm,cylinder,coat,0,-.20,0,.10,.32,.10);
  mesh(arm,ball,dark,0,-.36,0,.10,.105,.10);
  mesh(arm,cylinder,coat,0,-.46,-.015,.09,.21,.09);
  mesh(arm,cylinder,trim,0,-.57,-.015,.095,.055,.095);
  mesh(arm,ball,glove,0,-.63,-.02,.10,.12,.10);
 }
 const leftLeg=new THREE.Group(),rightLeg=new THREE.Group();
 for(const [leg,sign]of[[leftLeg,-1],[rightLeg,1]]){
  leg.position.set(sign*.145,.83,0);body.add(leg);
  mesh(leg,cylinder,pants,0,-.19,0,.115,.38,.115);
  mesh(leg,ball,dark,0,-.39,-.01,.115,.115,.115);
  mesh(leg,cylinder,pants,0,-.56,0,.10,.30,.105);
  mesh(leg,bootGeo,dark,0,-.73,-.055,.24,.19,.36);
  mesh(leg,box,trim,0,-.66,-.14,.17,.035,.07);
 }
 const weapon=new THREE.Group();weapon.position.set(.32,1.04,-.43);body.add(weapon);
 mesh(weapon,box,weaponColor,0,0,0,.16,.16,.43);mesh(weapon,box,dark,0,-.13,.075,.10,.22,.11);
 mesh(weapon,cylinder,dark,0,0,-.25,.062,.16,.062).rotation.x=Math.PI/2;
 mesh(weapon,cylinder,glass,0,0,-.337,.045,.022,.045).rotation.x=Math.PI/2;
 mesh(weapon,box,white,0,.09,-.035,.06,.025,.23);
 const companion=new THREE.Group();
 const petColor=mat(0xffd46e),petAccent=mat(0xe9a949);
 mesh(companion,ball,petColor,0,.33,0,.24,.26,.22);
 mesh(companion,ball,petAccent,0,.16,.10,.18,.12,.17);
 const earGeo=geometry(new THREE.ConeGeometry(.095,.25,5));
 mesh(companion,earGeo,petAccent,-.14,.61,.01).rotation.z=.3;mesh(companion,earGeo,petAccent,.14,.61,.01).rotation.z=-.3;
 for(const sign of [-1,1]){mesh(companion,ball,white,sign*.085,.37,-.184,.060,.067,.025);mesh(companion,ball,dark,sign*.085,.37,-.207,.027,.037,.013);mesh(companion,ball,petAccent,sign*.12,.115,-.05,.067,.065,.085);}
 mesh(companion,ball,dark,0,.28,-.22,.032,.025,.025);
 const tail=mesh(companion,ball,petAccent,.18,.26,.20,.11,.10,.20);tail.rotation.y=-.6;
 function setAppearance(equipped={}){
  const key=JSON.stringify([equipped.skin,equipped.pickaxe,equipped.pet,equipped.wrap]);if(key===appearance)return;appearance=key;
  const outfit=outfits[equipped.skin]||outfits['skin-esploratore'];coat.color.setHex(outfit.coat);trim.color.setHex(outfit.trim);pack.color.setHex(outfit.pack);weaponColor.color.setHex(wraps[equipped.wrap]||wraps['wrap-azzurro']);
  axeMetal.color.setHex(equipped.pickaxe==='pickaxe-cometa'?0xffc65b:equipped.pickaxe==='pickaxe-cristallo'?0xbda5ec:0xc2e0e8);
  const orbit=equipped.pet==='pet-orbit';petColor.color.setHex(orbit?0xbcb6f0:0xffd46e);petAccent.color.setHex(orbit?0x8584ce:0xe9a949);petEnabled=Boolean(equipped.pet&&equipped.pet!=='pet-nessuno');companion.visible=petEnabled;
 }
 function update({moving=false,dt=0,driving=false,aiming=false}={}){
  const delta=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
  stride+=(Number(moving)-stride)*Math.min(1,delta*10);if(moving)phase+=delta*9;
  leftLeg.rotation.x=Math.sin(phase)*.55*stride;rightLeg.rotation.x=-leftLeg.rotation.x;
  leftArm.rotation.x=-Math.sin(phase)*.42*stride;rightArm.rotation.x=aiming?.88:.43+Math.sin(phase)*.16*stride;
  body.position.y=Math.abs(Math.sin(phase))*stride*.035;head.rotation.z=Math.sin(phase*.5)*stride*.015;weapon.position.y=1.04+Math.sin(phase)*stride*.018;
  group.visible=!driving;companion.visible=petEnabled&&!driving;
 }
 function dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.removeFromParent();companion.removeFromParent();}
 setAppearance({skin:'skin-esploratore',pickaxe:'pickaxe-vettore',pet:'pet-nessuno',wrap:'wrap-azzurro'});
 return{group,companion,setAppearance,update,dispose};
}
