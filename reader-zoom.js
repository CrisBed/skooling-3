// An anchor belongs to one physical page, not to the spread including its gutter.
export function capturePageAnchor(rectangles,point){
 let nearest=null;
 rectangles.forEach((rect,page)=>{
  if(!rect||rect.width<=0||rect.height<=0)return;
  const x=Math.max(rect.left,Math.min(rect.left+rect.width,point.x));
  const y=Math.max(rect.top,Math.min(rect.top+rect.height,point.y));
  const distance=(x-point.x)**2+(y-point.y)**2;
  if(!nearest||distance<nearest.distance)nearest={page,x:(x-rect.left)/rect.width,y:(y-rect.top)/rect.height,distance};
 });
 if(!nearest)return null;
 const{page,x,y}=nearest;return{page,x,y};
}
export function anchorScrollDelta(rect,anchor,screen){
 return{x:rect.left+anchor.x*rect.width-screen.x,y:rect.top+anchor.y*rect.height-screen.y};
}
