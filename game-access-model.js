const ITERATIONS=150000;
const invalidWindow=()=>({day:null,weekday:null,minutes:null,blocked:true});
const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const pinValid=pin=>typeof pin==='string'&&/^[0-9]{6}$/.test(pin);
const hex=bytes=>[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const bytes=value=>Uint8Array.from(value.match(/../g),part=>Number.parseInt(part,16));

function validCredential(value){
 return record(value)&&value.version===1&&value.algorithm==='PBKDF2'&&value.digest==='SHA-256'&&value.iterations===ITERATIONS&&typeof value.salt==='string'&&/^[a-f0-9]{32}$/.test(value.salt)&&typeof value.hash==='string'&&/^[a-f0-9]{64}$/.test(value.hash);
}

export function gameSchoolWindow(now=Date.now()){
 try{
  const timestamp=now instanceof Date?now.getTime():now;
  if(typeof timestamp!=='number'||!Number.isFinite(timestamp))return invalidWindow();
  const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return invalidWindow();
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',era:'short'}).formatToParts(date).map(part=>[part.type,part.value]));
  const year=Number(values.year),weekday=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(values.weekday)+1,minutes=Number(values.hour)*60+Number(values.minute);
  if(values.era!=='AD'||!Number.isInteger(year)||year<1||year>9999||weekday<1||!Number.isInteger(minutes)||minutes<0||minutes>=1440)return invalidWindow();
  return{day:`${String(year).padStart(4,'0')}-${values.month}-${values.day}`,weekday,minutes,blocked:weekday<=5&&minutes>=480&&minutes<900};
 }catch{return invalidWindow();}
}

export function gameAccessState(options={}){
 if(!record(options))return{allowed:false,blocked:true,hasPin:false,day:null,temporary:false};
 const{credential,grant,now=Date.now()}=options,window=gameSchoolWindow(now),hasPin=validCredential(credential);
 const temporary=Boolean(window.day&&window.blocked&&hasPin&&record(grant)&&grant.day===window.day&&grant.credentialHash===credential.hash);
 return{allowed:Boolean(window.day&&(!window.blocked||temporary)),blocked:window.blocked,hasPin,day:window.day,temporary};
}

function webCrypto(){
 const crypto=globalThis.crypto;
 if(!crypto?.subtle||typeof crypto.getRandomValues!=='function')throw Error('La protezione del PIN non è disponibile. Apri Skooling da un collegamento sicuro.');
 return crypto;
}
async function derive(pin,salt){
 const crypto=webCrypto(),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:ITERATIONS,salt},key,256));
}

export async function createGamePin(pin){
 if(!pinValid(pin))throw Error('Il PIN deve contenere esattamente 6 cifre.');
 const salt=webCrypto().getRandomValues(new Uint8Array(16)),hash=await derive(pin,salt);
 return{version:1,algorithm:'PBKDF2',digest:'SHA-256',iterations:ITERATIONS,salt:hex(salt),hash:hex(hash)};
}

export async function verifyGamePin(pin,credential){
 if(!pinValid(pin)||!validCredential(credential))return false;
 try{
  // Capture the complete credential before WebCrypto yields to the caller.
  const salt=bytes(credential.salt),expected=bytes(credential.hash),actual=await derive(pin,salt);
  let difference=0;for(let index=0;index<expected.length;index++)difference|=expected[index]^actual[index];
  return difference===0;
 }catch{return false;}
}
