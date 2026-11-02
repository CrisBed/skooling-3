import {validateQuiz} from './studio-model.js';
import {isTopicAvailable} from './topic-trash-model.js';

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

function quizQuestions(material,topic){
 if(!topic?.id||material?.argomento!==topic.id||material.tipo!=='quiz'||material.archiviato===true||material.archived===true)throw Error('Scegli un quiz di questo argomento.');
 const quiz=validateQuiz(material.quiz);
 const questions=quiz.domande.map((q,index)=>{
  if(new Set(q.opzioni.map(value=>normalize(value.trim()))).size!==q.opzioni.length)throw Error('Il quiz contiene risposte uguali: correggilo nei materiali prima di giocare.');
  return{id:`quiz-${material.id}-${index}`,prompt:q.domanda,options:[...q.opzioni],correct:q.corretta,explanation:q.spiegazione||'Confronta la risposta con la fonte indicata nel quiz.',quote:q.spiegazione||'',sourceLabel:`Quiz salvato: ${material.titolo||'Ripasso'}${q.fonte?' · Fonte dichiarata: '+q.fonte:''}`};
 });
 return questions;
}
export function questionsFromQuiz(material,topic){return quizQuestions(material,topic).slice(0,5);}

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

function assertQuestions(questions,maximum=10){
 if(!Array.isArray(questions)||!questions.length||questions.length>maximum)throw Error(`La missione richiede da una a ${maximum} domande.`);
 const ids=new Set();
 for(const q of questions){
  if(!q||typeof q.id!=='string'||ids.has(q.id)||typeof q.prompt!=='string'||!q.prompt.trim()||q.prompt.length>3500||!Array.isArray(q.options)||q.options.length<2||q.options.length>6||q.options.some(v=>typeof v!=='string'||!v.trim()||v.length>1000)||new Set(q.options.map(v=>normalize(v.trim()))).size!==q.options.length||!Number.isInteger(q.correct)||q.correct<0||q.correct>=q.options.length)throw Error('Le domande della missione non sono valide.');
  ids.add(q.id);
 }
}

const validIdentity=value=>typeof value==='string'&&value.trim().length>0&&value.length<=256;
function checkedBank(questions){assertQuestions(questions,80);return questions;}

// The controller attests topicId only after loadMissionSource has resolved the
// actual saved topic and source in the active profile. Never infer ownership
// from a title, a file name or a page number.
export function gameQuestionBank(input,topic){
 if(!isTopicAvailable(topic))throw Error('Scegli un argomento disponibile prima di preparare le domande.');
 if(input?.tipo==='quiz'){
  if(!validIdentity(input.id))throw Error('Il quiz non ha un identificativo valido. Riaprilo nei materiali.');
  const seen=new Set(),questions=quizQuestions(input,topic).filter(question=>{const key=normalize(question.prompt.trim());if(seen.has(key))return false;seen.add(key);return true;});
  return checkedBank(questions.slice(0,80));
 }
 if(!validIdentity(input?.id)||input.topicId!==topic.id||input.archiviato===true||input.archived===true||!['book','material'].includes(input.kind)||typeof input.text!=='string'||!input.text.trim()||input.text.length>18000||typeof input.label!=='string'||!input.label.trim()||!/^[a-f\d]{64}$/i.test(input.fingerprint||''))throw Error('Scegli una fonte leggibile e verificata di questo argomento.');
 let text=input.text;
 if(input.kind==='book'){
  if(topic.libro!==input.id||!Number.isSafeInteger(input.page)||input.page<1||!text.startsWith(`[Pagina PDF ${input.page}]\n`)||[...text.matchAll(/\[Pagina PDF \d+\]/g)].length!==1)throw Error('La fonte non corrisponde alla pagina del libro collegato.');
  text=text.slice(text.indexOf('\n')+1);
 }
 const quotes=[...new Set((text.match(/[^.!?\n]+(?:[.!?]+|$)/gu)||[]).map(quote=>quote.trim()))].filter(quote=>quote.length>=35&&quote.length<=400&&words(quote).length>=6&&!quote.includes('_____'));
 const candidates=quotes.map(quote=>{const all=eligible(quote);return all.filter(word=>all.filter(other=>normalize(other.text)===normalize(word.text)).length===1);});
 const bank=eligible(text),questions=[];
 // Visit each sentence before taking its next word, so a long sentence cannot
 // monopolize the entire pool. Every missing word and alternative is literal.
 for(let round=0;round<80&&questions.length<80;round++){
  let found=false;
  for(let index=0;index<quotes.length&&questions.length<80;index++){
   const answer=candidates[index][round];if(!answer)continue;found=true;
   const seen=new Set([normalize(answer.text)]),options=[];
   for(let step=0;step<bank.length;step++){
    const word=bank[(step+index+round)%bank.length],key=normalize(word.text);
    if(!seen.has(key)){seen.add(key);options.push(word.text);}if(options.length===2)break;
   }
   if(options.length<2)continue;
   const quote=quotes[index],correct=questions.length%3;options.splice(correct,0,answer.text);
   questions.push({id:`bank-text-${input.kind}-${input.id}-${input.fingerprint.toLowerCase()}-${index}-${answer.index}`,prompt:'Quale parola del brano manca?\n'+quote.slice(0,answer.index)+'_____'+quote.slice(answer.index+answer.text.length),options,correct,explanation:quote,quote,sourceLabel:input.label,sourceFingerprint:input.fingerprint,...(input.kind==='book'?{physicalPage:input.page}:{})});
  }
  if(!found)break;
 }
 if(!questions.length)throw Error('Questo brano non contiene frasi adatte alle domande. Scegli un’altra pagina, un testo più chiaro o un quiz salvato.');
 return checkedBank(questions);
}

function fractionQuestion(question,numerator,denominator){
 const matching=[];
 question.options.forEach((option,index)=>{const parts=/^(\d+)\/([1-9]\d*)$/.exec(option);if(!parts)throw Error('Una domanda preparata sulle frazioni non è valida.');if(Number(parts[1])*denominator===numerator*Number(parts[2]))matching.push(index);});
 if(matching.length!==1)throw Error('Una domanda preparata deve avere una sola risposta corretta.');
 return{...question,correct:matching[0],quote:question.explanation,sourceLabel:'Demo frazioni · esercizi preparati, non dai tuoi libri'};
}
export function demoGameQuestionBank(){
 const questions=demoGameQuestions();
 for(const denominator of[3,5,6,8,10,12]){
  const numerator=Math.floor(denominator/2),twice=denominator*2;
  questions.push(fractionQuestion({id:`demo-parts-${denominator}`,prompt:`Un intero è diviso in ${denominator} parti uguali. Ne prendi ${numerator}. Quale frazione hai?`,options:[`${numerator}/${denominator}`,`${numerator+1}/${denominator}`,`${numerator}/${denominator+1}`],explanation:`Hai preso ${numerator} parti delle ${denominator} parti uguali: ${numerator}/${denominator}.`},numerator,denominator));
  questions.push(fractionQuestion({id:`demo-equivalent-${denominator}`,prompt:`Quale frazione equivale a ${numerator}/${denominator}?`,options:[`${numerator*2}/${twice}`,`${numerator*2+1}/${twice}`,`${numerator*2}/${twice+1}`],explanation:`Moltiplicando numeratore e denominatore per 2, il valore resta uguale: ${numerator}/${denominator} = ${numerator*2}/${twice}.`},numerator,denominator));
  questions.push(fractionQuestion({id:`demo-sum-${denominator}`,prompt:`Quanto fa 1/${denominator} + 1/${denominator}?`,options:[`2/${denominator}`,`1/${denominator}`,`3/${denominator}`],explanation:`Le parti hanno la stessa grandezza. Somma i numeratori e conserva il denominatore: 1/${denominator} + 1/${denominator} = 2/${denominator}.`},2,denominator));
  questions.push(fractionQuestion({id:`demo-difference-${denominator}`,prompt:`Quanto fa ${denominator-1}/${denominator} − 1/${denominator}?`,options:[`${denominator-2}/${denominator}`,`${denominator-1}/${denominator}`,`${denominator}/${denominator}`],explanation:`Le parti hanno la stessa grandezza. Sottrai i numeratori e conserva il denominatore: ${denominator-1}/${denominator} − 1/${denominator} = ${denominator-2}/${denominator}.`},denominator-2,denominator));
  questions.push(fractionQuestion({id:`demo-missing-${denominator}`,prompt:`Hai ${numerator}/${denominator} di un intero. Quale frazione manca per arrivare a un intero?`,options:[`${denominator-numerator}/${denominator}`,`${denominator-numerator+1}/${denominator}`,`${denominator-numerator-1}/${denominator}`],explanation:`Un intero vale ${denominator}/${denominator}. Mancano ${denominator-numerator} parti: ${denominator}/${denominator} − ${numerator}/${denominator} = ${denominator-numerator}/${denominator}.`},denominator-numerator,denominator));
 }
 return checkedBank(questions);
}

function shuffle(values,random){
 for(let index=values.length-1;index>0;index--){const value=random();if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=1)throw Error('Non riesco a scegliere domande diverse. Riprova.');const target=Math.floor(value*(index+1));[values[index],values[target]]=[values[target],values[index]];}
 return values;
}
export function selectGameQuestions(pool,{count=5,previousIds=[],random=Math.random}={}){
 assertQuestions(pool,80);
 if(!Number.isSafeInteger(count)||count<1||count>80)throw Error('Scegli un numero intero di domande da 1 a 80.');
 if(count>pool.length)throw Error(`Questa fonte contiene ${pool.length} domande diverse; ne hai chieste ${count}. Scegli meno domande o un’altra fonte.`);
 if(!Array.isArray(previousIds)||previousIds.some(id=>typeof id!=='string')||typeof random!=='function')throw Error('La scelta delle domande precedenti non è valida.');
 const previous=new Set(previousIds),fresh=shuffle(pool.filter(question=>!previous.has(question.id)),random),repeated=shuffle(pool.filter(question=>previous.has(question.id)),random);
 return[...fresh,...repeated].slice(0,count).map(question=>{
  const options=shuffle(question.options.map((value,index)=>({value,correct:index===question.correct})),random),copy=structuredClone(question);
  copy.options=options.map(option=>option.value);copy.correct=options.findIndex(option=>option.correct);return copy;
 });
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
