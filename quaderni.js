// Gestione dei quaderni e delle loro pagine vettoriali.
import { DB, createId } from './db.js';
import { SEGNI_MUSICALI, GRUPPI_MUSICALI, disegnaAnteprimaSegno, fontePronta } from './musica.js';
import { DrawingSurface, SurfaceGroup, attachToolbox, disegnaElementi, canvasToJpeg, makePdfFromJpegs, downloadBlob, creaGestoCondiviso, creaRilevatoreSwipe, ditaAppoggiate } from './strumenti.js';

function safeFilename(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'quaderno';
}

// I tipi di foglio: il nome che si salva nel quaderno e la classe che lo
// disegna a schermo. Aggiungerne uno vuol dire toccare questa tabella, il CSS
// e il disegno per l'esportazione qui sotto.
export const TIPI_FOGLIO = {
  righe: 'lined',
  quadretti: 'squared',
  bianco: 'blank',
  pentagramma: 'staff',
  millimetrato: 'graph',
};

// Orientamento di una pagina. Il foglio a pentagramma nasce ORIZZONTALE, cosi'
// ogni rigo corre sul lato lungo e ci sta piu' musica. Gli altri fogli restano
// verticali. L'orientamento si scrive sulla PAGINA e non sul quaderno: i segni
// sono salvati in frazioni del foglio, quindi girare una pagina gia' scritta
// sposterebbe note e simboli. Per questo le pagine a pentagramma scritte prima
// restano verticali e diventano orizzontali solo quelle vuote.
export function versioneGuidePagina(tipo, pagina) {
  if (!['righe', 'quadretti', 'millimetrato'].includes(tipo)) return 0;
  if ([1, 2].includes(pagina?.versioneGuide)) return pagina.versioneGuide;
  return pagina?.elementi?.length ? 1 : 2;
}

export function campoGuide(tipo) {
  const versione = versioneGuidePagina(tipo, {});
  return versione ? { versioneGuide: versione } : {};
}

export function geometriaGuide(tipo, larghezza) {
  const mm = tipo === 'righe' ? 8 : tipo === 'quadretti' ? 5 : 1;
  return { passo: larghezza * mm / 210, maggiore: larghezza * 5 / 210, mm };
}

function sfondoGuide(tipo, larghezza) {
  const { passo, maggiore } = geometriaGuide(tipo, larghezza);
  const colore = tipo === 'millimetrato' ? '#dcebe1' : '#c9d9f2';
  const linea = (direzione, spazio, tinta) => `repeating-linear-gradient(${direzione}, transparent 0 ${spazio - 0.7}px, ${tinta} ${spazio - 0.7}px ${spazio}px)`;
  const strati = [linea('to bottom', passo, colore)];
  if (tipo !== 'righe') strati.push(linea('90deg', passo, colore));
  if (tipo === 'millimetrato') strati.unshift(linea('to bottom', maggiore, '#9cc4a8'), linea('90deg', maggiore, '#9cc4a8'));
  else strati.unshift('linear-gradient(90deg, transparent 0 8%, #ef9b9b 8% 8.15%, transparent 8.15%)');
  return strati.join(', ');
}

export const ORIENTAMENTI = { verticale: 'verticale', orizzontale: 'orizzontale' };

export function orientamentoNuovaPagina(tipo) {
  return tipo === 'pentagramma' ? ORIENTAMENTI.orizzontale : ORIENTAMENTI.verticale;
}

// L'orientamento da dare a una pagina che non lo ha ancora scritto (quelle
// nate prima di questa regola, o arrivate da un backup vecchio).
export function orientamentoPagina(tipo, pagina) {
  if (pagina?.orientamento === ORIENTAMENTI.orizzontale || pagina?.orientamento === ORIENTAMENTI.verticale) return pagina.orientamento;
  if (tipo !== 'pentagramma') return ORIENTAMENTI.verticale;
  return (pagina?.elementi || []).length ? ORIENTAMENTI.verticale : ORIENTAMENTI.orizzontale;
}

// Misura in pixel dell'immagine esportata: stessa proporzione del foglio a schermo.
// Il campo del disegno del rigo per una pagina nuova: solo sul pentagramma.
export function campoDisegnoRigo(tipo) {
  const disegno = disegnoRigoNuovaPagina(tipo);
  return disegno ? { disegnoRigo: disegno } : {};
}

export function misuraEsportazione(orientamento) {
  return orientamento === ORIENTAMENTI.orizzontale ? { width: 1754, height: 1240 } : { width: 1240, height: 1754 };
}

// Misure del pentagramma, identiche a quelle del CSS: se cambiano li', vanno
// cambiate anche qui, altrimenti i simboli non cadono piu' sulle righe.
export const RIGO = { passoRiga: 16, passoRigo: 150, primaRiga: 15 };

// Quanti righi interi (tutte e cinque le righe) stanno in un foglio alto cosi'.
export function righiInteri(altezza) {
  const ultimaRiga = RIGO.primaRiga + RIGO.passoRiga * 4;
  if (altezza <= ultimaRiga) return 0;
  return Math.floor((altezza - ultimaRiga - 1) / RIGO.passoRigo) + 1;
}

// Porta una quota verticale sulla riga o sullo spazio piu' vicini. E' quel che
// fa la mano quando si scrive musica: le note non stanno a mezz'aria.
export function agganciaAlRigo(yNormalizzato, altezzaFoglio) {
  if (!altezzaFoglio) return yNormalizzato;
  const y = yNormalizzato * altezzaFoglio;
  const dentroRigo = ((y - RIGO.primaRiga) % RIGO.passoRigo + RIGO.passoRigo) % RIGO.passoRigo;
  const inizio = y - dentroRigo;
  // mezzo passo: cosi' si aggancia sia alle righe sia agli spazi in mezzo
  const mezzi = Math.round(dentroRigo / (RIGO.passoRiga / 2));
  // oltre il rigo (sopra la prima riga o sotto la quinta) si resta liberi
  if (mezzi < -2 || mezzi > 10) return yNormalizzato;
  return (inizio + mezzi * (RIGO.passoRiga / 2)) / altezzaFoglio;
}

// Disegno del rigo di una pagina a pentagramma.
// 1 FISSO: quello delle pagine nate fino alla v25. Misure in pixel fisse, il
//   primo rigo a 15 px dal bordo, cioe' attaccato: sopra non ci stava una nota.
// 2 PROPORZIONALE: ogni rigo ha sopra e sotto lo stesso spazio libero, primo e
//   ultimo compresi, e tutto cresce col foglio come crescono i segni.
// Le pagine gia' scritte tengono il disegno 1: i simboli sono agganciati alle
// righe vecchie e spostare le righe li lascerebbe fuori posto.
export const DISEGNI_RIGO = { fisso: 1, proporzionale: 2 };

// Lo spazio libero fra due righi, sopra il primo e sotto l'ultimo vale 5,5
// spazi di rigo: ci sta intera una nota sul secondo taglio addizionale con la
// gamba in su (2 spazi + 3,5 di gamba). La v25 dava 86 px su 16, cioe' 5,4, ed
// e' lo spazio che Cristian ha visto giusto sopra il secondo rigo.
// Quanti righi stanno in un foglio e' fisso per orientamento, e il passo si
// ricava da li': cosi' tutto cresce col foglio e non cambia girando l'iPad o
// aprendo l'astuccio.
export const RIGO_PROPORZIONALE = { spaziLiberi: 5.5, righi: { orizzontale: 4, verticale: 6 } };

export function disegnoRigoNuovaPagina(tipo) {
  return tipo === 'pentagramma' ? DISEGNI_RIGO.proporzionale : undefined;
}

// Il disegno da dare a una pagina che non lo ha ancora scritto: vuota prende
// quello nuovo, scritta resta com'era.
export function disegnoRigoPagina(tipo, pagina) {
  if (tipo !== 'pentagramma') return null;
  if (pagina?.disegnoRigo === DISEGNI_RIGO.fisso || pagina?.disegnoRigo === DISEGNI_RIGO.proporzionale) return pagina.disegnoRigo;
  return (pagina?.elementi || []).length ? DISEGNI_RIGO.fisso : DISEGNI_RIGO.proporzionale;
}

// Dove stanno i righi su un foglio largo e alto cosi', in pixel.
// `spazio` e' il vuoto fra un rigo e l'altro, uguale sopra il primo e sotto l'ultimo.
export function geometriaRigo(disegno, larghezza, altezza) {
  if (disegno !== DISEGNI_RIGO.proporzionale) {
    return { ...RIGO, righi: righiInteri(altezza), spazio: RIGO.passoRigo - RIGO.passoRiga * 4 };
  }
  const righi = altezza >= larghezza ? RIGO_PROPORZIONALE.righi.verticale : RIGO_PROPORZIONALE.righi.orizzontale;
  const { spaziLiberi } = RIGO_PROPORZIONALE;
  const passoRiga = altezza / (righi * 4 + (righi + 1) * spaziLiberi);
  const alto = passoRiga * 4;
  const spazio = passoRiga * spaziLiberi;
  return { passoRiga, passoRigo: alto + spazio, primaRiga: spazio, righi, spazio };
}

// Aggancio sul disegno nuovo: si cerca il rigo piu' vicino e ci si ferma alla
// riga o allo spazio piu' vicini, anche fuori dal rigo fino a due tagli e mezzo
// sopra o sotto, dove vanno le note acute e gravi.
export function agganciaAlRigoProporzionale(yNormalizzato, altezzaFoglio, geometria) {
  if (!altezzaFoglio || !geometria?.righi) return yNormalizzato;
  const y = yNormalizzato * altezzaFoglio;
  const centro = geometria.primaRiga + geometria.passoRiga * 2;
  const indice = Math.max(0, Math.min(geometria.righi - 1, Math.round((y - centro) / geometria.passoRigo)));
  const inizio = geometria.primaRiga + indice * geometria.passoRigo;
  const mezzi = Math.round((y - inizio) / (geometria.passoRiga / 2));
  if (mezzi < -5 || mezzi > 13) return yNormalizzato;
  return (inizio + mezzi * (geometria.passoRiga / 2)) / altezzaFoglio;
}

// Lo sfondo del disegno nuovo: le righe si calcolano sulla misura vera del
// foglio, quindi non si possono ripetere col CSS come nel disegno vecchio.
// Un solo gradiente con una fascia di un pixel per ogni riga.
export function sfondoRigo(geometria) {
  const fermate = [];
  for (let indice = 0; indice < geometria.righi; indice += 1) {
    for (let linea = 0; linea < 5; linea += 1) {
      const quota = geometria.primaRiga + indice * geometria.passoRigo + linea * geometria.passoRiga;
      const da = (quota - 0.5).toFixed(2);
      const a = (quota + 0.5).toFixed(2);
      fermate.push(`transparent ${da}px`, `#5b6472 ${da}px`, `#5b6472 ${a}px`, `transparent ${a}px`);
    }
  }
  return fermate.length ? `linear-gradient(to bottom, ${fermate.join(', ')})` : 'none';
}

function riga(context, x1, y1, x2, y2) {
  context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
}

// Ridisegna il foglio per l'esportazione in PNG e PDF: a schermo lo fa il CSS,
// qui va rifatto col pennello perche' l'immagine esca uguale a quel che si vede.
export function drawPaper(context, type, width, height, larghezzaSchermo = 780, disegnoRigo = DISEGNI_RIGO.fisso, versioneGuide = 1) {
  context.fillStyle = '#fffefa';
  context.fillRect(0, 0, width, height);
  if (type === 'bianco') return;
  if (versioneGuide === 2 && ['righe', 'quadretti', 'millimetrato'].includes(type)) {
    const { passo, maggiore } = geometriaGuide(type, width);
    context.lineWidth = Math.max(0.5, width / 1500);
    context.strokeStyle = type === 'millimetrato' ? '#dcebe1' : '#c9d9f2';
    for (let y = passo; y < height; y += passo) riga(context, 0, y, width, y);
    if (type !== 'righe') for (let x = passo; x < width; x += passo) riga(context, x, 0, x, height);
    if (type === 'millimetrato') {
      context.strokeStyle = '#9cc4a8';
      for (let y = maggiore; y < height; y += maggiore) riga(context, 0, y, width, y);
      for (let x = maggiore; x < width; x += maggiore) riga(context, x, 0, x, height);
    } else {
      context.strokeStyle = '#ef9b9b';
      riga(context, width * 0.08, 0, width * 0.08, height);
    }
    return;
  }

  // Il disegno nuovo e' proporzionale: si calcola direttamente sulla misura
  // dell'immagine e cade esattamente dove cade a schermo.
  if (type === 'pentagramma' && disegnoRigo === DISEGNI_RIGO.proporzionale) {
    const geometria = geometriaRigo(disegnoRigo, width, height);
    context.strokeStyle = '#5b6472';
    context.lineWidth = Math.max(1, geometria.passoRiga * 0.0875);
    for (let indice = 0; indice < geometria.righi; indice += 1) {
      const alto = geometria.primaRiga + indice * geometria.passoRigo;
      for (let linea = 0; linea < 5; linea += 1) riga(context, 0, alto + linea * geometria.passoRiga, width, alto + linea * geometria.passoRiga);
    }
    return;
  }

  // Le guide a schermo hanno misure fisse in pixel: qui il foglio e' piu'
  // grande, quindi si allargano nella proporzione del foglio visto a schermo.
  // Senza, il rigo esportato non cadrebbe piu' sotto le note.
  const scala = width / (larghezzaSchermo || 780);

  if (type === 'pentagramma') {
    context.strokeStyle = '#5b6472';
    context.lineWidth = Math.max(1, 1.4 * scala);
    const passoRiga = RIGO.passoRiga * scala;   // fra le cinque righe di un rigo
    const passoRigo = RIGO.passoRigo * scala;  // fra un rigo e quello dopo
    for (let alto = RIGO.primaRiga * scala; alto + passoRiga * 4 < height; alto += passoRigo) {
      for (let indice = 0; indice < 5; indice += 1) {
        riga(context, 0, alto + indice * passoRiga, width, alto + indice * passoRiga);
      }
    }
    return;
  }

  if (type === 'millimetrato') {
    const fine = 4 * scala;
    context.lineWidth = Math.max(0.5, 0.8 * scala);
    context.strokeStyle = '#dcebe1';
    for (let y = fine; y < height; y += fine) riga(context, 0, y, width, y);
    for (let x = fine; x < width; x += fine) riga(context, x, 0, x, height);
    context.lineWidth = Math.max(1, 1.4 * scala);
    context.strokeStyle = '#9cc4a8';
    for (let y = fine * 5; y < height; y += fine * 5) riga(context, 0, y, width, y);
    for (let x = fine * 5; x < width; x += fine * 5) riga(context, x, 0, x, height);
    return;
  }

  context.strokeStyle = '#c9d9f2';
  context.lineWidth = 2;
  const spacing = type === 'quadretti' ? 36 : 46;
  for (let y = spacing; y < height; y += spacing) riga(context, 0, y, width, y);
  if (type === 'quadretti') {
    for (let x = spacing; x < width; x += spacing) riga(context, x, 0, x, height);
  }
  context.strokeStyle = '#ef9b9b';
  riga(context, width * 0.08, 0, width * 0.08, height);
}

export class NotebookManager {
  constructor(options = {}) {
    this.notify = options.notify || (() => {});
    this.showProgress = options.showProgress || (() => {});
    this.hideProgress = options.hideProgress || (() => {});
    this.current = null;
    this.drawWithFinger = false;
    this.pages = [];
    this.pageIndex = 0;
    this.doppia = false;
    this.saveToken = 0;
    this.saveToken2 = 0;
    // Ultima larghezza a schermo vista per ciascun orientamento: serve
    // all'esportazione per far cadere il rigo dove cade a schermo.
    this.larghezzeFoglio = { verticale: 780, orizzontale: 1100 };
    this.canvas = document.querySelector('#notebook-canvas');
    this.canvas2 = document.querySelector('#notebook-canvas-2');
    // Zoom del quaderno: la Pencil scrive; le dita scorrono e ingrandiscono.
    this.zoom = 1;
    this.overview = false;
    this.zoomDiLavoro = null;
    this.panX = 0;
    this.panY = 0;
    this.pinch = null;
    // Sfioramento orizzontale: cambia pagina senza toccare le frecce.
    this.swipe = creaRilevatoreSwipe();
    this.ultimoPunto = null;
    this.schermoPieno = false;
    this.astuccioAperto = false;
    // Un solo gesto per tutti e due i fogli: le due dita possono cadere su fogli diversi.
    const gesto = creaGestoCondiviso();
    const gestoDueDita = (fase, event, touches) => this.gestoDueDita(fase, touches);
    // due fogli: sinistro (offset 0) e destro (offset 1). onChange salva la pagina giusta.
    // Sul pentagramma i simboli si incollano alla riga piu' vicina.
    // Ogni foglio guarda il disegno del rigo della SUA pagina.
    const disegnoDi = (canvas) => Number(canvas.parentElement?.dataset.disegnoRigo) || DISEGNI_RIGO.fisso;
    const aggancia = (canvas) => (y) => {
      if (this.current?.tipo !== 'pentagramma') return y;
      if (disegnoDi(canvas) !== DISEGNI_RIGO.proporzionale) return agganciaAlRigo(y, canvas.offsetHeight);
      return agganciaAlRigoProporzionale(y, canvas.offsetHeight, geometriaRigo(DISEGNI_RIGO.proporzionale, canvas.offsetWidth, canvas.offsetHeight));
    };
    // Il segno musicale e' alto quanto il passo del rigo, ne' piu' ne' meno.
    const unita = (canvas) => () => {
      if (!canvas.offsetHeight) return 0.016;
      return geometriaRigo(disegnoDi(canvas), canvas.offsetWidth, canvas.offsetHeight).passoRiga / canvas.offsetHeight;
    };
    this.surface = new DrawingSurface(this.canvas, { gesto, onChange: (elements) => this.savePage(0, elements), onTouchGesture: gestoDueDita, agganciaY: aggancia(this.canvas), unitaMusicale: unita(this.canvas) });
    this.surface2 = new DrawingSurface(this.canvas2, { gesto, onChange: (elements) => this.savePage(1, elements), onTouchGesture: gestoDueDita, agganciaY: aggancia(this.canvas2), unitaMusicale: unita(this.canvas2) });
    // un unico astuccio comanda entrambi i fogli (attivo = l'ultimo toccato)
    this.group = new SurfaceGroup([this.surface, this.surface2]);
    attachToolbox(document.querySelector('#notebook-tools'), this.group);
    this.bind();
  }

  setDrawWithFinger(value) {
    this.drawWithFinger = Boolean(value);
    this.group.setDrawWithFinger(this.drawWithFinger);
  }

  // Costruisce la tavolozza dei simboli: ogni segno disegnato grande sul suo
  // pezzo di rigo, col nome sotto e raccolto nel suo gruppo. Un elenco di soli
  // nomi non direbbe niente a chi cerca la nota, ma un disegno piccolo e senza
  // nome obbliga ad andare a tentativi, che e' com'era prima.
  costruisciTavolozzaMusicale() {
    const griglia = document.querySelector('#notebook-music-grid');
    if (!griglia.childElementCount) {
      for (const gruppo of GRUPPI_MUSICALI) {
        const titolo = document.createElement('p');
        titolo.className = 'music-group';
        titolo.textContent = gruppo.nome;
        const fila = document.createElement('div');
        fila.className = 'music-row';
        for (const segno of SEGNI_MUSICALI.filter((voce) => voce.gruppo === gruppo.chiave)) {
          fila.append(this.bottoneSegno(segno));
        }
        griglia.append(titolo, fila);
      }
    }
    this.ridisegnaTavolozzaMusicale();
    // Il font di notazione arriva dopo: finche' non e' pronto non si disegna un
    // solo pixel, ed era per questo che i riquadri restavano vuoti mentre sul
    // foglio, ridisegnato piu' tardi, i segni si vedevano bene.
    fontePronta().then(() => this.ridisegnaTavolozzaMusicale());
  }

  bottoneSegno(segno) {
    const bottone = document.createElement('button');
    bottone.type = 'button';
    bottone.dataset.segno = segno.chiave;
    bottone.title = segno.nome;
    bottone.setAttribute('aria-label', segno.nome);
    const anteprima = document.createElement('canvas');
    anteprima.className = 'music-preview';
    anteprima.setAttribute('aria-hidden', 'true');
    const nome = document.createElement('span');
    nome.textContent = segno.breve;
    bottone.append(anteprima, nome);
    bottone.addEventListener('click', () => this.scegliSegno(segno.chiave));
    return bottone;
  }

  ridisegnaTavolozzaMusicale() {
    for (const anteprima of document.querySelectorAll('#notebook-music-grid canvas')) {
      disegnaAnteprimaSegno(anteprima, anteprima.closest('button').dataset.segno);
    }
  }

  scegliSegno(chiave) {
    this.group.setSegnoMusicale(chiave);
    this.group.setTool('simbolo');
    document.querySelectorAll('#notebook-music-grid button').forEach((b) => b.classList.toggle('active', b.dataset.segno === chiave));
    // nell'astuccio nessuno strumento resta acceso: comanda la tavolozza
    document.querySelectorAll('#notebook-tools [data-tool]').forEach((b) => b.classList.remove('active'));
  }

  // La tavolozza si vede solo dove serve: su un quaderno a pentagramma.
  aggiornaTavolozzaMusicale() {
    const pannello = document.querySelector('#notebook-music');
    const musicale = this.current?.tipo === 'pentagramma';
    pannello.hidden = !musicale;
    if (musicale) this.costruisciTavolozzaMusicale();
  }

  bind() {
    document.querySelector('#new-notebook').addEventListener('click', () => {
      document.querySelector('#notebook-form').reset();
      document.querySelector('#notebook-dialog').showModal();
    });
    document.querySelector('#notebook-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = document.querySelector('#new-notebook-title').value.trim();
      const subject = document.querySelector('#new-notebook-subject').value.trim();
      const type = new FormData(event.currentTarget).get('paper-type');
      if (!title || !subject || !TIPI_FOGLIO[type]) return;
      const notebook = { id: createId('quaderno'), titolo: title, materia: subject, tipo: type, data: Date.now(), pagine: 1 };
      const page = { id: createId('pagina'), idQuaderno: notebook.id, numero: 1, elementi: [], orientamento: orientamentoNuovaPagina(type), ...campoDisegnoRigo(type), ...campoGuide(type), data: Date.now() };
      await DB.put('quaderni', notebook);
      await DB.put('paginequaderno', page);
      document.querySelector('#notebook-dialog').close();
      await this.renderList();
      await this.open(notebook.id, 1);
    });
    document.querySelector('#close-notebook').addEventListener('click', () => this.close());
    document.querySelector('#notebook-prev').addEventListener('click', () => this.goTo(this.pageIndex - (this.doppia ? 2 : 1)));
    document.querySelector('#notebook-next').addEventListener('click', () => this.goTo(this.pageIndex + (this.doppia ? 2 : 1)));
    document.querySelector('#editor-quaderno').addEventListener('click', (event) => {
      if (this.overview && event.target.closest('[data-writing-mode], [data-quick-tool], [data-tool], [data-readonly], #notebook-music-grid button')) this.toggleOverview();
    }, true);
    document.querySelector('#notebook-overview').addEventListener('click', () => this.toggleOverview());
    document.querySelector('#notebook-two-pages').addEventListener('click', () => this.toggleDoppia());
    document.querySelector('#notebook-add-page').addEventListener('click', () => this.addPage());
    document.querySelector('#notebook-delete-page').addEventListener('click', () => this.deletePage());
    document.querySelector('#export-notebook-page').addEventListener('click', () => this.exportPage());
    document.querySelector('#export-notebook-pdf').addEventListener('click', () => this.exportPdf());
    document.querySelector('#notebook-tools').addEventListener('click', (event) => {
      if (event.target.closest('[data-tool]')) {
        document.querySelectorAll('#notebook-music-grid button').forEach((b) => b.classList.remove('active'));
      }
    });
    // Girando l'iPad il foglio cambia misura: il rigo va rifatto sulla nuova.
    const ridisegnaRighi = () => requestAnimationFrame(() => {
      for (const wrap of document.querySelectorAll('#notebook-pages .notebook-paper')) this.soloRighiInteri(wrap);
      if (this.overview) this.fitOverview();
    });
    window.addEventListener('resize', ridisegnaRighi);
    if (typeof ResizeObserver === 'function') new ResizeObserver(ridisegnaRighi).observe(document.querySelector('#notebook-pages'));
    document.querySelector('#notebook-fullscreen').addEventListener('click', () => this.setSchermoPieno(!this.schermoPieno));
    document.querySelector('#notebook-exit-fullscreen').addEventListener('click', () => this.setSchermoPieno(false));
    document.querySelector('#toggle-notebook-tools').addEventListener('click', (event) => {
      const tools = document.querySelector('#notebook-tools');
      tools.hidden = !tools.hidden;
      event.currentTarget.classList.toggle('active', !tools.hidden);
    });
  }

  async renderList() {
    const notebooks = (await DB.getAll('quaderni')).sort((a, b) => b.data - a.data);
    const grid = document.querySelector('#notebook-grid');
    document.querySelector('#notebook-empty').hidden = notebooks.length > 0;
    grid.replaceChildren();
    for (const notebook of notebooks) {
      const card = document.createElement('article');
      card.className = 'notebook-card';
      card.innerHTML = `<button type="button" class="notebook-cover" aria-label="Apri ${escapeHtml(notebook.titolo)}"><span class="notebook-binding" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><strong>${escapeHtml(notebook.titolo)}</strong><span>${escapeHtml(notebook.materia)} · ${notebook.pagine} ${notebook.pagine === 1 ? 'pagina' : 'pagine'}</span></button><button type="button" class="card-menu" aria-label="Azioni quaderno">⋯</button><div class="card-actions" hidden><button type="button" data-open>Apri</button><button type="button" data-delete class="danger-text">Elimina</button></div>`;
      card.querySelector('.notebook-cover').addEventListener('click', () => this.open(notebook.id));
      card.querySelector('[data-open]').addEventListener('click', () => this.open(notebook.id));
      card.querySelector('.card-menu').addEventListener('click', () => { const menu = card.querySelector('.card-actions'); menu.hidden = !menu.hidden; });
      card.querySelector('[data-delete]').addEventListener('click', async () => {
        if (!confirm(`Eliminare il quaderno “${notebook.titolo}” e tutte le sue pagine?`)) return;
        await DB.delete('quaderni', notebook.id);
        await DB.deleteWhere('paginequaderno', (page) => page.idQuaderno === notebook.id);
        await this.renderList();
        this.notify('Quaderno eliminato.');
      });
      grid.append(card);
    }
  }

  async open(id, pageNumber = 1) {
    if(DB.session?.busy)return this.notify('Attendi la fine dell’aggiornamento dei dispositivi prima di aprire il quaderno.');
    this.current = await DB.get('quaderni', id);
    if (!this.current) return this.notify('Questo quaderno non è più disponibile.', true);
    this.pages = (await DB.getAll('paginequaderno')).filter((page) => page.idQuaderno === id).sort((a, b) => a.numero - b.numero);
    if (!this.pages.length) {
      const page = { id: createId('pagina'), idQuaderno: id, numero: 1, elementi: [], orientamento: orientamentoNuovaPagina(this.current.tipo), ...campoDisegnoRigo(this.current.tipo), ...campoGuide(this.current.tipo), data: Date.now() };
      await DB.put('paginequaderno', page);
      this.pages = [page];
    }
    // Le pagine nate prima dell'orientamento (o tornate da un backup vecchio)
    // lo ricevono ora, una volta sola, e lo tengono per sempre: una pagina
    // vuota mostrata orizzontale non deve tornare verticale al primo segno.
    for (const page of this.pages) {
      const guide = versioneGuidePagina(this.current.tipo, page);
      const manca = !page.orientamento || (this.current.tipo === 'pentagramma' && !page.disegnoRigo) || (guide && !page.versioneGuide);
      if (!manca) continue;
      page.orientamento = orientamentoPagina(this.current.tipo, page);
      const disegno = disegnoRigoPagina(this.current.tipo, page);
      if (disegno) page.disegnoRigo = disegno;
      if (guide) page.versioneGuide = guide;
      await DB.put('paginequaderno', page);
    }
    this.pageIndex = Math.max(0, Math.min(this.pages.length - 1, Number(pageNumber) - 1));
    document.querySelector('#notebook-title').textContent = this.current.titolo;
    document.querySelector('#notebook-subject').textContent = this.current.materia;
    document.querySelector('#editor-quaderno').hidden = false;
    document.body.classList.add('workspace-open');
    this.azzeraZoom();
    this.aggiornaTavolozzaMusicale();
    this.showPage();
    // Finché il font di notazione non è caricato i simboli non si disegnano:
    // appena è pronto si ripassa la pagina.
    if (this.current.tipo === 'pentagramma') fontePronta().then(() => { if (this.current) this.showPage(); });
  }

  close() {
    this.azzeraZoom();
    // Il quaderno successivo si apre con le barre in vista: chi riapre deve
    // ritrovare il pulsante per chiudere, non un foglio senza comandi.
    this.setSchermoPieno(false);
    this.swipe.annulla();
    document.querySelector('#editor-quaderno').hidden = true;
    document.body.classList.remove('workspace-open');
    this.current = null;
    this.pages = [];
    this.surface.setElements([]);
    this.surface2.setElements([]);
    this.renderList();
    document.dispatchEvent(new CustomEvent('skooling:quaderno-chiuso'));
  }

  // ---- Zoom a due dita -----------------------------------------------------
  // Il riquadro dei fogli si ingrandisce con una trasformazione CSS. I canvas
  // restano gli stessi: le coordinate del disegno sono relative al foglio
  // visibile, quindi si continua a scrivere nel punto giusto anche ingranditi.
  gestoDueDita(fase, touches) {
    if (this.overview) return;
    const box = document.querySelector('#notebook-pages');
    const dita = ditaAppoggiate(touches);
    if (fase === 'start') {
      this.swipe.inizio(touches);
      this.ultimoPunto = null;
      if (dita.length < 2) return;
      const [primo, secondo] = dita;
      const rect = box.getBoundingClientRect();
      this.pinch = {
        distanza: Math.hypot(primo.x - secondo.x, primo.y - secondo.y) || 1,
        zoom: this.zoom,
        panX: this.panX,
        panY: this.panY,
        // angolo del riquadro senza trasformazione (l'origine è in alto a sinistra)
        originX: rect.left - this.panX,
        originY: rect.top - this.panY,
        mediaX: (primo.x + secondo.x) / 2,
        mediaY: (primo.y + secondo.y) / 2,
      };
      return;
    }
    if (fase === 'move') {
      this.swipe.muovi(touches);
      // Un dito solo che non scrive scorre il foglio, come nel libro. Serve in
      // sola lettura: al foglio i gesti li governa l'app, non il browser.
      if (dita.length === 1 && !this.pinch) this.scorriFoglio(touches);
    }
    if (fase === 'move' && this.pinch && dita.length >= 2) {
      const [primo, secondo] = dita;
      const distanza = Math.hypot(primo.x - secondo.x, primo.y - secondo.y) || 1;
      const zoom = Math.max(1, Math.min(4, this.pinch.zoom * distanza / this.pinch.distanza));
      const mediaX = (primo.x + secondo.x) / 2;
      const mediaY = (primo.y + secondo.y) / 2;
      // il punto del foglio che stava sotto le due dita ci resta anche dopo
      const puntoX = (this.pinch.mediaX - this.pinch.originX - this.pinch.panX) / this.pinch.zoom;
      const puntoY = (this.pinch.mediaY - this.pinch.originY - this.pinch.panY) / this.pinch.zoom;
      this.applicaZoom(zoom, mediaX - this.pinch.originX - zoom * puntoX, mediaY - this.pinch.originY - zoom * puntoY);
      // A misura naturale due dita che scendono insieme fanno scorrere il
      // foglio: nel quaderno il dito scrive, e senza questo il secondo foglio
      // impilato (o il fondo di un foglio lungo) si raggiungeva solo dal margine.
      // Le dita arrivano una alla volta: a meta' passo sembrano allargarsi e
      // lo zoom supera appena 1. Il riferimento si aggiorna solo quando si
      // scorre davvero, cosi' quel mezzo passo non va perso.
      if (this.zoom === 1) {
        const riquadro = document.querySelector('#editor-quaderno .page-scroll');
        const ultima = this.pinch.ultimaMedia || { x: this.pinch.mediaX, y: this.pinch.mediaY };
        if (riquadro) riquadro.scrollTop -= mediaY - ultima.y;
        this.pinch.ultimaMedia = { x: mediaX, y: mediaY };
      }
      return;
    }
    if (fase !== 'end') return;
    this.pinch = null;
    this.ultimoPunto = null;
    // A foglio ingrandito le dita servono a spostare e a ridurre: si cambia
    // pagina soltanto quando il foglio è alla sua misura naturale.
    const direzione = this.zoom <= 1.01 ? this.swipe.fine(touches) : (this.swipe.annulla(), 0);
    if (direzione) this.goTo(this.pageIndex + direzione * (this.doppia ? 2 : 1));
  }

  // Vista a schermo intero: restano soltanto i fogli, senza barra in alto,
  // controlli in basso e astuccio. Si esce col pulsante che resta in un angolo
  // oppure toccando di nuovo il pulsante nella barra.
  setSchermoPieno(attivo) {
    this.schermoPieno = Boolean(attivo);
    document.querySelector('#editor-quaderno').classList.toggle('schermo-pieno', this.schermoPieno);
    const bottone = document.querySelector('#notebook-fullscreen');
    bottone.setAttribute('aria-pressed', String(this.schermoPieno));
    bottone.classList.toggle('active', this.schermoPieno);
    const astuccio = document.querySelector('#notebook-tools');
    const interruttore = document.querySelector('#toggle-notebook-tools');
    if (this.schermoPieno) {
      this.astuccioAperto = !astuccio.hidden;
      astuccio.hidden = true;
      interruttore.classList.remove('active');
    } else if (this.astuccioAperto) {
      astuccio.hidden = false;
      interruttore.classList.add('active');
    }
  }

  // Porta in giro il foglio col dito. Lo fa il codice perché al foglio i gesti
  // del browser sono vietati: senza, la penna scriverebbe mentre la pagina
  // scappa.
  scorriFoglio(touches) {
    const riquadro = document.querySelector('#editor-quaderno .page-scroll');
    const [punto] = [...touches.values()];
    if (!riquadro || !punto) return;
    if (this.ultimoPunto) {
      riquadro.scrollLeft -= punto.x - this.ultimoPunto.x;
      riquadro.scrollTop -= punto.y - this.ultimoPunto.y;
    }
    this.ultimoPunto = { x: punto.x, y: punto.y };
  }

  toggleOverview() {
    const scroll = document.querySelector('#editor-quaderno .page-scroll');
    if (!this.overview) {
      this.zoomDiLavoro = { zoom: this.zoom, panX: this.panX, panY: this.panY, scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft };
      this.overview = true;
      this.letturaPrimaOverview = this.group.readOnly;
      this.group.setReadOnly(true);
      this.fitOverview();
    } else {
      this.overview = false;
      this.group.setReadOnly(this.letturaPrimaOverview);
      const prima = this.zoomDiLavoro || { zoom: 1, panX: 0, panY: 0 };
      this.applicaZoom(prima.zoom, prima.panX, prima.panY);
      scroll.scrollTop = prima.scrollTop || 0;
      scroll.scrollLeft = prima.scrollLeft || 0;
    }
    const bottone = document.querySelector('#notebook-overview');
    bottone.textContent = this.overview ? 'Torna a scrivere' : 'Foglio intero';
    bottone.setAttribute('aria-pressed', String(this.overview));
    bottone.classList.toggle('active', this.overview);
  }

  fitOverview() {
    const box = document.querySelector('#notebook-pages');
    const scroll = document.querySelector('#editor-quaderno .page-scroll');
    if (!box.offsetHeight || !scroll.clientHeight) return;
    const scala = Math.min(1, (scroll.clientHeight - 36) / box.offsetHeight, (scroll.clientWidth - 36) / box.offsetWidth);
    box.style.transformOrigin = 'top center';
    box.style.transform = `scale(${Math.max(0.1, scala)})`;
    scroll.scrollTop = 0;
    scroll.scrollLeft = 0;
    document.querySelector('#notebook-zoom').textContent = 'Foglio intero: controlla la grandezza delle lettere';
  }

  applicaZoom(zoom, panX, panY) {
    const box = document.querySelector('#notebook-pages');
    if (zoom <= 1.01) {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
    } else {
      this.zoom = zoom;
      // lo spostamento non può portare il foglio fuori dal riquadro
      const limiteX = box.offsetWidth * (zoom - 1);
      const limiteY = box.offsetHeight * (zoom - 1);
      this.panX = Math.max(-limiteX, Math.min(0, panX));
      this.panY = Math.max(-limiteY, Math.min(0, panY));
    }
    box.style.transformOrigin = '0 0';
    box.style.transform = this.zoom === 1 ? '' : `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    document.querySelector('#notebook-zoom').textContent = this.zoom === 1 ? 'Vista di lavoro' : `Ingrandimento ${Math.round(this.zoom * 100)}%`;
  }

  azzeraZoom() {
    if (this.overview) this.group.setReadOnly(this.letturaPrimaOverview);
    this.overview = false;
    this.zoomDiLavoro = null;
    const bottone = document.querySelector('#notebook-overview');
    bottone.textContent = 'Foglio intero';
    bottone.setAttribute('aria-pressed', 'false');
    bottone.classList.remove('active');
    this.pinch = null;
    this.applicaZoom(1, 0, 0);
  }

  // Prepara un foglio (sfondo, contenuto, preferenza del dito e misura)
  mostraFoglio(wrap, canvas, surface, page) {
    for (const classe of Object.values(TIPI_FOGLIO)) wrap.classList.remove(classe);
    wrap.classList.add(TIPI_FOGLIO[this.current.tipo] || TIPI_FOGLIO.righe);
    const orientamento = orientamentoPagina(this.current.tipo, page);
    wrap.classList.toggle('orizzontale', orientamento === ORIENTAMENTI.orizzontale);
    wrap.dataset.orientamento = orientamento;
    const disegno = disegnoRigoPagina(this.current.tipo, page);
    if (disegno) wrap.dataset.disegnoRigo = String(disegno);
    else delete wrap.dataset.disegnoRigo;
    wrap.dataset.versioneGuide = String(versioneGuidePagina(this.current.tipo, page));
    surface.setElements(page ? (page.elementi || []) : []);
    // Come sui libri: la Pencil scrive e il dito scorre il foglio.
    surface.setDrawWithFinger(this.drawWithFinger);
    requestAnimationFrame(() => {
      if (wrap.offsetWidth) this.larghezzeFoglio[orientamento] = wrap.offsetWidth;
      this.soloRighiInteri(wrap);
      surface.resize();
    });
  }

  // Il CSS ripete il rigo fino in fondo al foglio, e l'ultimo restava tagliato
  // a una riga sola. Qui lo sfondo si ferma all'ultimo rigo che ci sta intero,
  // con la stessa regola dell'esportazione.
  soloRighiInteri(wrap) {
    if (!this.current) return;
    wrap.style.backgroundImage = '';
    if (Number(wrap.dataset.versioneGuide) === 2 && wrap.offsetWidth) {
      wrap.style.backgroundImage = sfondoGuide(this.current.tipo, wrap.offsetWidth);
      wrap.style.backgroundSize = '100% 100%';
      wrap.style.backgroundRepeat = 'no-repeat';
      return;
    }
    if (this.current?.tipo !== 'pentagramma' || !wrap.offsetHeight) {
      wrap.style.backgroundSize = '';
      wrap.style.backgroundRepeat = '';
      return;
    }
    if (Number(wrap.dataset.disegnoRigo) === DISEGNI_RIGO.proporzionale) {
      // disegno nuovo: righe calcolate sulla misura vera del foglio
      const geometria = geometriaRigo(DISEGNI_RIGO.proporzionale, wrap.offsetWidth, wrap.offsetHeight);
      wrap.style.backgroundImage = sfondoRigo(geometria);
      wrap.style.backgroundSize = '100% 100%';
      wrap.style.backgroundRepeat = 'no-repeat';
      return;
    }
    const righi = righiInteri(wrap.offsetHeight);
    wrap.style.backgroundSize = `100% ${righi * RIGO.passoRigo}px`;
    wrap.style.backgroundRepeat = 'no-repeat';
  }


  showPage() {
    if (this.overview) this.azzeraZoom();
    const pagina = this.pages[this.pageIndex];
    const guide = versioneGuidePagina(this.current.tipo, pagina);
    const misura = this.current.tipo === 'pentagramma' && orientamentoPagina(this.current.tipo, pagina) === 'orizzontale' ? 'A4 · 29,7 × 21 cm' : 'A4 · 21 × 29,7 cm';
    const riferimento = guide === 2 ? ({ righe: 'Righe 8 mm', quadretti: 'Quadretti 5 mm', millimetrato: 'Griglia 1 mm' }[this.current.tipo]) : guide === 1 ? 'Guide precedenti' : '';
    document.querySelector('#notebook-paper-measure').textContent = `${misura}${riferimento ? ' · ' + riferimento : ''}`;
    const totale = this.pages.length;
    document.querySelector('#notebook-pages').classList.toggle('doppia', this.doppia);

    // foglio sinistro (sempre)
    this.mostraFoglio(document.querySelector('#notebook-page-wrap'), this.canvas, this.surface, this.pages[this.pageIndex]);

    // foglio destro (solo in doppia e se esiste la pagina successiva)
    const wrap2 = document.querySelector('#notebook-page-wrap-2');
    const pagDx = this.doppia ? this.pages[this.pageIndex + 1] : null;
    wrap2.hidden = !pagDx;
    if (pagDx) this.mostraFoglio(wrap2, this.canvas2, this.surface2, pagDx);
    else this.surface2.setElements([]);

    // Due fogli orizzontali affiancati diventerebbero stretti e il rigo corto:
    // in doppia pagina si impilano, e ognuno tiene tutta la larghezza.
    const orizzontale = (page) => page && orientamentoPagina(this.current.tipo, page) === ORIENTAMENTI.orizzontale;
    const conOrizzontale = orizzontale(this.pages[this.pageIndex]) || orizzontale(pagDx);
    const riquadro = document.querySelector('#notebook-pages');
    riquadro.classList.toggle('ha-orizzontale', Boolean(conOrizzontale));
    riquadro.classList.toggle('impilata', this.doppia && Boolean(conOrizzontale));

    // etichetta e navigazione
    const label = document.querySelector('#notebook-page-label');
    if (this.doppia) {
      const conDx = this.pageIndex + 1 < totale;
      label.textContent = `Pagine ${this.pageIndex + 1}${conDx ? '-' + (this.pageIndex + 2) : ''} di ${totale}`;
      document.querySelector('#notebook-prev').disabled = this.pageIndex === 0;
      document.querySelector('#notebook-next').disabled = this.pageIndex + 2 >= totale;
    } else {
      label.textContent = `Pagina ${this.pageIndex + 1} di ${totale}`;
      document.querySelector('#notebook-prev').disabled = this.pageIndex === 0;
      document.querySelector('#notebook-next').disabled = this.pageIndex === totale - 1;
    }
  }

  toggleDoppia() {
    this.doppia = !this.doppia;
    this.azzeraZoom(); // cambia l'impaginazione: si riparte dalla misura naturale
    // in doppia l'indice di sinistra è sempre pari (coppie 1-2, 3-4, ...)
    if (this.doppia) this.pageIndex -= this.pageIndex % 2;
    const btn = document.querySelector('#notebook-two-pages');
    btn.textContent = this.doppia ? '1 pagina' : '2 pagine';
    btn.setAttribute('aria-pressed', String(this.doppia));
    btn.classList.toggle('active', this.doppia);
    this.showPage();
  }

  goTo(index) {
    if (this.doppia) index -= index % 2;
    if (index < 0 || index >= this.pages.length) return;
    this.pageIndex = index;
    this.showPage();
  }

  async savePage(offset, elements) {
    if (!this.current) return;
    const page = this.pages[this.pageIndex + offset];
    if (!page) return;
    const key = offset === 0 ? 'saveToken' : 'saveToken2';
    const token = ++this[key];
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (token !== this[key]) return;
    page.elementi = elements;
    await DB.put('paginequaderno', page);
  }

  async addPage() {
    const page = { id: createId('pagina'), idQuaderno: this.current.id, numero: this.pages.length + 1, elementi: [], orientamento: orientamentoNuovaPagina(this.current.tipo), ...campoDisegnoRigo(this.current.tipo), ...campoGuide(this.current.tipo), data: Date.now() };
    await DB.put('paginequaderno', page);
    this.pages.push(page);
    this.pageIndex = this.pages.length - 1;
    if (this.doppia) this.pageIndex -= this.pageIndex % 2;
    this.current.pagine = this.pages.length;
    await DB.put('quaderni', this.current);
    this.showPage();
  }

  async deletePage() {
    if (this.pages.length === 1) return this.notify('Un quaderno deve avere almeno una pagina.');
    if (!confirm(`Eliminare la pagina ${this.pageIndex + 1}?`)) return;
    await DB.delete('paginequaderno', this.pages[this.pageIndex].id);
    this.pages.splice(this.pageIndex, 1);
    this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1);
    if (this.doppia) this.pageIndex -= this.pageIndex % 2;
    for (let index = 0; index < this.pages.length; index += 1) {
      this.pages[index].numero = index + 1;
      await DB.put('paginequaderno', this.pages[index]);
    }
    this.current.pagine = this.pages.length;
    await DB.put('quaderni', this.current);
    this.showPage();
  }

  renderPageToCanvas(page) {
    const orientamento = orientamentoPagina(this.current.tipo, page);
    const { width, height } = misuraEsportazione(orientamento);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    drawPaper(context, this.current.tipo, canvas.width, canvas.height, this.larghezzeFoglio[orientamento], disegnoRigoPagina(this.current.tipo, page), versioneGuidePagina(this.current.tipo, page));
    // Stessa posa che si vede a schermo, evidenziatori compresi: l'immagine
    // esportata deve somigliare al foglio, non essere disegnata in altro modo.
    disegnaElementi(context, page.elementi || [], canvas.width, canvas.height, { pulisci: false });
    return canvas;
  }

  exportPage() {
    const canvas = this.renderPageToCanvas(this.pages[this.pageIndex]);
    canvas.toBlob((blob) => downloadBlob(blob, `${safeFilename(this.current.titolo)}-pagina-${this.pageIndex + 1}.png`), 'image/png');
  }

  async exportPdf() {
    this.showProgress('Creo il PDF del quaderno', 'Preparo le pagine…', 0);
    try {
      const images = [];
      for (let index = 0; index < this.pages.length; index += 1) {
        images.push(await canvasToJpeg(this.renderPageToCanvas(this.pages[index]), 0.9));
        this.showProgress('Creo il PDF del quaderno', `Pagina ${index + 1} di ${this.pages.length}`, (index + 1) / this.pages.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const bytes = makePdfFromJpegs(images);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${safeFilename(this.current.titolo)}.pdf`);
      this.notify('PDF del quaderno pronto.');
    } finally {
      this.hideProgress();
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}
