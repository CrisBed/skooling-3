import {validateMap} from './mind-map-model.js';

const COLORS=['#166454','#235a97','#714497','#9b4524','#a33257','#655224'];
const normalize=text=>text.replace(/\s+/gu,' ').trim();
const validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=256;

function sourceText(source){
 if(!source||!['book','material'].includes(source.kind)||!validId(source.id)||typeof source.text!=='string'||!source.text.trim()||source.text.length>18000||!/^[a-f\d]{64}$/i.test(source.fingerprint||''))throw Error('Scegli una fonte con testo leggibile, fino a 18000 caratteri. Una foto senza trascrizione non contiene ancora testo da usare.');
 if(typeof source.title!=='string'||!source.title.trim()||source.title.length>180||typeof source.label!=='string'||!source.label.trim()||source.label.length>500)throw Error('Il riferimento della fonte non è valido. Riapri i materiali.');
 let text=source.text;
 if(source.kind==='book'){
  if(!Number.isSafeInteger(source.page)||source.page<1||!text.startsWith(`[Pagina PDF ${source.page}]\n`)||[...text.matchAll(/\[Pagina PDF \d+\]/g)].length!==1)throw Error('Il testo non corrisponde alla pagina PDF selezionata.');
  text=text.slice(text.indexOf('\n')+1);
 }
 text=normalize(text);
 if(text.length<20||(text.match(/[\p{L}\p{N}]+/gu)||[]).length<4)throw Error('Questo brano è troppo breve per preparare una mappa. Scegli un testo con qualche frase, non soltanto il titolo.');
 return text;
}

function unitsFrom(text){
 const sentences=globalThis.Intl?.Segmenter
  ? [...new Intl.Segmenter('it',{granularity:'sentence'}).segment(text)].map(value=>value.segment.trim())
  : (text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu)||[text]).map(value=>value.trim());
 const units=[];
 for(const sentence of sentences){
  let rest=sentence;
  while(rest.length>2600){
   const space=rest.lastIndexOf(' ',2600),cut=space>0?space:2600;
   units.push(rest.slice(0,cut));rest=rest.slice(cut).trim();
  }
  if(rest)units.push(rest);
 }
 return [...new Set(units)];
}

function label(text){
 if(text.length<=120)return text;
 const space=text.lastIndexOf(' ',120);
 return text.slice(0,space>35?space:120);
}

// This is literal local extraction. It neither infers concepts nor creates
// semantic links beyond grouping consecutive source sentences in reading order.
export function buildAutomaticMap({topic,source}={}){
 if(!validId(topic?.id)||typeof topic.titolo!=='string'||!topic.titolo.trim()||topic.titolo.trim().length>120)throw Error('Scegli un argomento con un titolo valido.');
 const text=sourceText(source);
 if(text.replace(/[.!?]+$/u,'').toLocaleLowerCase('it')===normalize(topic.titolo).toLocaleLowerCase('it'))throw Error('Il materiale contiene soltanto il titolo. Scegli un brano con qualche frase.');
 const units=unitsFrom(text),included=units.slice(0,12);
 const nodes=[{id:'centro',parent:null,text:topic.titolo.trim(),color:'#166454',note:source.label}];
 const groupSize=Math.ceil(included.length/Math.min(6,included.length));
 for(let i=0;i<included.length;i+=groupSize){
  const branchId=`idea-${i+1}`,color=COLORS[Math.floor(i/groupSize)%COLORS.length];
  nodes.push({id:branchId,parent:'centro',text:label(included[i]),color,note:included[i]});
  for(let j=i+1;j<Math.min(i+groupSize,included.length);j++)nodes.push({id:`idea-${j+1}`,parent:branchId,text:label(included[j]),color,note:included[j]});
 }
 return {
  method:'estrazione-locale-v1',map:validateMap({versione:1,nodes}),
  source:{kind:source.kind,id:source.id,title:source.title,label:source.label,text:source.text,fingerprint:source.fingerprint,...(source.kind==='book'?{page:source.page}:{})},
  coverage:{included:included.length,available:units.length},
 };
}

// Reopening is not regeneration. In particular, handwritten/user edits to
// branches remain authoritative while the original source stays as provenance.
export function restoreAutomaticMap(material,topic){
 const origin=material?.origineMappa;
 if(material?.tipo!=='mappa'||material.argomento!==topic?.id)throw Error('La mappa non appartiene a questo argomento.');
 if(origin?.versione!==1||origin.metodo!=='estrazione-locale-v1')throw Error('Questa versione della mappa automatica non è riconosciuta.');
 sourceText(origin.fonte);
 const coverage=origin.copertura;
 if(!Number.isSafeInteger(coverage?.included)||coverage.included<1||coverage.included>200||!Number.isSafeInteger(coverage.available)||coverage.available<coverage.included)throw Error('Il riferimento agli estratti della mappa non è leggibile.');
 return {method:origin.metodo,map:validateMap(material.mappa),source:structuredClone(origin.fonte),coverage:structuredClone(coverage)};
}
