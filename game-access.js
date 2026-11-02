import {gameAccessState,createGamePin,verifyGamePin} from './game-access-model.js';

const PIN_KEY='skooling3-game-parent-v1',GRANT_KEY='skooling3-game-permission-v1';
let pendingAccess=null;
const changed=()=>document.dispatchEvent(new Event('skooling:game-access-changed'));
const failedState=()=>({allowed:false,blocked:true,hasPin:false,day:null,temporary:false,storageError:true});
function configuration(){
 const raw=localStorage.getItem(PIN_KEY),credential=raw===null?null:JSON.parse(raw);
 if(raw!==null&&!gameAccessState({credential}).hasPin)throw Error('Il codice salvato non è leggibile. Il gioco resta protetto.');
 return{raw,credential};
}
export function readGameAccess(now=Date.now()){
 try{
  const{credential}=configuration(),raw=sessionStorage.getItem(GRANT_KEY),grant=raw?JSON.parse(raw):null;
  return gameAccessState({credential,grant,now});
 }catch{return failedState();}
}
window.addEventListener('storage',event=>{if(event.key===PIN_KEY||event.key===GRANT_KEY||event.key===null)changed();});

function mount(title,content){
 const previous=document.activeElement,dialog=document.createElement('dialog');
 dialog.className='quiz-dialog game-access-dialog';dialog.setAttribute('aria-label',title);
 dialog.innerHTML=`<div class="dialog-form"><h2>${title}</h2>${content}<p class="form-error" role="alert" data-game-error></p><div class="dialog-actions"><button type="button" class="button secondary" data-game-close>Chiudi</button></div></div>`;
 let busy=false;
 const q=s=>dialog.querySelector(s),setBusy=value=>{busy=value;for(const b of dialog.querySelectorAll('button'))b.disabled=value;};
 const close=()=>{if(!busy)dialog.close();};q('[data-game-close]').onclick=close;
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('close',()=>{for(const input of dialog.querySelectorAll('input'))input.value='';dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:game-access-closed'));});
 document.body.append(dialog);dialog.showModal();return{dialog,q,setBusy,close};
}

export function openGameParentSettings(){
 if(document.querySelector('.game-access-dialog[open]'))return;
 let initial,error;try{initial=configuration();}catch(e){error=e;}
 const hasPin=Boolean(initial?.credential);
 const form=`<p>Il codice del papà ha 6 cifre. Serve per giocare dal lunedì al venerdì, dalle 08:00 alle 15:00.</p><p>Si conserva solo su questo dispositivo, anche chiudendo l’app. Non viene trasferito con i compiti o con i backup. Impostalo anche sull’iPad di Gabriel.</p><form data-game-parent-form>${hasPin?'<label>Codice attuale<input type="password" data-game-current-pin inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label>':''}<label>${hasPin?'Nuovo codice':'Scegli il codice'}<input type="password" data-game-new-pin inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><label>Ripeti il codice<input type="password" data-game-confirm-pin inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><p class="small-copy">Prima configurazione: il papà sceglie il codice senza comunicarlo a Gabriel. Conservalo: per cambiarlo servirà quello attuale.</p><button class="button primary" type="submit" data-game-save-pin>Salva codice</button></form>`;
 const{dialog,q,setBusy,close}=mount('Codice del papà',form);
 if(error){q('[data-game-error]').textContent=error.message;q('[data-game-save-pin]').disabled=true;return dialog;}
 let busy=false;
 q('[data-game-parent-form]').onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;setBusy(true);q('[data-game-error]').textContent='';
  try{
   const pin=q('[data-game-new-pin]').value,confirmation=q('[data-game-confirm-pin]').value;
   if(pin!==confirmation)throw Error('I due codici non coincidono. Scrivili di nuovo.');
   if(initial.credential&&!await verifyGamePin(q('[data-game-current-pin]').value,initial.credential))throw Error('Codice attuale non corretto.');
   const credential=await createGamePin(pin);
   if(!dialog.isConnected)return;
   if(localStorage.getItem(PIN_KEY)!==initial.raw)throw Error('Il codice è cambiato in un’altra finestra. Chiudi e riapri queste impostazioni.');
   const serialized=JSON.stringify(credential);localStorage.setItem(PIN_KEY,serialized);
   if(localStorage.getItem(PIN_KEY)!==serialized)throw Error('Non riesco a verificare il salvataggio del codice. Non chiudere e riprova.');
   // Anche senza rimozione, una vecchia concessione non corrisponde al nuovo hash.
   try{sessionStorage.removeItem(GRANT_KEY);}catch{}
   setBusy(false);close();changed();
  }catch(e){if(dialog.isConnected)q('[data-game-error]').textContent=e.message||'Non riesco a salvare il codice. Riprova.';}
  finally{busy=false;if(dialog.isConnected)setBusy(false);}
 };
 return dialog;
}

export function ensureGameAccess(){
 if(readGameAccess().allowed)return Promise.resolve(true);
 if(pendingAccess)return pendingAccess;
 if(document.querySelector('.game-access-dialog[open]'))return Promise.resolve(false);
 let finish;
 const operation=new Promise(resolve=>finish=resolve);pendingAccess=operation;
 const state=readGameAccess();
 const content=`<p><strong>Adesso il gioco riposa: è ora di scuola.</strong></p><p>Dal lunedì al venerdì resta bloccato dalle 08:00 alle 15:00, secondo l’ora italiana.</p><p>Se oggi sei a casa o in vacanza, il papà può sbloccarlo solo per questa giornata. Domani il blocco torna da solo.</p>${state.hasPin?'<form data-game-unlock-form><label>Codice del papà<input type="password" data-game-pin inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label><button type="submit" class="button primary" data-game-unlock>Sblocca per oggi</button></form>':'<p>Il papà deve prima scegliere il suo codice nelle Impostazioni.</p><button type="button" class="button secondary" data-game-configure>Per il papà: imposta il codice</button>'}`;
 const{dialog,q,setBusy,close}=mount('Gioco durante la scuola',content);
 let busy=false,authorized=false,attempts=0,retryAt=0;
 dialog.addEventListener('close',()=>{if(pendingAccess===operation)pendingAccess=null;finish(authorized&&readGameAccess().allowed);});
 if(state.storageError){q('[data-game-error]').textContent='Non riesco a leggere il permesso su questo dispositivo. Il gioco resta bloccato.';q('[data-game-configure]')?.setAttribute('disabled','');}
 q('[data-game-configure]')?.addEventListener('click',()=>{close();openGameParentSettings();});
 if(state.hasPin)q('[data-game-unlock-form]').onsubmit=async event=>{
  event.preventDefault();if(busy)return;q('[data-game-error]').textContent='';
  if(Date.now()<retryAt){q('[data-game-error]').textContent='Aspetta qualche secondo prima di riprovare con il papà.';return;}
  busy=true;setBusy(true);
  try{
   const initial=configuration(),pin=q('[data-game-pin]').value;q('[data-game-pin]').value='';
   if(!await verifyGamePin(pin,initial.credential)){attempts++;if(attempts>=5){retryAt=Date.now()+30000;attempts=0;}throw Error('Codice non corretto. Chiedi al papà.');}
   if(!dialog.isConnected)return;
   if(localStorage.getItem(PIN_KEY)!==initial.raw)throw Error('Il codice è cambiato. Chiudi e riprova con il papà.');
   const current=gameAccessState({credential:initial.credential});if(!current.day)throw Error('Non riesco a verificare la giornata. Il gioco resta bloccato.');
   const grant={day:current.day,credentialHash:initial.credential.hash},serialized=JSON.stringify(grant);sessionStorage.setItem(GRANT_KEY,serialized);
   if(sessionStorage.getItem(GRANT_KEY)!==serialized||!readGameAccess().allowed)throw Error('Non riesco a conservare il permesso. Il gioco resta bloccato.');
   authorized=true;setBusy(false);close();changed();
  }catch(e){if(dialog.isConnected)q('[data-game-error]').textContent=e.message||'Non riesco a verificare il permesso. Riprova con il papà.';}
  finally{busy=false;if(dialog.isConnected)setBusy(false);}
 };
 return operation;
}
