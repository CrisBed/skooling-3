// Primitive geometriche normalizzate, condivise da disegno, gomma e anteprime.
// I tipi già salvati continuano a usare il loro renderer storico.
export const SHAPES = Object.freeze([
  {id:'linea',label:'Riga'},
  {id:'freccia',label:'Freccia'},
  {id:'cerchio',label:'Cerchio'},
  {id:'rettangolo',label:'Rettangolo'},
  {id:'quadrato',label:'Quadrato'},
  {id:'triangolo',label:'Triangolo'},
  {id:'triangolo-rettangolo',label:'Triangolo rettangolo'},
  {id:'rombo',label:'Rombo'},
  {id:'parallelogramma',label:'Parallelogramma'},
  {id:'trapezio',label:'Trapezio'},
  {id:'pentagono',label:'Pentagono'},
  {id:'esagono',label:'Esagono'},
  {id:'ellisse',label:'Ovale'},
].map(Object.freeze));

export const NEW_SHAPE_TYPES=Object.freeze(SHAPES.slice(4).map(shape=>shape.id));
const newShapes=new Set(NEW_SHAPE_TYPES);
export function isGeometryShape(tipo){return newShapes.has(tipo);}

function regularVertices(count){
  return Array.from({length:count},(_,i)=>{
    const angle=-Math.PI/2+i*Math.PI*2/count;
    return [(1+Math.cos(angle))/2,(1+Math.sin(angle))/2];
  });
}
const vertices={
  quadrato:[[0,0],[1,0],[1,1],[0,1]],
  triangolo:[[.5,0],[1,1],[0,1]],
  'triangolo-rettangolo':[[0,0],[1,1],[0,1]],
  rombo:[[.5,0],[1,.5],[.5,1],[0,.5]],
  parallelogramma:[[.25,0],[1,0],[.75,1],[0,1]],
  trapezio:[[.25,0],[.75,0],[1,1],[0,1]],
  pentagono:regularVertices(5),
  esagono:regularVertices(6),
};

export function geometryPaths(element){
  if(!element||!isGeometryShape(element.tipo)||![element.x1,element.y1,element.x2,element.y2].every(Number.isFinite))return [];
  const left=Math.min(element.x1,element.x2),right=Math.max(element.x1,element.x2);
  const top=Math.min(element.y1,element.y2),bottom=Math.max(element.y1,element.y2);
  // Gli estremi restano esatti anche quando la differenza ha un errore floating point.
  const lerp=(a,b,t)=>t===0?a:t===1?b:a+(b-a)*t;
  const at=([x,y])=>({x:lerp(left,right,x),y:lerp(top,bottom,y)});
  let points;
  if(element.tipo==='ellisse'){
    points=Array.from({length:96},(_,i)=>{
      const angle=i*Math.PI*2/96;
      return at([(1+Math.cos(angle))/2,(1+Math.sin(angle))/2]);
    });
  }else points=vertices[element.tipo].map(at);
  return [[...points,{...points[0]}]];
}

function distance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,squared=dx*dx+dy*dy;
  const along=squared?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/squared)):0;
  return Math.hypot(point.x-a.x-along*dx,point.y-a.y-along*dy);
}
export function geometryHitTest(element,point,tolerance=.025){
  if(!point||![point.x,point.y,tolerance].every(Number.isFinite)||tolerance<0)return false;
  return geometryPaths(element).some(path=>path.slice(1).some((p,i)=>distance(point,path[i],p)<=tolerance));
}

// Crea solo il path: stroke, stile e selezione restano al renderer comune.
export function traceGeometry(context,element,width,height){
  const paths=geometryPaths(element);
  if(!paths.length||![width,height].every(n=>Number.isFinite(n)&&n>0))return false;
  context.beginPath();
  for(const path of paths){
    context.moveTo(path[0].x*width,path[0].y*height);
    for(const p of path.slice(1))context.lineTo(p.x*width,p.y*height);
  }
  return true;
}

// Il foglio può essere rettangolare: uguale misura normalizzata non significa quadrato.
export function constrainShapeEnd(tipo,start,end,width,height){
  if(tipo!=='quadrato'||![start?.x,start?.y,end?.x,end?.y,width,height].every(Number.isFinite)||width<=0||height<=0)return {...end};
  const dx=end.x-start.x,dy=end.y-start.y;
  const side=Math.min(Math.abs(dx)*width,Math.abs(dy)*height);
  return {...end,x:start.x+Math.sign(dx)*side/width,y:start.y+Math.sign(dy)*side/height};
}
