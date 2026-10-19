import {createNumbering,printedToPhysical,physicalLabel} from './book-pages.js';
// Lettore PDF basato sulla copia locale di PDF.js.
import * as pdfjsLib from './vendor/pdf.mjs';
import { DB } from './db.js';
import { DrawingSurface, SurfaceGroup, attachToolbox, creaGestoCondiviso, creaRilevatoreSwipe, ditaAppoggiate, risoluzioneAmmessa } from './strumenti.js';
import { rettangoliDaEvidenziare } from './ricerca.js';
import { paginaSinistraLibro, paginaDestraLibro, coppiaPrecedenteLibro, coppiaSuccessivaLibro } from './pagine.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';

// Dove PDF.js va a prendere i suoi decodificatori WebAssembly. Non e' un
// dettaglio: dalla versione 6 il decodificatore di CCITTFax e di JBIG2 non e'
// piu' scritto in JavaScript, sta dentro vendor/jbig2.wasm. Senza questa riga
// PDF.js non trova il modulo, non riesce a decodificare quelle immagini e le
// SALTA IN SILENZIO, lasciando il bianco al loro posto: e' esattamente il
// difetto visto sui libri passati nel CZUR, dove ogni pagina e' una scansione
// di fondo piu' un livello in primo piano ritagliato da una maschera CCITT.
// La cartella finisce con la barra: PDF.js ci attacca dietro il nome del file.
const WASM_PDFJS = './vendor/';

function waitFrame() { return new Promise((resolve) => requestAnimationFrame(resolve)); }

export async function extractPdfCover(blob) {
  const task = pdfjsLib.getDocument({ data: await blob.arrayBuffer(), wasmUrl: WASM_PDFJS });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, 360 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  } finally {
    await task.destroy();
  }
}

class Reader {
  constructor() {
    this.root = document.querySelector('#lettore-pdf');
    this.pagesBox = document.querySelector('#pdf-pages');
    this.canvas = document.querySelector('#pdf-canvas');
    this.canvas2 = document.querySelector('#pdf-canvas-2');
    this.annotationCanvas = document.querySelector('#pdf-annotations');
    this.annotationCanvas2 = document.querySelector('#pdf-annotations-2');
    this.pageWrap = document.querySelector('#pdf-page-wrap');
    this.pageWrap2 = document.querySelector('#pdf-page-wrap-2');
    this.scroll = document.querySelector('#pdf-scroll');
    this.loading = document.querySelector('#reader-loading');
    this.pageNumberInput = document.querySelector('#page-number');
    this.pdf = null;
    // Il documento da solo non si sa chiudere: in PDF.js il metodo per liberare
    // la memoria sta sul compito di caricamento, non sul documento. Va tenuto,
    // altrimenti ogni libro aperto lascia dietro un worker e una copia intera
    // del PDF che nessuno libera piu'.
    this.caricamento = null;
    // Numero dell'apertura in corso: serve a far ritirare quelle sorpassate.
    this.sessione = 0;
    this.book = null;
    this.pageNumber = 1;
    this.doppia = false;
    this.zoom = 1;
    this.renderTask = null;
    this.renderTask2 = null;
    this.thumbnailObserver = null;
    this.pinch = null;
    this.lastTap = 0;
    this.ultimoTocco = 0;
    this.annotationSaveToken = 0;
    this.annotationSaveToken2 = 0;
    // Un disegno di pagina alla volta. PDF.js rifiuta due render sullo stesso
    // canvas, quindi ogni richiesta aspetta che la precedente abbia finito di
    // liberarlo; il numero dice quale richiesta è l'ultima arrivata.
    this.renderCorsa = 0;
    this.renderInCoda = Promise.resolve();
    // Sfioramento orizzontale: cambia pagina senza toccare i pulsanti.
    this.swipe = creaRilevatoreSwipe();
    // Il foglio non lo scorre più il browser: lo scorre l'app, così la penna
    // può scrivere senza che la pagina le scappi sotto.
    this.ultimoPunto = null;
    // La parola arrivata dalla ricerca: si segna in giallo sulla pagina finché
    // non si cambia libro.
    this.evidenzia = '';
    this.schermoPieno = false;
    this.astuccioAperto = false;
    // Un solo gesto per le due pagine: le due dita possono cadere su fogli diversi.
    const gesto = creaGestoCondiviso();
    const gestoTocco = (phase, event, touches) => this.handleTouchGesture(phase, event, touches);
    this.drawing = new DrawingSurface(this.annotationCanvas, {
      gesto,
      onChange: (elements) => this.saveAnnotations(0, elements),
      onTouchGesture: gestoTocco,
    });
    this.drawing2 = new DrawingSurface(this.annotationCanvas2, {
      gesto,
      onChange: (elements) => this.saveAnnotations(1, elements),
      onTouchGesture: gestoTocco,
    });
    // Un unico astuccio comanda tutte e due le pagine, come nei quaderni.
    this.group = new SurfaceGroup([this.drawing, this.drawing2]);
    attachToolbox(document.querySelector('#reader-tools'), this.group);
    this.bind();
  }

  // Il dito disegna oppure scorre: la scelta vale per tutte e due le pagine.
  setDrawWithFinger(value) {
    this.group.setDrawWithFinger(value);
  }

  bind() {
    document.querySelector('#close-reader').addEventListener('click', () => this.close());
    document.querySelector('#focus-left-page').addEventListener('click', () => this.focusPage(0));
    document.querySelector('#focus-right-page').addEventListener('click', () => this.focusPage(1));
    document.querySelector('#prev-page').addEventListener('click', () => this.goTo(this.indietro()));
    document.querySelector('#next-page').addEventListener('click', () => this.goTo(this.avanti()));
    document.querySelector('#reader-two-pages').addEventListener('click', () => this.toggleDoppia());
    const jump=()=>this.goToPrinted(this.pageNumberInput.value).catch(error=>{this.updatePageNumbers();document.dispatchEvent(new CustomEvent('skooling:message',{detail:{text:error.message,error:true}}));});
    this.pageNumberInput.addEventListener('change',jump);
    this.pageNumberInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jump();}});
    document.querySelector('#align-book-pages').addEventListener('click',()=>this.alignPageNumbers());
    document.querySelector('#fit-page').addEventListener('click', () => this.setZoom(1));
    document.querySelector('#toggle-thumbnails').addEventListener('click', (event) => {
      const panel = document.querySelector('#thumbnail-panel');
      panel.hidden = !panel.hidden;
      event.currentTarget.classList.toggle('active', !panel.hidden);
      if (!panel.hidden) this.observeThumbnails();
    });
    document.querySelector('#toggle-reader-tools').addEventListener('click', (event) => {
      const tools = document.querySelector('#reader-tools');
      tools.hidden = !tools.hidden;
      event.currentTarget.classList.toggle('active', !tools.hidden);
    });
    document.querySelector('#toggle-night').addEventListener('click', (event) => {
      const notte = !this.pageWrap.classList.contains('night');
      this.pageWrap.classList.toggle('night', notte);
      this.pageWrap2.classList.toggle('night', notte);
      event.currentTarget.classList.toggle('active', notte);
    });
    document.querySelector('#toggle-bookmark').addEventListener('click', () => this.toggleBookmark());
    document.querySelector('#toggle-bookmark-list').addEventListener('click', (event) => {
      const pannello = document.querySelector('#bookmark-panel');
      pannello.hidden = !pannello.hidden;
      event.currentTarget.classList.toggle('active', !pannello.hidden);
      if (!pannello.hidden) this.mostraSegnalibri();
    });
    document.querySelector('#bookmark-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.salvaSegnalibro();
    });
    document.querySelector('#reader-fullscreen').addEventListener('click', () => this.setSchermoPieno(!this.schermoPieno));
    document.querySelector('#reader-exit-fullscreen').addEventListener('click', () => this.setSchermoPieno(false));
    // Col mouse il doppio clic riporta la pagina alla misura naturale. Sul
    // tocco ci pensa già il doppio tocco: qui il doppio clic arriverebbe
    // subito dopo e chiederebbe lo stesso ingrandimento una seconda volta.
    this.scroll.addEventListener('dblclick', () => {
      if (Date.now() - this.ultimoTocco < 700) return;
      this.setZoom(1);
    });
    window.addEventListener('keydown', (event) => {
      if (this.root.hidden) return;
      if (event.key === 'ArrowLeft') this.goTo(this.indietro());
      if (event.key === 'ArrowRight') this.goTo(this.avanti());
    });
    let resizeTimer;
    window.addEventListener('resize', () => {
      if (this.root.hidden || !this.pdf) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.renderPage(), 180);
    });
  }

  async open(bookId, page, evidenzia = '') {
    // Ogni apertura e ogni chiusura hanno il loro numero. Se mentre questa
    // apertura lavora ne arriva un'altra, o una chiusura, questa si ferma senza
    // toccare più niente: lo schermo appartiene all'ultima arrivata.
    const sessione = ++this.sessione;
    const libro = await DB.get('libri', bookId);
    if (sessione !== this.sessione) return;
    if (!libro) throw new Error('Questo libro non è più nella libreria.');
    // Il segnaposto sta a parte; i libri di prima ce l'hanno ancora dentro.
    const lettura = await DB.get('letture', bookId);
    if (sessione !== this.sessione) return;
    libro.ultimaPagina = lettura?.pagina || libro.ultimaPagina || 1;
    // Chi c'era prima se ne va, anche passando da un libro all'altro senza
    // chiudere: il vecchio compito si chiude in sottofondo, senza far aspettare.
    const precedente = this.staccaDocumento();
    if (precedente) precedente.destroy().catch(() => {});
    this.book = libro;
    this.evidenzia = String(evidenzia || '');
    this.root.hidden = false;
    document.body.classList.add('workspace-open');
    document.querySelector('#reader-title').textContent = this.book.titolo;
    document.querySelector('#reader-subject').textContent = this.book.materia;
    this.loading.hidden = false;
    try {
      const task = pdfjsLib.getDocument({ data: await libro.blob.arrayBuffer(), wasmUrl: WASM_PDFJS });
      const documento = await task.promise;
      if (sessione !== this.sessione) { await task.destroy().catch(() => {}); return; }
      this.caricamento = task;
      this.pdf = documento;
      const savedNumbers=await DB.get('impostazioni','book-numbering-'+libro.id);
      const labels=await documento.getPageLabels().catch(()=>null);
      if(sessione!==this.sessione)return;
      try{this.numbering=createNumbering(labels,documento.numPages,savedNumbers?.valore||null);}catch{this.numbering=createNumbering(labels,documento.numPages);}
      this.requestedPageNumber=null;
      this.pageNumber = this.allinea(Math.max(1, Math.min(Number(page || this.book.ultimaPagina || 1), this.pdf.numPages)));
      this.pageNumberInput.removeAttribute('max');
      document.querySelector('#page-total').textContent = `di ${this.pdf.numPages}`;
      this.buildThumbnails();
      await this.renderPage();
    } catch (error) {
      if (sessione !== this.sessione) return; // sorpassata: non è un guasto
      await this.close();
      throw new Error('Non riesco ad aprire questo PDF. Prova a importarlo di nuovo.');
    } finally {
      if (sessione === this.sessione) this.loading.hidden = true;
    }
  }

  // Stacca il documento aperto e restituisce il compito di caricamento da
  // chiudere. Non aspetta niente: chiudere un libro da centinaia di megabyte
  // richiede tempo, e in quel tempo chi riapre non deve trovare le cose a metà.
  staccaDocumento() {
    this.renderTask?.cancel?.();
    this.renderTask2?.cancel?.();
    this.renderTask = null;
    this.renderTask2 = null;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    const task = this.caricamento;
    this.caricamento = null;
    this.pdf = null;
    return task;
  }

  // Chiude il libro. TUTTO quello che tocca lo stato si fa PRIMA di qualsiasi
  // attesa: se si aspettasse prima, chi nel frattempo ha già riaperto un libro
  // se lo vedrebbe azzerare sotto le mani a chiusura finita. È esattamente
  // quello che succedeva uscendo e rientrando di fretta da un libro pesante.
  async close() {
    this.sessione += 1;
    const task = this.staccaDocumento();
    this.book = null;
    this.drawing.setElements([]);
    this.drawing2.setElements([]);
    this.pageWrap2.hidden = true;
    this.pagesBox.style.transform = '';
    // Il libro successivo si apre con le barre in vista: chi riapre deve
    // ritrovare il pulsante per chiudere, non una pagina senza comandi.
    this.setSchermoPieno(false);
    this.swipe.annulla();
    this.evidenzia = '';
    const pannello = document.querySelector('#bookmark-panel');
    pannello.hidden = true;
    document.querySelector('#toggle-bookmark-list').classList.remove('active');
    this.root.hidden = true;
    document.body.classList.remove('workspace-open');
    document.dispatchEvent(new CustomEvent('skooling:reader-closed'));
    // L'attesa viene per ultima: la memoria si libera mentre l'app va avanti.
    if (task) await task.destroy().catch(() => {});
  }

  // A due pagine la copertina sta da sola e le coppie sono 2-3, 4-5, 6-7: il
  // passo quindi non e' costante, e lo decidono le funzioni di pagine.js.
  indietro() { return this.doppia ? coppiaPrecedenteLibro(this.pageNumber) : this.pageNumber - 1; }

  avanti() { return this.doppia ? coppiaSuccessivaLibro(this.pageNumber, this.pdf?.numPages ?? 1) : this.pageNumber + 1; }

  // La pagina di sinistra della coppia in cui cade `numero`. A pagina singola
  // non si accoppia niente e il numero resta quello chiesto.
  allinea(numero) { return this.doppia ? paginaSinistraLibro(numero) : numero; }

  // La pagina di destra, oppure null quando quella di sinistra sta da sola.
  destra() { return this.doppia ? paginaDestraLibro(this.pageNumber, this.pdf.numPages) : null; }

  async goToPrinted(value){
    if(!this.pdf)return;
    const physical=printedToPhysical(value,this.numbering);
    await this.goTo(physical,{printedTarget:physical});
  }

  updatePageNumbers(){
    if(!this.pdf||!this.numbering)return;
    const focus=[this.pageNumber,this.destra()].includes(this.requestedPageNumber)?this.requestedPageNumber:this.pageNumber;
    this.pageNumberInput.value=physicalLabel(focus,this.numbering);
    const last=physicalLabel(this.pdf.numPages,this.numbering);
    document.querySelector('#page-total').textContent=this.numbering.known?(last?'di '+last:''):`Foglio PDF ${this.pageNumber} di ${this.pdf.numPages} · allinea i numeri`;
  }

  alignPageNumbers(){
    if(!this.pdf)return;
    const session=this.sessione,bookId=this.book.id,physical=this.pageNumber;
    const d=document.createElement('dialog');d.innerHTML=`<form class="dialog-form"><h2>Allinea le pagine del libro</h2><p>Guarda la pagina ${this.doppia?'a sinistra':'aperta'}. Quale numero leggi stampato sul libro?</p><label>Numero stampato<input name="printed" type="number" min="1" step="1" required inputmode="numeric"></label><p class="small-copy">Se è una copertina, chiudi e usa le frecce per raggiungere una pagina numerata. Questa corrispondenza viene ricordata solo per questo libro; scritte e appunti restano dove sono.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-close>Annulla</button><button class="button primary">Salva corrispondenza</button></div></form>`;
    d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();d.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=d.querySelector('.primary');button.disabled=true;try{if(session!==this.sessione)throw Error('Il libro è cambiato. Riapri l’allineamento.');const anchor={physical,printed:Number(new FormData(event.target).get('printed'))},numbering=createNumbering(null,this.pdf.numPages,anchor);await DB.put('impostazioni',{id:'book-numbering-'+bookId,valore:anchor});if(session===this.sessione){this.numbering=numbering;this.requestedPageNumber=null;this.updatePageNumbers();this.buildThumbnails();}d.close();}catch(error){d.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};document.body.append(d);d.showModal();
  }

  async goTo(number,{printedTarget=null}={}) {
    if (!this.pdf) return;
    this.requestedPageNumber=printedTarget;
    const next = this.allinea(Math.max(1, Math.min(this.pdf.numPages, Math.round(number || 1))));
    if (next === this.pageNumber && this.canvas.width) {
      // Già su questa coppia: il campo torna a mostrare la pagina di sinistra.
      this.updatePageNumbers();
      return;
    }
    this.pageNumber = next;
    this.zoom = 1;
    await this.renderPage();
  }

  focusPage(offset) {
    const wrap = offset ? this.pageWrap2 : this.pageWrap;
    if (wrap.hidden || !this.pdf) return;
    const page = wrap.getBoundingClientRect();
    const viewport = this.scroll.getBoundingClientRect();
    this.scroll.scrollTo({ left: this.scroll.scrollLeft + page.left - viewport.left - 8, top: this.scroll.scrollTop });
  }

  async toggleDoppia() {
    this.doppia = !this.doppia;
    const button = document.querySelector('#reader-two-pages');
    button.textContent = this.doppia ? '1 pagina' : '2 pagine';
    button.setAttribute('aria-pressed', String(this.doppia));
    button.classList.toggle('active', this.doppia);
    this.pageNumber = this.allinea(this.pageNumber);
    this.zoom = 1;
    if (this.pdf) await this.renderPage();
  }

  // Disegna una delle due pagine: il PDF sotto, le annotazioni sopra.
  async renderOne(offset, numero, available, annotations) {
    const canvas = offset ? this.canvas2 : this.canvas;
    const wrap = offset ? this.pageWrap2 : this.pageWrap;
    const surface = offset ? this.drawing2 : this.drawing;
    const page = await this.pdf.getPage(numero);
    // Il numero della pagina davvero disegnata su questo foglio: si legge da
    // fuori, ed e' cosi' che si prova la sequenza delle coppie nel browser.
    wrap.dataset.pagina = String(numero);
    const base = page.getViewport({ scale: 1 });
    // Quanto grande si vede il foglio: questo non cambia mai.
    const cssWidth = available * this.zoom;
    const cssHeight = cssWidth * (base.height / base.width);
    // Quanti pixel veri si spendono per disegnarlo: qui invece si sta sotto al
    // tetto, altrimenti a ingrandimento alto la tela diventa ingestibile.
    const ratio = risoluzioneAmmessa(cssWidth, cssHeight, Math.min(2, devicePixelRatio || 1));
    const viewport = page.getViewport({ scale: (cssWidth * ratio) / base.width });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    wrap.style.width = `${cssWidth}px`;
    wrap.style.height = `${cssHeight}px`;
    const contesto = canvas.getContext('2d');
    const task = page.render({ canvasContext: contesto, viewport });
    if (offset) this.renderTask2 = task; else this.renderTask = task;
    await task.promise;
    await this.segnaParolaCercata(page, contesto, viewport);
    surface.setElements(annotations.filter((item) => item.idLibro === this.book.id && item.pagina === numero));
  }

  // Disegna la pagina corrente. Le chiamate si mettono in fila una dietro
  // l'altra: cambiare pagina, ingrandire e ruotare l'iPad possono arrivare a
  // pochi millisecondi di distanza, e due render sovrapposti sullo stesso
  // canvas facevano scattare un avviso di errore anche quando la pagina si
  // vedeva benissimo. Se nel frattempo è arrivata una richiesta più nuova,
  // questa si ferma in silenzio: a disegnare ci pensa l'ultima.
  // Segna in giallo la parola arrivata dalla ricerca. Si disegna sopra la
  // pagina, sotto alle annotazioni: così resta visibile ma non copre i segni.
  async segnaParolaCercata(page, contesto, viewport) {
    if (!this.evidenzia) return;
    try {
      const contenuto = await page.getTextContent();
      const rettangoli = rettangoliDaEvidenziare(contenuto, viewport, this.evidenzia);
      if (!rettangoli.length) return;
      contesto.save();
      contesto.fillStyle = 'rgba(255, 214, 51, 0.42)';
      for (const area of rettangoli) contesto.fillRect(area.x, area.y, area.larghezza, area.altezza);
      contesto.restore();
    } catch {
      // Una pagina senza testo non si evidenzia: si mostra e basta.
    }
  }

  async renderPage({ mantieniPosizione = false } = {}) {
    if (!this.pdf) return;
    const corsa = ++this.renderCorsa;
    this.loading.hidden = false;
    this.renderTask?.cancel?.();
    this.renderTask2?.cancel?.();
    const precedente = this.renderInCoda;
    let liberaLaCoda;
    this.renderInCoda = new Promise((resolve) => { liberaLaCoda = resolve; });
    await precedente;
    if (corsa !== this.renderCorsa || !this.pdf) { liberaLaCoda(); return; }
    try {
      const destra = this.destra();
      this.pageWrap2.hidden = !destra;
      document.querySelector('#focus-left-page').hidden = !destra;
      document.querySelector('#focus-right-page').hidden = !destra;
      // Foglio nascosto: via anche il numero, altrimenti resta appeso quello
      // della coppia di prima e chi lo legge da fuori si sbaglia.
      if (!destra) delete this.pageWrap2.dataset.pagina;
      // Con due pagine la larghezza si divide, meno lo spazio tra i due fogli.
      const available = destra
        ? Math.max(200, (this.scroll.clientWidth - 56 - 18) / 2)
        : Math.max(280, this.scroll.clientWidth - 56);
      this.pagesBox.style.transform = '';
      const annotations = await DB.getAll('annotazioni');
      await this.renderOne(0, this.pageNumber, available, annotations);
      if (destra) await this.renderOne(1, destra, available, annotations);
      else this.drawing2.setElements([]);
      this.setDrawWithFinger(this.drawing.drawWithFinger);
      this.updatePageNumbers();
      document.querySelector('#zoom-label').textContent = `${Math.round(this.zoom * 100)}%`;
      this.updateThumbnailSelection();
      // Solo il segnaposto, non tutto il libro: vedi il commento su `letture`.
      await DB.put('letture', { id: this.book.id, pagina: this.pageNumber, data: Date.now() });
      this.book.ultimaPagina = this.pageNumber;
      this.updateBookmarkButton();
      this.mostraSegnalibri();
      // Le pagine attaccate alla coppia aperta: quella prima della sinistra e
      // quella dopo la destra, che in doppia pagina non e' sempre a due passi.
      for (const nearby of [this.pageNumber - 1, (destra ?? this.pageNumber) + 1]) {
        if (nearby >= 1 && nearby <= this.pdf.numPages) this.pdf.getPage(nearby).catch(() => {});
      }
      // Cambiando pagina si riparte dall'alto. Ingrandendo no: si resta dove si
      // stava guardando, altrimenti dopo ogni pizzico si finisce in cima al
      // foglio e bisogna ritrovare il punto col dito.
      if (!mantieniPosizione) this.scroll.scrollTo({ top: 0, left: 0 });
    } catch (error) {
      // Si avvisa solo per un guasto vero dell'ultima richiesta: un render
      // annullato o sorpassato da uno più nuovo non è un errore da mostrare.
      const sorpassato = corsa !== this.renderCorsa || error?.name === 'RenderingCancelledException';
      if (!sorpassato) {
        document.dispatchEvent(new CustomEvent('skooling:message', { detail: { text: 'La pagina non si è caricata. Riprova.', error: true } }));
      }
    } finally {
      if (corsa === this.renderCorsa) this.loading.hidden = true;
      liberaLaCoda();
    }
  }

  // Ingrandisce la pagina tenendo fermo un punto.
  //
  // Servono DUE punti, non uno: `contenuto` è il punto del foglio che si vuole
  // tenere (quello che le dita hanno toccato quando il pizzico è cominciato) e
  // `schermo` è il posto dove deve finire (dove le dita sono arrivate). Sono lo
  // stesso punto solo se le dita non si sono spostate mentre si allargavano,
  // che nell'uso vero non succede quasi mai: usarne uno solo faceva scappare il
  // foglio di centinaia di pixel.
  async setZoom(value, ancora = null) {
    const prossimo = Math.max(0.75, Math.min(3.5, value));
    // Ingrandimento identico a quello di adesso: non c'è nulla da ridisegnare.
    if (Math.abs(prossimo - this.zoom) < 0.005) {
      this.azzeraAnteprima();
      return;
    }
    const riquadroScorrevole = this.scroll.getBoundingClientRect();
    const centroVisibile = {
      x: riquadroScorrevole.left + this.scroll.clientWidth / 2,
      y: riquadroScorrevole.top + this.scroll.clientHeight / 2,
    };
    const contenuto = ancora?.contenuto || ancora || centroVisibile;
    const schermo = ancora?.schermo || ancora || centroVisibile;

    // Dove cade il punto sul foglio, in frazioni di foglio: è l'unica misura
    // che resta valida anche dopo che il foglio ha cambiato dimensione.
    const foglio = this.pageWrap.getBoundingClientRect();
    const quotaX = foglio.width ? (contenuto.x - foglio.left) / foglio.width : 0.5;
    const quotaY = foglio.height ? (contenuto.y - foglio.top) / foglio.height : 0.5;

    this.zoom = prossimo;
    await this.renderPage({ mantieniPosizione: true });
    this.riportaSotto(quotaX, quotaY, schermo);
  }

  // Rimette sotto il punto indicato la stessa frazione di foglio che c'era
  // prima di ingrandire.
  riportaSotto(quotaX, quotaY, fermo) {
    const nuovo = this.pageWrap.getBoundingClientRect();
    if (!nuovo.width || !nuovo.height) return;
    this.scroll.scrollLeft += (nuovo.left + quotaX * nuovo.width) - fermo.x;
    this.scroll.scrollTop += (nuovo.top + quotaY * nuovo.height) - fermo.y;
  }

  azzeraAnteprima() {
    this.pagesBox.style.transform = '';
    this.pagesBox.style.transformOrigin = '';
  }

  handleTouchGesture(phase, event, touches) {
    const dita = ditaAppoggiate(touches);
    if (phase === 'start') {
      this.swipe.inizio(touches);
      this.ultimoPunto = null;
      if (dita.length === 2) {
        const [a, b] = dita;
        // Il riquadro dei fogli senza trasformazione: è il riferimento da cui
        // si calcola l'anteprima mentre le dita si muovono.
        this.azzeraAnteprima();
        const riquadro = this.pagesBox.getBoundingClientRect();
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          zoom: this.zoom,
          preview: this.zoom,
          origine: { x: riquadro.left, y: riquadro.top },
          partenza: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          centro: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      }
      return;
    }
    if (phase === 'move') {
      this.swipe.muovi(touches);
      if (this.pinch && dita.length >= 2) {
        const [a, b] = dita;
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.pinch.preview = Math.max(0.75, Math.min(3.5, this.pinch.zoom * distance / this.pinch.distance));
        this.pinch.centro = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // Il foglio cresce da sotto le dita e le segue: il punto toccato
        // all'inizio resta sotto le dita anche mentre si allargano e si
        // spostano. È una sola trasformazione, la fa la scheda grafica.
        const rapporto = this.pinch.preview / this.zoom;
        const spostaX = this.pinch.centro.x - this.pinch.origine.x - rapporto * (this.pinch.partenza.x - this.pinch.origine.x);
        const spostaY = this.pinch.centro.y - this.pinch.origine.y - rapporto * (this.pinch.partenza.y - this.pinch.origine.y);
        this.pagesBox.style.transformOrigin = '0 0';
        this.pagesBox.style.transform = `translate(${spostaX}px, ${spostaY}px) scale(${rapporto})`;
        return;
      }
      if (touches.size === 1) this.scorriFoglio(touches);
      return;
    }
    if (phase !== 'end') return;
    this.ultimoPunto = null;
    if (event.pointerType === 'touch') this.ultimoTocco = Date.now();
    // A pagina ingrandita le dita servono a spostare e a ridurre: si cambia
    // pagina soltanto quando il foglio è alla sua misura naturale.
    const direzione = this.zoom <= 1.01 ? this.swipe.fine(touches) : (this.swipe.annulla(), 0);
    if (direzione) {
      this.pinch = null;
      this.azzeraAnteprima();
      this.lastTap = 0;
      this.goTo(direzione > 0 ? this.avanti() : this.indietro());
      return;
    }
    if (this.pinch) {
      const { preview, partenza, centro } = this.pinch;
      this.pinch = null;
      this.azzeraAnteprima();
      // Il punto del foglio è quello toccato all'inizio; deve finire dove sono
      // arrivate le dita.
      this.setZoom(preview, { contenuto: partenza, schermo: centro });
      return;
    }
    if (event.pointerType === 'touch') {
      const now = Date.now();
      if (now - this.lastTap < 320) {
        this.lastTap = 0; // il doppio tocco è servito: un terzo tocco riparte da zero
        this.setZoom(1);
      } else {
        this.lastTap = now;
      }
    }
  }

  // Un dito solo che non scrive porta in giro il foglio. Lo scorrimento lo fa
  // l'app perché al browser il foglio è vietato: altrimenti si riprenderebbe
  // anche i tratti della penna.
  scorriFoglio(touches) {
    const [punto] = [...touches.values()];
    if (!punto) return;
    if (this.ultimoPunto) {
      this.scroll.scrollLeft -= punto.x - this.ultimoPunto.x;
      this.scroll.scrollTop -= punto.y - this.ultimoPunto.y;
    }
    this.ultimoPunto = { x: punto.x, y: punto.y };
  }

  // Vista a schermo intero: restano soltanto le pagine, senza barra in alto,
  // controlli in basso e astuccio. Si esce col pulsante che resta in un angolo
  // oppure toccando di nuovo il pulsante nella barra.
  setSchermoPieno(attivo) {
    this.schermoPieno = Boolean(attivo);
    this.root.classList.toggle('schermo-pieno', this.schermoPieno);
    const bottone = document.querySelector('#reader-fullscreen');
    bottone.setAttribute('aria-pressed', String(this.schermoPieno));
    bottone.classList.toggle('active', this.schermoPieno);
    const astuccio = document.querySelector('#reader-tools');
    const interruttore = document.querySelector('#toggle-reader-tools');
    if (this.schermoPieno) {
      this.astuccioAperto = !astuccio.hidden;
      astuccio.hidden = true;
      interruttore.classList.remove('active');
    } else if (this.astuccioAperto) {
      astuccio.hidden = false;
      interruttore.classList.add('active');
    }
  }

  // Salva le annotazioni della pagina toccata: 0 = sinistra, 1 = destra.
  async saveAnnotations(offset, elements) {
    if (!this.book || !this.pdf) return;
    const page = this.pageNumber + offset;
    // Il foglio di destra scrive solo quando esiste davvero. Non basta guardare
    // il totale: a doppia pagina aperta sulla copertina la 2 esiste ma sta
    // nella coppia dopo, e un segno finito li' la sporcherebbe.
    if (offset && page !== this.destra()) return;
    const chiave = offset ? 'annotationSaveToken2' : 'annotationSaveToken';
    const token = ++this[chiave];
    const bookId = this.book.id;
    await waitFrame();
    if (token !== this[chiave]) return;
    await DB.deleteWhere('annotazioni', (item) => item.idLibro === bookId && item.pagina === page);
    await DB.putMany('annotazioni', elements.map((item) => ({ ...item, idLibro: bookId, pagina: page })));
  }

  buildThumbnails() {
    const list = document.querySelector('#thumbnail-list');
    list.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let page = 1; page <= this.pdf.numPages; page += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumbnail';
      button.dataset.page = String(page);
      button.innerHTML = '<canvas width="120" height="150" aria-hidden="true"></canvas><span></span>';
      button.querySelector('span').textContent=physicalLabel(page,this.numbering)?'Pagina '+physicalLabel(page,this.numbering):'Foglio PDF '+page;
      button.addEventListener('click', () => this.goTo(page));
      fragment.append(button);
    }
    list.append(fragment);
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) this.renderThumbnail(entry.target);
    }, { root: document.querySelector('#thumbnail-panel'), rootMargin: '160px' });
    this.observeThumbnails();
  }

  observeThumbnails() {
    document.querySelectorAll('.thumbnail:not([data-rendered])').forEach((item) => this.thumbnailObserver?.observe(item));
  }

  async renderThumbnail(button) {
    if (button.dataset.rendered || !this.pdf) return;
    button.dataset.rendered = 'loading';
    try {
      const page = await this.pdf.getPage(Number(button.dataset.page));
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 120 / base.width });
      const canvas = button.querySelector('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      button.dataset.rendered = 'true';
      this.thumbnailObserver?.unobserve(button);
    } catch {
      delete button.dataset.rendered;
    }
  }

  updateThumbnailSelection() {
    document.querySelectorAll('.thumbnail').forEach((item) => item.classList.toggle('active', Number(item.dataset.page) === this.pageNumber));
  }

  async bookmarks() {
    return (await DB.getAll('segnalibri')).filter((item) => item.idLibro === this.book.id);
  }

  async updateBookmarkButton() {
    const active = (await this.bookmarks()).some((item) => item.pagina === this.pageNumber);
    const button = document.querySelector('#toggle-bookmark');
    button.classList.toggle('active', active);
    button.textContent = active ? '★' : '☆';
    button.setAttribute('aria-label', active ? 'Rimuovi segnalibro' : 'Aggiungi segnalibro');
  }

  // La stella apre il segnalibro della pagina: se non c'è lo si crea con la sua
  // nota, se c'è si può cambiare la nota o toglierlo.
  async toggleBookmark() {
    if (!this.book) return;
    const esistente = (await this.bookmarks()).find((item) => item.pagina === this.pageNumber);
    document.querySelector('#bookmark-dialog-title').textContent = esistente ? 'Segnalibro della pagina' : 'Nuovo segnalibro';
    document.querySelector('#bookmark-dialog-page').textContent = `Pagina ${physicalLabel(this.pageNumber,this.numbering)||'PDF '+this.pageNumber} di “${this.book.titolo}”.`;
    document.querySelector('#bookmark-note').value = esistente?.nota || '';
    this.paginaSegnalibro = this.pageNumber;
    document.querySelector('#bookmark-dialog').showModal();
  }

  async salvaSegnalibro() {
    const pagina = this.paginaSegnalibro ?? this.pageNumber;
    const nota = document.querySelector('#bookmark-note').value.trim();
    document.querySelector('#bookmark-dialog').close();
    if (!this.book) return;
    await DB.put('segnalibri', {
      id: `bookmark-${this.book.id}-${pagina}`,
      idLibro: this.book.id,
      pagina,
      nota,
      timestamp: Date.now(),
    });
    await this.updateBookmarkButton();
    await this.mostraSegnalibri();
  }

  async togliSegnalibro(segnalibro) {
    await DB.delete('segnalibri', segnalibro.id);
    await this.updateBookmarkButton();
    await this.mostraSegnalibri();
  }

  // L'elenco dei segnalibri del libro, in ordine di pagina: da qui si salta
  // dove si vuole, non solo all'ultimo segnato.
  async mostraSegnalibri() {
    const pannello = document.querySelector('#bookmark-panel');
    if (pannello.hidden || !this.book) return;
    const elenco = document.querySelector('#bookmark-list');
    const segnalibri = (await this.bookmarks()).sort((a, b) => a.pagina - b.pagina);
    elenco.replaceChildren();
    document.querySelector('#bookmark-empty').hidden = segnalibri.length > 0;
    for (const segnalibro of segnalibri) {
      const riga = document.createElement('div');
      riga.className = 'bookmark-row';
      const vai = document.createElement('button');
      vai.type = 'button';
      vai.className = `bookmark-item${segnalibro.pagina === this.pageNumber ? ' corrente' : ''}`;
      const dove = document.createElement('strong');
      dove.textContent = `Pagina ${segnalibro.pagina}`;
      const nota = document.createElement('span');
      nota.textContent = segnalibro.nota || 'Senza nota';
      vai.append(dove, nota);
      vai.addEventListener('click', () => this.goTo(segnalibro.pagina));
      const togli = document.createElement('button');
      togli.type = 'button';
      togli.className = 'bookmark-remove danger-text';
      togli.setAttribute('aria-label', `Togli il segnalibro di pagina ${segnalibro.pagina}`);
      togli.textContent = '×';
      togli.addEventListener('click', () => this.togliSegnalibro(segnalibro));
      riga.append(vai, togli);
      elenco.append(riga);
    }
  }
}

export const PDFViewer = new Reader();
