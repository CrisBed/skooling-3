import {SHAPES,geometryPaths} from './geometry.js';

const byId=new Map(SHAPES.map(shape=>[shape.id,shape]));
const bindings=new WeakMap();let sequence=0;

// Tutte le anteprime sono generate dal catalogo locale, mai da markup importato.
export function shapeIconSvg(id){
  if(!byId.has(id))return '';
  let content;
  if(id==='linea')content='<path d="M18 78L82 22"/>';
  else if(id==='freccia')content='<path d="M18 78L82 22M57 25L82 22L79 47"/>';
  else if(id==='cerchio')content='<ellipse cx="50" cy="50" rx="32" ry="32"/>';
  else if(id==='rettangolo')content='<rect x="12" y="28" width="76" height="44" rx="1"/>';
  else {
    const paths=geometryPaths({tipo:id,x1:.16,y1:id==='ellisse'?.3:.16,x2:.84,y2:id==='ellisse'?.7:.84});
    const coord=p=>`${Number((p.x*100).toFixed(2))} ${Number((p.y*100).toFixed(2))}`;
    content=paths.map(path=>`<path d="M${path.map(coord).join('L')}"/>`).join('');
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}

export function attachShapePicker(root,surface,{onSelect=()=>{}}={}){
  if(bindings.has(root))return bindings.get(root);
  const grid=root.querySelector('.tool-grid');
  if(!grid)return null;
  const originals=[...grid.querySelectorAll('[data-tool]')].filter(button=>byId.has(button.dataset.tool));
  const trigger=document.createElement('button');
  trigger.type='button';trigger.dataset.shapePicker='';
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  const dialog=document.createElement('dialog');
  dialog.className='shape-picker';dialog.id=`shape-picker-${++sequence}`;
  dialog.setAttribute('aria-labelledby',`${dialog.id}-title`);
  trigger.setAttribute('aria-controls',dialog.id);
  dialog.innerHTML=`<div class="shape-picker-head"><div><h2 id="${dialog.id}-title">Scegli una forma</h2><p>Poi trascina sul foglio per disegnarla.</p></div><button type="button" class="button secondary" data-shape-close>Chiudi</button></div><div class="shape-picker-grid" role="group" aria-label="Forme geometriche">${SHAPES.map(shape=>`<button type="button" class="shape-choice" data-shape="${shape.id}" aria-pressed="false">${shapeIconSvg(shape.id)}<span>${shape.label}</span></button>`).join('')}</div>`;
  if(originals.length)originals[0].before(trigger);else grid.append(trigger);
  for(const button of originals)button.remove();
  document.body.append(dialog);
  const choices=[...dialog.querySelectorAll('[data-shape]')];
  const sync=()=>{
    const selected=byId.get(surface.tool),active=Boolean(selected&&!surface.readOnly);
    trigger.innerHTML=`${shapeIconSvg(selected?.id||'triangolo')}<span>Forme</span>`;
    trigger.classList.toggle('active',active);
    trigger.setAttribute('aria-pressed',String(active));
    trigger.setAttribute('aria-label',selected?`Forme, scelta: ${selected.label}`:'Forme geometriche');
    for(const choice of choices){
      const chosen=choice.dataset.shape===selected?.id;
      choice.classList.toggle('active',chosen);
      choice.setAttribute('aria-pressed',String(chosen));
    }
  };
  const previous=surface.onStateChange;
  const changed=(...args)=>{previous?.(...args);sync();};
  surface.onStateChange=changed;
  const close=()=>{if(dialog.open)dialog.close();};
  trigger.addEventListener('click',()=>{
    sync();if(dialog.open)return;
    dialog.showModal();trigger.setAttribute('aria-expanded','true');
    (choices.find(button=>button.dataset.shape===surface.tool)||choices[0]).focus({preventScroll:true});
  });
  dialog.querySelector('[data-shape-close]').addEventListener('click',close);
  dialog.addEventListener('close',()=>{
    trigger.setAttribute('aria-expanded','false');sync();
    if(trigger.isConnected)trigger.focus({preventScroll:true});
  });
  dialog.addEventListener('click',event=>{
    const choice=event.target.closest('[data-shape]');
    if(choice&&dialog.contains(choice)){
      const id=choice.dataset.shape;if(!byId.has(id))return;
      surface.setTool(id);onSelect(id);sync();close();return;
    }
    if(event.target===dialog){
      const rect=dialog.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();
    }
  });
  dialog.addEventListener('keydown',event=>{
    // Le frecce restano nel pannello, senza cambiare la pagina del libro sotto.
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))event.stopPropagation();
    const index=choices.indexOf(document.activeElement);
    if(index<0)return;
    const columns=Math.max(1,getComputedStyle(dialog.querySelector('.shape-picker-grid')).gridTemplateColumns.split(' ').length);
    let next;
    if(event.key==='ArrowRight')next=(index+1)%choices.length;
    else if(event.key==='ArrowLeft')next=(index+choices.length-1)%choices.length;
    else if(event.key==='ArrowDown')next=Math.min(choices.length-1,index+columns);
    else if(event.key==='ArrowUp')next=Math.max(0,index-columns);
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=choices.length-1;
    else return;
    event.preventDefault();choices[next].focus();
  });
  const binding={trigger,dialog,sync,destroy(){
    close();dialog.remove();trigger.remove();
    if(surface.onStateChange===changed)surface.onStateChange=previous;
    bindings.delete(root);
  }};
  bindings.set(root,binding);sync();return binding;
}
