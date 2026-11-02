import {canonical} from './sync-model.js';

const types=['skin','pickaxe','pet','wrap'];
const catalog=[
 {id:'skin-esploratore',type:'skin',name:'Esploratore',cost:0,base:true,description:'La tua prima tuta da esplorazione.'},
 {id:'pickaxe-vettore',type:'pickaxe',name:'Vettore',cost:0,base:true,description:'Un attrezzo leggero per partire.'},
 {id:'pet-nessuno',type:'pet',name:'Senza compagno',cost:0,base:true,description:'Esplora in autonomia.'},
 {id:'wrap-azzurro',type:'wrap',name:'Azzurro',cost:0,base:true,description:'La colorazione iniziale del tuo strumento.'},
 {id:'skin-pilota',type:'skin',name:'Pilota delle correnti',cost:30,description:'Una tuta per chi cerca nuove rotte.'},
 {id:'pickaxe-cristallo',type:'pickaxe',name:'Cristallo',cost:20,description:'Un attrezzo dalle forme cristalline.'},
 {id:'pet-luma',type:'pet',name:'Luma',cost:40,description:'Il medikit recupera 10 energie in più. Le domande restano tutte.',medikitBonus:10},
 {id:'wrap-aurora',type:'wrap',name:'Aurora',cost:15,description:'Una scia di colori per il tuo strumento.'},
 {id:'skin-cartografo',type:'skin',name:'Cartografo delle isole',cost:0,reward:true,description:'Regalo della missione Prime risposte.'},
 {id:'pickaxe-cometa',type:'pickaxe',name:'Cometa',cost:0,reward:true,description:'Regalo della missione Incontro con i robot.'},
 {id:'pet-orbit',type:'pet',name:'Orbit',cost:0,reward:true,description:'Regalo dei rifornimenti: medikit con 10 energie in più, senza saltare domande.',medikitBonus:10},
 {id:'wrap-solare',type:'wrap',name:'Solare',cost:0,reward:true,description:'Regalo della missione Raccontalo tu.'},
];
export const ARENA_CATALOG=Object.freeze(catalog.map(item=>Object.freeze({base:false,reward:false,medikitBonus:0,...item})));
export const ARENA_MISSIONS=Object.freeze([
 {id:'m-prime-risposte',name:'Prime risposte',description:'Completa cinque risposte corrette.',stat:'correct',target:5,rewardId:'skin-cartografo'},
 {id:'m-robot',name:'Incontro con i robot',description:'Completa due incontri con i robot, due domande ciascuno.',stat:'robots',target:2,rewardId:'pickaxe-cometa'},
 {id:'m-rifornimenti',name:'Rotta dei rifornimenti',description:'Apri tre rifornimenti rispondendo alle loro domande.',stat:'loot',target:3,rewardId:'pet-orbit'},
 {id:'m-riassunto',name:'Raccontalo tu',description:'Scrivi un piccolo riassunto e conferma di averlo riletto.',stat:'summaries',target:1,rewardId:'wrap-solare'},
].map(Object.freeze));
export const LOOT_QUESTION_COUNTS=Object.freeze({noncomune:2,comune:4,rara:6,epica:8,leggendaria:10});

const itemById=new Map(ARENA_CATALOG.map(item=>[item.id,item]));
const missionById=new Map(ARENA_MISSIONS.map(item=>[item.id,item]));
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const validId=(value,limit=256)=>typeof value==='string'&&value.length>0&&value.length<=limit&&value.trim()===value;
const keyFor=(runId,id)=>JSON.stringify([runId,id]);
function ids(runId,id,limit=256){if(!validId(runId)||!validId(id,limit))throw Error('Riapri il giro prima di registrare questa attività.');return keyFor(runId,id);}
function pair(key,limit=256){let value;try{value=JSON.parse(key);}catch{}if(!Array.isArray(value)||value.length!==2||!validId(value[0])||!validId(value[1],limit)||keyFor(...value)!==key)throw Error('Una ricevuta del gioco non è leggibile.');return value;}
function checkSummary(text,confirmed){
 if(confirmed!==true)throw Error('Rileggi il tuo riassunto e conferma di averlo controllato.');
 if(typeof text!=='string'||text.length>10000||(text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[]).length<10)throw Error('Scrivi un piccolo riassunto di almeno dieci parole.');
}
export function lootQuestionCount(rarity){if(!Object.hasOwn(LOOT_QUESTION_COUNTS,rarity))throw Error('Scegli una rarità disponibile.');return LOOT_QUESTION_COUNTS[rarity];}

export function newArenaProfile(){
 return{version:1,credits:0,owned:ARENA_CATALOG.filter(item=>item.base).map(item=>item.id),equipped:Object.fromEntries(types.map(type=>[type,ARENA_CATALOG.find(item=>item.base&&item.type===type).id])),missions:{},stats:{correct:0,robots:0,loot:0,summaries:0},receipts:{answers:{},activities:{}}};
}

function checkActivityReceipt(receipt,runId,answers){
 if(!record(receipt)||!['robot','loot','summary'].includes(receipt.kind))throw Error('Una ricevuta di attività non è valida.');
 if(receipt.kind==='summary'){checkSummary(receipt.text,receipt.confirmed);return;}
 const required=receipt.kind==='robot'?2:lootQuestionCount(receipt.rarity),questionIds=receipt.questionIds;
 if(!Array.isArray(questionIds)||questionIds.length<required||new Set(questionIds).size!==questionIds.length||questionIds.some(id=>!validId(id,1024)||answers[keyFor(runId,id)]!==true))throw Error('Completa tutte le domande di questa attività prima di raccogliere il risultato.');
}
export function validateArenaProfile(profile){
 if(!record(profile)||profile.version!==1||!count(profile.credits)||!Array.isArray(profile.owned)||new Set(profile.owned).size!==profile.owned.length||profile.owned.some(id=>!itemById.has(id))||!record(profile.equipped)||!record(profile.missions)||!record(profile.stats)||!record(profile.receipts)||!record(profile.receipts.answers)||!record(profile.receipts.activities))throw Error('Il profilo del gioco non è leggibile. Conserva la copia e riprova.');
 if(ARENA_CATALOG.some(item=>item.base&&!profile.owned.includes(item.id))||types.some(type=>!profile.owned.includes(profile.equipped[type])||itemById.get(profile.equipped[type])?.type!==type)||Object.keys(profile.equipped).some(type=>!types.includes(type)))throw Error('L’armadietto contiene un oggetto non disponibile.');
 const stats={correct:0,robots:0,loot:0,summaries:0};
 for(const[key,value]of Object.entries(profile.receipts.answers)){pair(key,1024);if(value!==true)throw Error('Una risposta del gioco non è valida.');stats.correct++;}
 for(const[key,value]of Object.entries(profile.receipts.activities)){const[runId]=pair(key);checkActivityReceipt(value,runId,profile.receipts.answers);stats[value.kind==='robot'?'robots':value.kind==='loot'?'loot':'summaries']++;}
 if(Object.entries(stats).some(([key,value])=>!count(profile.stats[key])||profile.stats[key]!==value))throw Error('I risultati del gioco non corrispondono alle ricevute.');
 for(const[id,value]of Object.entries(profile.missions)){
  const mission=missionById.get(id);if(!mission||value!==true||stats[mission.stat]<mission.target||!profile.owned.includes(mission.rewardId))throw Error('Il regalo della missione non è ancora disponibile.');
 }
 for(const id of profile.owned){const item=itemById.get(id);if(item.reward&&!ARENA_MISSIONS.some(mission=>mission.rewardId===id&&profile.missions[mission.id]===true))throw Error('Completa la missione prima di ricevere questo regalo.');}
 const spent=profile.owned.reduce((sum,id)=>sum+itemById.get(id).cost,0),balance=stats.correct*5-spent;
 if(!count(balance)||balance!==profile.credits)throw Error('Il saldo dei crediti non corrisponde agli acquisti.');
 return structuredClone(profile);
}

export function buyArenaItem(profile,id){
 const next=validateArenaProfile(profile),item=itemById.get(id);
 if(!item||item.reward)throw Error('Questo oggetto non è acquistabile nello shop.');
 if(next.owned.includes(id))return next;
 if(next.credits<item.cost)throw Error('Non hai ancora abbastanza crediti. Rispondi alle domande per guadagnarli.');
 next.credits-=item.cost;next.owned.push(id);return next;
}
export function equipArenaItem(profile,id){
 const next=validateArenaProfile(profile),item=itemById.get(id);
 if(!item||!next.owned.includes(id))throw Error('Prima ottieni questo oggetto nello shop o nelle missioni.');
 next.equipped[item.type]=id;return next;
}
export function awardArenaAnswer(profile,{questionId,correct,runId}={}){
 const next=validateArenaProfile(profile),key=ids(runId,questionId,1024);
 if(typeof correct!=='boolean')throw Error('Controlla la risposta prima di assegnare i crediti.');
 if(!correct||Object.hasOwn(next.receipts.answers,key))return next;
 if(!Number.isSafeInteger(next.credits+5))throw Error('Il saldo dei crediti non può essere aggiornato.');
 next.receipts.answers[key]=true;next.credits+=5;next.stats.correct++;return next;
}
export function completeArenaActivity(profile,{runId,activityId,kind,questionIds=[],rarity,text,confirmed}={}){
 const next=validateArenaProfile(profile),key=ids(runId,activityId);
 if(!['robot','loot','summary'].includes(kind))throw Error('Questa attività non è disponibile.');
 if(kind==='summary')checkSummary(text,confirmed);
 const receipt=kind==='summary'?{kind,text,confirmed:true}:{kind,questionIds:structuredClone(questionIds),...(kind==='loot'?{rarity}:{})};
 checkActivityReceipt(receipt,runId,next.receipts.answers);
 if(Object.hasOwn(next.receipts.activities,key)){
  if(canonical(next.receipts.activities[key])!==canonical(receipt))throw Error('Questa attività è già stata registrata con un altro risultato.');
  return next;
 }
 next.receipts.activities[key]=receipt;next.stats[kind==='robot'?'robots':kind==='loot'?'loot':'summaries']++;return next;
}
export function claimArenaMission(profile,id){
 const next=validateArenaProfile(profile),mission=missionById.get(id);
 if(!mission)throw Error('Scegli una missione disponibile.');
 if(next.missions[id]===true)return next;
 if(next.stats[mission.stat]<mission.target)throw Error('Completa prima l’obiettivo della missione.');
 next.missions[id]=true;if(!next.owned.includes(mission.rewardId))next.owned.push(mission.rewardId);return next;
}
export function arenaCompanionBonus(profile){const checked=validateArenaProfile(profile);return itemById.get(checked.equipped.pet).medikitBonus;}

function checkedRun(run){
 if(!record(run)||run.version!==1||typeof run.buildMode!=='boolean'||!Number.isSafeInteger(run.health)||run.health<0||run.health>100||!['active','rest'].includes(run.phase)||(run.phase==='rest')!==(run.health===0)||['correct','wrong','summaries'].some(key=>!count(run[key])))throw Error('Riapri il giro per ritrovare la tua energia.');
 return structuredClone(run);
}
export function newArenaRun({buildMode=true}={}){if(typeof buildMode!=='boolean')throw Error('Scegli se costruire prima di partire.');return{version:1,health:100,phase:'active',buildMode,correct:0,wrong:0,summaries:0};}
export function applyArenaAnswer(run,correct){
 const next=checkedRun(run);if(next.phase!=='active')throw Error('Riparti con energia nuova prima della prossima domanda.');if(typeof correct!=='boolean')throw Error('Controlla la risposta prima di continuare.');
 if(correct)next.correct++;else{next.wrong++;next.health=Math.max(0,next.health-5);if(next.health===0)next.phase='rest';}return next;
}
export function damageArenaRun(run,amount=5){
 const next=checkedRun(run);if(next.phase!=='active')throw Error('Riparti con energia nuova prima di continuare.');if(!Number.isSafeInteger(amount)||amount<0||amount>100)throw Error('Il danno deve essere un numero intero da zero a cento.');
 next.health=Math.max(0,next.health-amount);if(next.health===0)next.phase='rest';return next;
}
export function restartArenaRun(run){const next=checkedRun(run);if(next.phase!=='rest')throw Error('Puoi ripartire quando il giro è in pausa senza energia.');next.health=100;next.phase='active';return next;}
export function completeArenaSummary(run,text,{confirmed=false,bonus=0}={}){
 const next=checkedRun(run);if(next.phase!=='active')throw Error('Riparti con energia nuova prima di usare il medikit.');checkSummary(text,confirmed);if(![0,10].includes(bonus))throw Error('Il bonus del compagno non è valido.');
 next.health=Math.min(100,next.health+50+bonus);next.summaries++;return next;
}
