// Keep the school shelf still while either work surface is open, including split study.
export function initWorkspaceLock(){
 const shell=document.querySelector('#app-shell'),body=document.body;
 let saved=null;
 const apply=()=>{
  const open=body.classList.contains('workspace-open');
  if(open&&!saved){
   saved={x:window.scrollX,y:window.scrollY,inert:shell.inert,position:body.style.position,top:body.style.top,left:body.style.left,width:body.style.width,overflow:body.style.overflow};
   shell.inert=true;
   Object.assign(body.style,{position:'fixed',top:`-${saved.y}px`,left:`-${saved.x}px`,width:'100%',overflow:'hidden'});
   body.dataset.workspaceLocked='true';
  }else if(!open&&saved){
   const previous=saved;saved=null;
   shell.inert=previous.inert;
   for(const key of ['position','top','left','width','overflow'])body.style[key]=previous[key];
   delete body.dataset.workspaceLocked;
   window.scrollTo(previous.x,previous.y);
  }
 };
 const observer=new MutationObserver(apply);observer.observe(body,{attributes:true,attributeFilter:['class']});apply();
 return()=>{observer.disconnect();};
}
