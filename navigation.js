// Navigation stays visible; there is no modal drawer or keyboard trap.
export function initMenu(){
 document.querySelector('#side-menu').hidden=false;
 for(const id of ['menu-toggle','menu-close','menu-backdrop'])document.querySelector('#'+id).hidden=true;
 document.body.classList.remove('menu-open');
 for(const node of document.querySelectorAll('#main-content,.topbar .brand,#student-switch'))node.inert=false;
}
