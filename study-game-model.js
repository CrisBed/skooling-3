import {validateQuiz} from './studio-model.js';

const normalize=value=>value.normalize('NFC').toLocaleLowerCase('it');
const stops=new Set('anche ancora alcuni alcune altri altre avere essere erano fatto fanno fosse furono insieme mentre molto molti molte nella nelle negli nello della delle degli dello dalla dalle dagli dallo sulla sulle sugli sullo senza sotto sopra prima quale quali quando quanto quanti quante questa queste questi questo quella quelle quelli quello quindi stata state stati stato tutte tutti tutta tutto verso nostro nostra perché perche oppure sempre soltanto durante attraverso proprio spesso vengono viene'.split(' '));
const words=text=>[...text.matchAll(/[\p{L}\p{M}]+/gu)].map(match=>({text:match[0],index:match.index}));
const eligible=text=>words(text).filter(word=>word.text.length>=5&&word.text.length<=35&&!stops.has(normalize(word.text)));

export function demoGameQuestions(){
 const sourceLabel='Demo frazioni · esercizi preparati, non dai tuoi libri';
 return [
  {id:'demo-numerator',prompt:'In 3/4 di pizza, quale numero conta le fette prese?',options:['3','4','7'],correct:0,explanation:'Il 3 è il numeratore: conta le tre parti prese.',quote:'Il numeratore conta le parti prese.'},
  {id:'demo-denominator',prompt:'In 3/4, quale numero dice in quante parti uguali è divisa la pizza?',options:['3','4','1'],correct:1,explanation:'Il 4 è il denominatore: l’intero è diviso in quattro parti uguali.',quote:'Il denominatore indica in quante parti uguali è diviso l’intero.'},
  {id:'demo-half',prompt:'Quale frazione vale quanto metà pizza?',options:['1/4','3/4','2/4'],correct:2,explanation:'Due parti su quattro sono la metà: 2/4 = 1/2.',quote:'Una metà equivale a due quarti.'},
  {id:'demo-whole',prompt:'La pizza ha 4 fette uguali. Le prendi tutte: quale frazione hai preso?',options:['4/4','1/4','2/4'],correct:0,explanation:'Hai preso tutte e quattro le parti: 4/4 è un intero.',quote:'Quando numeratore e denominatore sono uguali, la frazione vale un intero.'},
  {id:'demo-quarter',prompt:'Una pizza ha 4 fette uguali. Ne prendi una: quale frazione descrive la tua fetta?',options:['3/4','1/4','4/4'],correct:1,explanation:'Una parte su quattro si scrive 1/4, cioè un quarto.',quote:'Un quarto indica una parte di un intero diviso in quattro parti uguali.'},
 ].map(q=>({...q,sourceLabel}));
}

export function questionsFromQuiz(material,topic){
 if(!topic?.id||material?.argomento!==topic.id||material.tipo!=='quiz'||material.archiviato===true||material.archived===true)throw Error('Scegli un quiz di questo argomento.');
 const quiz=validateQuiz(material.quiz);
 const questions=quiz.domande.map((q,index)=>{
  if(new Set(q.opzioni.map(value=>normalize(value.trim()))).size!==q.opzioni.length)throw Error('Il quiz contiene risposte uguali: correggilo nei materiali prima di giocare.');
  return{id:`quiz-${material.id}-${index}`,prompt:q.domanda,options:q.opzioni,correct:q.corretta,explanation:q.spiegazione||'Confronta la risposta con la fonte indicata nel quiz.',quote:q.spiegazione||'',sourceLabel:`Quiz salvato: ${material.titolo||'Ripasso'}${q.fonte?' · Fonte dichiarata: '+q.fonte:''}`};
 });
 return questions.slice(0,5);
}

export function questionsFromText(source,topic){
 if(!topic?.id||!['book','material'].includes(source?.kind)||typeof source.text!=='string'||source.text.length>18000||!/^[a-f\d]{64}$/i.test(source.fingerprint||'')||typeof source.label!=='string')throw Error('Scegli una fonte leggibile di questo argomento.');
 let text=source.text;
 if(source.kind==='book'){
  if(!Number.isSafeInteger(source.page)||source.page<1||!text.startsWith(`[Pagina PDF ${source.page}]\n`)||[...text.matchAll(/\[Pagina PDF \d+\]/g)].length!==1)throw Error('La fonte non corrisponde alla pagina del libro scelta.');
  text=text.slice(text.indexOf('\n')+1);
 }
 const quotes=[...new Set((text.match(/[^.!?\n]+(?:[.!?]+|$)/gu)||[]).map(s=>s.trim()))].filter(q=>q.length>=35&&q.length<=400&&words(q).length>=6);
 const bank=eligible(text),questions=[];
 for(const quote of quotes){
  const candidates=eligible(quote),answer=candidates.find(word=>candidates.filter(other=>normalize(other.text)===normalize(word.text)).length===1);
  if(!answer)continue;
  const seen=new Set([normalize(answer.text)]),options=[];
  for(const word of bank){const key=normalize(word.text);if(!seen.has(key)){seen.add(key);options.push(word.text);}if(options.length===2)break;}
  if(options.length<2)continue;
  const correct=questions.length%3;options.splice(correct,0,answer.text);
  questions.push({id:`text-${source.id}-${questions.length}`,prompt:'Quale parola del brano manca?\n'+quote.slice(0,answer.index)+'_____'+quote.slice(answer.index+answer.text.length),options,correct,explanation:quote,quote,sourceLabel:source.label,sourceFingerprint:source.fingerprint,...(source.kind==='book'?{physicalPage:source.page}:{})});
  if(questions.length===5)break;
 }
 if(!questions.length)throw Error('Questo brano non contiene ancora frasi adatte alle domande. Scegli un’altra pagina, un testo più chiaro o un quiz salvato.');
 return questions;
}

function assertQuestions(questions){
 if(!Array.isArray(questions)||!questions.length||questions.length>5)throw Error('La missione richiede da una a cinque domande.');
 const ids=new Set();
 for(const q of questions){
  if(!q||typeof q.id!=='string'||ids.has(q.id)||typeof q.prompt!=='string'||!q.prompt.trim()||q.prompt.length>3500||!Array.isArray(q.options)||q.options.length<2||q.options.length>6||q.options.some(v=>typeof v!=='string'||!v.trim()||v.length>1000)||new Set(q.options.map(v=>normalize(v.trim()))).size!==q.options.length||!Number.isInteger(q.correct)||q.correct<0||q.correct>=q.options.length)throw Error('Le domande della missione non sono valide.');
  ids.add(q.id);
 }
}
export function newGameRun(questions){assertQuestions(questions);return{phase:'arena',questions:structuredClone(questions),index:0,solved:[],feedback:null,attempts:0};}
export function hitTarget(run){if(run.phase!=='arena')throw Error('Il gioco è già fermo su una domanda.');return{...run,phase:'question',feedback:null,attempts:0};}
export function answerQuestion(run,answer){
 if(run.phase!=='question'||run.feedback?.correct)throw Error('Prima colpisci un drone o continua la missione.');
 const q=run.questions[run.index];if(!Number.isInteger(answer)||answer<0||answer>=q.options.length)throw Error('Scegli una risposta.');
 const correct=answer===q.correct;
 return{...run,attempts:run.attempts+1,feedback:{correct,answer,message:correct?q.explanation:'Guarda la fonte e riprova: non perdi la missione.'}};
}
export function resumeArena(run){
 if(run.phase!=='question'||!run.feedback?.correct)throw Error('Completa questa domanda prima di continuare.');
 const index=run.index+1;return{...run,index,solved:[...run.solved,{id:run.questions[run.index].id,attempts:run.attempts}],feedback:null,phase:index===run.questions.length?'complete':'arena'};
}
export function movePilot(x,direction,seconds){return Math.min(.93,Math.max(.07,x+Math.max(-1,Math.min(1,direction))*Math.min(.1,Math.max(0,seconds))*.75));}
export function dronePositions(seconds){return[.22+Math.sin(seconds*.65)*.12,.5+Math.sin(seconds*.7+2)*.11,.78+Math.sin(seconds*.6+4)*.12];}
export function alignedTarget(x,positions){let chosen=-1,distance=.12;positions.forEach((position,index)=>{const delta=Math.abs(position-x);if(delta<distance){distance=delta;chosen=index;}});return chosen;}
