// Guida alle azioni già disponibili. Nessun dato, stato della lezione o rete.
export const TUTOR_DEMO_LABEL='Prova con le frazioni';

export function tutorQuickStartMarkup(){
 return `<section class="tutor-quick-start" data-tutor-quick-start aria-label="Primi passi con il tutor"><h2>Inizia così</h2><ol><li><strong>Apri la prova.</strong> Premi <b>${TUTOR_DEMO_LABEL}</b>: è già pronta.</li><li><strong>Segui un pezzo alla volta.</strong> Leggi e premi <b>Continua</b>. Puoi anche ascoltare o chiedere una spiegazione più semplice.</li><li><strong>Prova e conserva.</strong> Fai il quiz, poi salva la lezione e i materiali di ripasso.</li></ol><p>Per usare un tuo libro o un testo, apri <b>Lezioni e argomenti</b> e scegli <b>Esplora questo argomento</b>.</p></section>`;
}

export function openTutorHelp({inLesson=false,onDemo,onMaterials}={}){
 if(document.querySelector('.tutor-help-dialog[open]'))return;
 const trigger=document.activeElement,dialog=document.createElement('dialog');
 dialog.className='tutor-help-dialog';dialog.setAttribute('aria-label','Come si usa il tutor');
 dialog.innerHTML=`<div class="tutor-help-body"><p class="eyebrow">UN PASSO ALLA VOLTA</p><h2>Come si usa il tutor</h2><ol><li><strong>Scegli da dove iniziare.</strong> Premi <b>${TUTOR_DEMO_LABEL}</b> oppure apri una <b>Lezione salvata</b>.</li><li><strong>Leggi, ascolta e guarda l’esempio.</strong> Premi <b>Continua</b> per passare al pezzo successivo. <b>Ascolta spiegazione</b> avvia la voce; <b>Spiegamelo più semplice</b> accorcia la spiegazione. Se vedi <b>Torna alla spiegazione</b>, stai già leggendo quella semplice.</li><li><strong>Prova tu.</strong> Nel passaggio <b>Mettiti alla prova</b> scegli le risposte e premi <b>Controlla le risposte</b>. Puoi riprovare.</li><li><strong>Porta con te il ripasso.</strong> Nel passaggio <b>Porta con te</b> premi <b>Salva lezione e materiali di ripasso</b>. Ritrovi lezione, riassunto, mappa e schede nello stesso argomento.</li></ol><p>Il passaggio <b>Guarda</b> è facoltativo: se non c’è un video, premi <b>Continua</b>.</p><div class="tutor-help-note"><h3>E i miei libri?</h3><p>Da <b>Lezioni e argomenti</b> apri un argomento e premi <b>Esplora questo argomento</b>. Puoi usare una pagina del libro o un testo già salvato.</p><p>Questo tutor segue lezioni preparate: <b>non è una chat AI</b> per domande libere. La preparazione di nuove lezioni con AI è riservata a un adulto e richiede un servizio attivo.</p></div><p class="small-copy">La voce parte solo quando la chiedi. Dalle 8:30 alle 13:30 resta il silenzio scuola.</p><div class="button-row">${!inLesson&&onDemo?`<button type="button" class="button primary" data-help-demo>${TUTOR_DEMO_LABEL}</button>`:''}${!inLesson&&onMaterials?'<button type="button" class="button secondary" data-help-materials>Apri Lezioni e argomenti</button>':''}<button type="button" class="button secondary" data-help-close>${inLesson?'Torna alla lezione':'Ho capito'}</button></div></div>`;
 const finish=callback=>{dialog.close();callback?.();};
 dialog.querySelector('[data-help-demo]')?.addEventListener('click',()=>finish(onDemo));
 dialog.querySelector('[data-help-materials]')?.addEventListener('click',()=>finish(onMaterials));
 dialog.querySelector('[data-help-close]').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});document.dispatchEvent(new Event('skooling:tutor-help-closed'));});
 document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-help-close]').focus({preventScroll:true});
}
