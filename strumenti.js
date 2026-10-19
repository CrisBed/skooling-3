// Motore vettoriale condiviso da libri e quaderni.
import { createId } from './db.js';
import { disegnaSegnoMusicale, ingombroSegno, segnoValido } from './musica.js';

export const COLORS = ['#1f2937', '#2457d6', '#db3a34', '#15956d', '#f0b429', '#8b5cf6', '#f472b6'];
export const WIDTHS = [2, 5, 10];
// L'evidenziatore e' molto piu' largo della penna: deve coprire una riga di
// testo in una passata sola, senza doverci tornare sopra due o tre volte.
// Tetto di pixel per una tela da disegno.
//
// Il foglio ingrandito cresce, e con lui la tela: a ingrandimento massimo si
// arrivava a 6300x7868, cioe' 49,6 milioni di pixel e circa 200 MB per la sola
// tela delle annotazioni. Su un iPad e' oltre il limite di Safari, che a quel
// punto smette di disegnare o rallenta tutto. In piu' e' lavoro sprecato: le
// scansioni dei libri sono da circa 2800 pixel di lato, quindi disegnarle su
// una tela di 6300 non aggiunge un solo dettaglio vero.
export const PIXEL_MASSIMI = 8_000_000;

// Quanti pixel per punto si possono usare su una superficie di quella misura
// senza sfondare il tetto.
export function risoluzioneAmmessa(larghezzaCss, altezzaCss, desiderata = 2) {
  const area = Math.max(1, larghezzaCss * altezzaCss);
  const massima = Math.sqrt(PIXEL_MASSIMI / area);
  return Math.max(0.5, Math.min(desiderata, massima));
}

export const INGROSSO_EVIDENZIATORE = 9;
// La trasparenza si da' una volta sola a tutta la posa, non a ogni tratto:
// vedi disegnaElementi qui sotto.
export const TINTA_EVIDENZIATORE = 0.3;
export const TEXT_SIZES = [16, 20, 24, 32, 40, 42, 56, 72];
export const TEXT_FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SFMono-Regular", Consolas, monospace',
};

export function normalizePoint(point, rect) {
  return {
    x: Math.min(1, Math.max(0, (point.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (point.clientY - rect.top) / rect.height)),
    pressure: point.pressure || 0.5,
    tiltX: point.tiltX || 0,
    tiltY: point.tiltY || 0,
  };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function hitTestElement(element, point, tolerance = 0.025) {
  if (element.tipo === 'simbolo') {
    const bordi = riquadroElemento(element);
    return point.x >= bordi.sinistra - tolerance && point.x <= bordi.destra + tolerance
      && point.y >= bordi.alto - tolerance && point.y <= bordi.basso + tolerance;
  }
  if (element.tipo === 'testo') {
    return point.x >= element.x - tolerance && point.x <= element.x + element.w + tolerance
      && point.y >= element.y - tolerance && point.y <= element.y + element.h + tolerance;
  }
  if (['rettangolo', 'cerchio'].includes(element.tipo)) {
    const left = Math.min(element.x1, element.x2);
    const right = Math.max(element.x1, element.x2);
    const top = Math.min(element.y1, element.y2);
    const bottom = Math.max(element.y1, element.y2);
    if (element.tipo === 'rettangolo') {
      const onVertical = Math.abs(point.x - left) <= tolerance || Math.abs(point.x - right) <= tolerance;
      const onHorizontal = Math.abs(point.y - top) <= tolerance || Math.abs(point.y - bottom) <= tolerance;
      return (onVertical && point.y >= top - tolerance && point.y <= bottom + tolerance)
        || (onHorizontal && point.x >= left - tolerance && point.x <= right + tolerance);
    }
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max((right - left) / 2, 0.001);
    const ry = Math.max((bottom - top) / 2, 0.001);
    const edge = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
    return Math.abs(edge - 1) <= tolerance / Math.max(rx, ry);
  }
  const points = element.punti ?? (element.x1 !== undefined
    ? [{ x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }]
    : []);
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= tolerance) return true;
  }
  return points.length === 1 && Math.hypot(point.x - points[0].x, point.y - points[0].y) <= tolerance;
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function interpolatePoint(start, end, amount) {
  const point = {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
  for (const key of ['pressure', 'tiltX', 'tiltY']) {
    if (start[key] !== undefined || end[key] !== undefined) {
      point[key] = (start[key] || 0) + ((end[key] || 0) - (start[key] || 0)) * amount;
    }
  }
  return point;
}

function splitFreehandStroke(element, eraserPoint, tolerance) {
  const points = element.punti || [];
  const hit = points.slice(1).some((point, index) => distanceToSegment(eraserPoint, points[index], point) <= tolerance);
  if (!hit) return null;

  const densePoints = points.length ? [points[0]] : [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / (tolerance / 2)));
    for (let step = 1; step <= steps; step += 1) densePoints.push(interpolatePoint(start, end, step / steps));
  }

  const chunks = [];
  let current = [];
  for (const point of densePoints) {
    if (Math.hypot(point.x - eraserPoint.x, point.y - eraserPoint.y) > tolerance) current.push(point);
    else if (current.length >= 2) { chunks.push(current); current = []; }
    else current = [];
  }
  if (current.length >= 2) chunks.push(current);
  return chunks.map((chunk, index) => ({ ...element, id: index ? createId('segno') : element.id, punti: chunk }));
}

function splitUnderline(element, eraserPoint, tolerance) {
  const pieces = splitFreehandStroke(
    { ...element, punti: [{ x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }] },
    eraserPoint,
    tolerance,
  );
  if (!pieces) return null;
  return pieces.map(({ punti, ...piece }) => ({
    ...piece,
    x1: punti[0].x,
    y1: punti[0].y,
    x2: punti.at(-1).x,
    y2: punti.at(-1).y,
  }));
}

// ---------------------------------------------------------------------------
// La gomma sulle forme geometriche.
//
// Un cerchio, un quadrato o una freccia sono oggetti interi: nel foglio c'e'
// scritto "un cerchio da qui a qui", non i tanti puntini che lo disegnano. Per
// questo la gomma prima li toglieva tutti d'un colpo, mentre sui tratti a mano
// libera toglie solo il pezzo toccato.
//
// La strada scelta: quando la gomma tocca davvero una forma, la forma viene
// RISCRITTA nei tratti che la disegnano, e da quel momento in poi si cancella
// esattamente come un segno di penna. Quel che resta ha la stessa forma di
// prima, stesso colore e stesso spessore: a vedersi non cambia niente, cambia
// solo di che cosa e' fatta.
//
// La conversione si paga una volta sola e solo sulla forma toccata: per questo
// prima si controlla con un conto semplice se la gomma ci e' sopra davvero.
// ---------------------------------------------------------------------------
export const FORME_TAGLIABILI = ['linea', 'freccia', 'cerchio', 'rettangolo'];
const PASSI_CERCHIO = 96;
const MISURA_PREDEFINITA = { larghezza: 1000, altezza: 1000 };

function trattoDaForma(element, punti, indice = 0) {
  return {
    id: indice ? createId('segno') : element.id,
    tipo: 'penna',
    colore: element.colore,
    spessore: element.spessore,
    timestamp: element.timestamp,
    punti,
  };
}

// La punta della freccia nel disegno e' lunga tanti pixel: qui va riportata
// alla misura del foglio, altrimenti su una tela alta e stretta verrebbe storta.
function lunghezzaPunta(element) { return 12 + (element.spessore || 2); }

export function convertiInTratti(element, misura = MISURA_PREDEFINITA) {
  if (element.tipo === 'cerchio') {
    const cx = (element.x1 + element.x2) / 2;
    const cy = (element.y1 + element.y2) / 2;
    const rx = Math.abs(element.x2 - element.x1) / 2;
    const ry = Math.abs(element.y2 - element.y1) / 2;
    const punti = [];
    for (let passo = 0; passo <= PASSI_CERCHIO; passo += 1) {
      const angolo = (passo / PASSI_CERCHIO) * Math.PI * 2;
      punti.push({ x: cx + rx * Math.cos(angolo), y: cy + ry * Math.sin(angolo) });
    }
    return [trattoDaForma(element, punti)];
  }
  if (element.tipo === 'rettangolo') {
    const sinistra = Math.min(element.x1, element.x2);
    const destra = Math.max(element.x1, element.x2);
    const alto = Math.min(element.y1, element.y2);
    const basso = Math.max(element.y1, element.y2);
    return [trattoDaForma(element, [
      { x: sinistra, y: alto }, { x: destra, y: alto }, { x: destra, y: basso },
      { x: sinistra, y: basso }, { x: sinistra, y: alto },
    ])];
  }
  const asta = [{ x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 }];
  if (element.tipo !== 'freccia') return [trattoDaForma(element, asta)];
  // Le due barbe della punta sono tratti per conto loro: cancellandone una,
  // l'altra resta dov'e'.
  const larghezza = Math.max(1, misura.larghezza);
  const altezza = Math.max(1, misura.altezza);
  const lunghezza = lunghezzaPunta(element);
  const angolo = Math.atan2((element.y2 - element.y1) * altezza, (element.x2 - element.x1) * larghezza);
  const barba = (scarto) => [
    { x: element.x2, y: element.y2 },
    {
      x: element.x2 - (lunghezza * Math.cos(angolo + scarto)) / larghezza,
      y: element.y2 - (lunghezza * Math.sin(angolo + scarto)) / altezza,
    },
  ];
  return [
    trattoDaForma(element, asta, 0),
    trattoDaForma(element, barba(-Math.PI / 6), 1),
    trattoDaForma(element, barba(Math.PI / 6), 2),
  ];
}

// Conto semplice: la gomma sta sulla forma? Serve a non riscrivere in tratti
// una figura che nessuno ha toccato.
function gommaSullaForma(element, punto, tolleranza, misura) {
  if (hitTestElement(element, punto, tolleranza)) return true;
  if (element.tipo !== 'freccia') return false;
  // La punta sporge fuori dall'asta: attorno al vertice il raggio si allarga.
  const raggio = lunghezzaPunta(element) / Math.max(1, Math.min(misura.larghezza, misura.altezza));
  return Math.hypot(punto.x - element.x2, punto.y - element.y2) <= raggio + tolleranza;
}

// Toglie dalla forma il pezzo toccato. Se la gomma non ne ha tolto niente
// restituisce null, e la forma resta l'oggetto intero che era.
export function tagliaForma(element, puntoGomma, tolleranza, misura = MISURA_PREDEFINITA) {
  if (!gommaSullaForma(element, puntoGomma, tolleranza, misura)) return null;
  const risultato = [];
  let tagliata = false;
  for (const tratto of convertiInTratti(element, misura)) {
    const pezzi = splitFreehandStroke(tratto, puntoGomma, tolleranza);
    if (pezzi) { tagliata = true; risultato.push(...pezzi); }
    else risultato.push(tratto);
  }
  return tagliata ? risultato : null;
}

export class HistoryStack {
  constructor(limit = 30) {
    this.limit = Math.max(20, limit);
    this.states = [];
    this.index = -1;
  }

  reset(state = []) {
    this.states = [clone(state)];
    this.index = 0;
  }

  // Ultimo stato salvato: serve per tornare indietro da un gesto annullato.
  current() {
    return this.states[this.index] ? clone(this.states[this.index]) : [];
  }

  push(state) {
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(clone(state));
    if (this.states.length > this.limit + 1) this.states.shift();
    this.index = this.states.length - 1;
  }

  undo() {
    if (this.index <= 0) return null;
    this.index -= 1;
    return clone(this.states[this.index]);
  }

  redo() {
    if (this.index >= this.states.length - 1) return null;
    this.index += 1;
    return clone(this.states[this.index]);
  }
}

function drawArrowHead(context, start, end, size) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

export function drawElement(context, element, width, height, selected = false) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = element.colore || COLORS[0];
  context.fillStyle = element.colore || COLORS[0];
  context.lineWidth = element.spessore || WIDTHS[0];

  if (element.tipo === 'evidenziatore') {
    // Un solo tratto continuo, non un segmento per volta: cosi' le giunture non
    // si sovrappongono e il colore resta uniforme dall'inizio alla fine.
    const points = element.punti || [];
    if (points.length) {
      context.lineWidth = (element.spessore || 2) * INGROSSO_EVIDENZIATORE;
      context.beginPath();
      context.moveTo(points[0].x * width, points[0].y * height);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x * width, points[index].y * height);
      }
      context.stroke();
    }
  } else if (element.tipo === 'penna') {
    const points = element.punti || [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      const pressure = (previous.pressure + point.pressure) / 2 || 0.5;
      context.lineWidth = (element.spessore || 2) * (0.65 + pressure * 0.7);
      context.beginPath();
      context.moveTo(previous.x * width, previous.y * height);
      context.lineTo(point.x * width, point.y * height);
      context.stroke();
    }
  } else if (element.tipo === 'simbolo') {
    // L'unita' del segno e' una frazione dell'altezza del foglio: cosi' un
    // segno resta della stessa misura anche se il foglio si ingrandisce.
    disegnaSegnoMusicale(context, element.segno, element.x * width, element.y * height, (element.unita || 0.02) * height, element.colore || COLORS[0]);
  } else if (element.tipo === 'testo') {
    const x = element.x * width;
    const y = element.y * height;
    const boxWidth = element.w * width;
    const boxHeight = element.h * height;
    const fontSize = element.dimensioneTesto
      ? Math.max(10, element.dimensioneTesto * (height / 1000))
      : Math.max(14, (element.spessore || 5) * 4);
    const fontFamily = TEXT_FONTS[element.carattere] || TEXT_FONTS.sans;
    const fontStyle = element.corsivo ? 'italic ' : '';
    const fontWeight = element.grassetto ? '700 ' : '';
    context.font = `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`;
    context.textBaseline = 'top';
    const alignment = ['left', 'center', 'right'].includes(element.allineamento) ? element.allineamento : 'left';
    context.textAlign = alignment;
    const textX = alignment === 'center' ? x + boxWidth / 2 : alignment === 'right' ? x + boxWidth - 4 : x + 4;
    const words = (element.testo || '').split(/\s+/);
    let line = '';
    let lineY = y + 4;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > boxWidth - 8 && line) {
        context.fillText(line, textX, lineY);
        line = word;
        lineY += fontSize * 1.25;
      } else line = candidate;
    }
    context.fillText(line, textX, lineY);
    if (selected) {
      context.globalAlpha = 1;
      context.strokeStyle = '#2457d6';
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.strokeRect(x, y, boxWidth, boxHeight);
      context.setLineDash([]);
      context.fillStyle = '#2457d6';
      context.fillRect(x + boxWidth - 7, y + boxHeight - 7, 14, 14);
    }
  } else {
    const x1 = element.x1 * width;
    const y1 = element.y1 * height;
    const x2 = element.x2 * width;
    const y2 = element.y2 * height;
    context.beginPath();
    if (element.tipo === 'cerchio') {
      context.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    } else if (element.tipo === 'rettangolo') {
      context.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else {
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
    }
    context.stroke();
    if (element.tipo === 'freccia') drawArrowHead(context, { x: x1, y: y1 }, { x: x2, y: y2 }, 12 + element.spessore);
  }
  // Un segno o una figura scelti si vedono con un riquadro tratteggiato: il
  // testo ha gia' il suo, disegnato insieme alla casella.
  if (selected && element.tipo !== 'testo') disegnaRiquadroSelezione(context, element, width, height);
  context.restore();
}

// Il riquadro tratteggiato che dice quale segno e' stato scelto.
export function disegnaRiquadroSelezione(context, element, width, height) {
  const bordi = riquadroElemento(element);
  if (!bordi) return;
  context.save();
  context.globalAlpha = 1;
  context.strokeStyle = '#2457d6';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  const margine = 0.012;
  context.strokeRect(
    (bordi.sinistra - margine) * width, (bordi.alto - margine) * height,
    (bordi.destra - bordi.sinistra + margine * 2) * width,
    (bordi.basso - bordi.alto + margine * 2) * height,
  );
  context.setLineDash([]);
  // Le quattro maniglie: si tirano per ingrandire o rimpicciolire.
  const lato = LATO_MANIGLIA * Math.min(width, height);
  context.fillStyle = '#ffffff';
  for (const maniglia of maniglieElemento(element)) {
    const x = maniglia.x * width - lato / 2;
    const y = maniglia.y * height - lato / 2;
    context.fillRect(x, y, lato, lato);
    context.strokeRect(x, y, lato, lato);
  }
  context.restore();
}

function creaFoglioDiLavoro(width, height) {
  const foglio = document.createElement('canvas');
  foglio.width = width;
  foglio.height = height;
  return foglio;
}

// Disegna tutti i segni di una pagina.
//
// Gli evidenziatori vanno prima su un foglio a parte, a tinta piena, e poi si
// posano tutti insieme in trasparenza. E' questo che impedisce al colore di
// scurirsi quando si ripassa: due passate sullo stesso punto restano della
// stessa tinta della prima, come con un evidenziatore vero. Per lo stesso
// motivo stanno sotto ai segni di penna, che cosi' restano leggibili.
export function disegnaElementi(context, elements, width, height, opzioni = {}) {
  const { selectedId = null, saltaId = null, creaFoglio = creaFoglioDiLavoro, pulisci = true } = opzioni;
  // Sul foglio del quaderno lo sfondo e' gia' disegnato: li' non si pulisce.
  if (pulisci) context.clearRect(0, 0, width, height);
  const visibili = elements.filter((element) => element.id !== saltaId);
  const evidenziatori = visibili.filter((element) => element.tipo === 'evidenziatore');

  if (evidenziatori.length) {
    const foglio = creaFoglio(width, height);
    const pennello = foglio.getContext('2d');
    for (const element of evidenziatori) drawElement(pennello, element, width, height, false);
    context.save();
    context.globalAlpha = TINTA_EVIDENZIATORE;
    context.drawImage(foglio, 0, 0);
    context.restore();
    for (const element of evidenziatori) {
      if (element.id === selectedId) disegnaRiquadroSelezione(context, element, width, height);
    }
  }

  for (const element of visibili) {
    if (element.tipo === 'evidenziatore') continue;
    drawElement(context, element, width, height, element.id === selectedId);
  }
}

// I quattro lati di un elemento, in coordinate del foglio (da 0 a 1).
export function riquadroElemento(element) {
  if (element.tipo === 'simbolo') {
    const ingombro = ingombroSegno(element.segno);
    const unita = element.unita || 0.02;
    // i segni salvati prima di `unitaX` restano come erano
    const unitaX = element.unitaX || unita;
    return {
      sinistra: element.x - unitaX * (ingombro.sinistra + 0.3),
      destra: element.x + unitaX * (ingombro.destra + 0.3),
      alto: element.y - unita * (ingombro.sopra + 0.3),
      basso: element.y + unita * (ingombro.sotto + 0.3),
    };
  }
  if (element.tipo === 'testo') {
    return { sinistra: element.x, destra: element.x + element.w, alto: element.y, basso: element.y + element.h };
  }
  const punti = element.punti ?? (element.x1 === undefined ? [] : [
    { x: element.x1, y: element.y1 }, { x: element.x2, y: element.y2 },
  ]);
  if (!punti.length) return null;
  return {
    sinistra: Math.min(...punti.map((punto) => punto.x)),
    destra: Math.max(...punti.map((punto) => punto.x)),
    alto: Math.min(...punti.map((punto) => punto.y)),
    basso: Math.max(...punti.map((punto) => punto.y)),
  };
}

// Le quattro maniglie agli angoli di un elemento scelto, in coordinate del
// foglio. Si prendono per ingrandirlo o rimpicciolirlo.
export const LATO_MANIGLIA = 0.016;
export function maniglieElemento(element) {
  const bordi = riquadroElemento(element);
  if (!bordi) return [];
  return [
    { angolo: 'alto-sinistra', x: bordi.sinistra, y: bordi.alto },
    { angolo: 'alto-destra', x: bordi.destra, y: bordi.alto },
    { angolo: 'basso-sinistra', x: bordi.sinistra, y: bordi.basso },
    { angolo: 'basso-destra', x: bordi.destra, y: bordi.basso },
  ];
}

// Quale maniglia si sta toccando, se se ne tocca una.
export function maniglieSotto(element, punto, tolleranza = 0.035) {
  for (const maniglia of maniglieElemento(element)) {
    if (Math.abs(punto.x - maniglia.x) <= tolleranza && Math.abs(punto.y - maniglia.y) <= tolleranza) return maniglia;
  }
  return null;
}

// I nuovi bordi dopo aver trascinato una maniglia: l'angolo opposto resta
// fermo, come quando si tira l'angolo di un foglio.
export function bordiTrascinando(bordi, angolo, punto, minimo = 0.03) {
  const nuovi = { ...bordi };
  if (angolo.includes('sinistra')) nuovi.sinistra = Math.min(punto.x, bordi.destra - minimo);
  else nuovi.destra = Math.max(punto.x, bordi.sinistra + minimo);
  if (angolo.includes('alto')) nuovi.alto = Math.min(punto.y, bordi.basso - minimo);
  else nuovi.basso = Math.max(punto.y, bordi.alto + minimo);
  // niente esce dal foglio
  nuovi.sinistra = Math.max(0, nuovi.sinistra);
  nuovi.alto = Math.max(0, nuovi.alto);
  nuovi.destra = Math.min(1, nuovi.destra);
  nuovi.basso = Math.min(1, nuovi.basso);
  return nuovi;
}

// Ridisegna un elemento dentro bordi nuovi. Ogni punto si sposta in proporzione,
// cosi' la forma resta quella: e' l'unico modo perche' funzioni allo stesso modo
// su un tratto a mano libera, su una figura, su una casella di testo e su un
// simbolo musicale.
export function ridimensionaElemento(element, originale, bordiNuovi) {
  const vecchi = riquadroElemento(originale);
  if (!vecchi) return element;
  const larghezzaVecchia = vecchi.destra - vecchi.sinistra;
  const altezzaVecchia = vecchi.basso - vecchi.alto;
  // Un segno piatto (una sottolineatura, una riga orizzontale) non ha altezza da
  // scalare: si sposta e basta lungo quell'asse.
  const fattoreX = larghezzaVecchia > 0.001 ? (bordiNuovi.destra - bordiNuovi.sinistra) / larghezzaVecchia : 1;
  const fattoreY = altezzaVecchia > 0.001 ? (bordiNuovi.basso - bordiNuovi.alto) / altezzaVecchia : 1;
  const perX = (x) => bordiNuovi.sinistra + (x - vecchi.sinistra) * fattoreX;
  const perY = (y) => bordiNuovi.alto + (y - vecchi.alto) * fattoreY;

  if (originale.tipo === 'testo') {
    element.x = perX(originale.x);
    element.y = perY(originale.y);
    element.w = Math.max(0.05, originale.w * fattoreX);
    element.h = Math.max(0.03, originale.h * fattoreY);
  } else if (originale.tipo === 'simbolo') {
    element.x = perX(originale.x);
    element.y = perY(originale.y);
    // un simbolo resta sé stesso: cresce in modo uguale nei due versi
    const fattore = (fattoreX + fattoreY) / 2;
    element.unita = Math.max(0.004, (originale.unita || 0.016) * fattore);
    if (originale.unitaX) element.unitaX = originale.unitaX * element.unita / (originale.unita || 0.016);
  } else if (originale.punti) {
    element.punti = originale.punti.map((p) => ({ ...p, x: perX(p.x), y: perY(p.y) }));
  } else {
    element.x1 = perX(originale.x1);
    element.y1 = perY(originale.y1);
    element.x2 = perX(originale.x2);
    element.y2 = perY(originale.y2);
  }
  return element;
}

// Sposta un elemento gia' disegnato. Lo spostamento si calcola sempre dalla
// posizione di partenza, cosi' il segno non scivola via accumulando errori, e
// si accorcia quanto serve perche' l'elemento non esca dal foglio.
export function spostaElemento(element, originale, dx, dy) {
  const bordi = riquadroElemento(originale);
  if (!bordi) return element;
  const passoX = Math.max(-bordi.sinistra, Math.min(1 - bordi.destra, dx));
  const passoY = Math.max(-bordi.alto, Math.min(1 - bordi.basso, dy));
  if (originale.tipo === 'testo' || originale.tipo === 'simbolo') {
    element.x = originale.x + passoX;
    element.y = originale.y + passoY;
  } else if (originale.punti) {
    element.punti = originale.punti.map((punto) => ({ ...punto, x: punto.x + passoX, y: punto.y + passoY }));
  } else {
    element.x1 = originale.x1 + passoX;
    element.y1 = originale.y1 + passoY;
    element.x2 = originale.x2 + passoX;
    element.y2 = originale.y2 + passoY;
  }
  return element;
}

// Stato del gesto a due dita, condiviso da più fogli affiancati: le due dita
// possono cadere su fogli diversi (doppia pagina) e devono comunque contare
// come un solo gesto. `touches` tiene i tocchi vivi in coordinate schermo.
export function creaGestoCondiviso() {
  return { touches: new Map(), attivo: false, fogli: [] };
}

// Fra i puntatori del gesto contano come dita solo quelle vere: in sola lettura
// anche la penna diventa un gesto, ma due punte non devono valere per un
// ingrandimento a due dita.
export function ditaAppoggiate(touches) {
  return [...touches.values()].filter((punto) => (punto.tipo ?? 'touch') === 'touch');
}

// Sfioramento orizzontale per cambiare pagina. Guarda le dita appoggiate sul
// foglio e risponde soltanto a un movimento netto di lato, così chi scrive o
// chi ingrandisce non cambia pagina per sbaglio: un segno di penna resta corto
// o va in tutte le direzioni, e un ingrandimento apre o chiude le dita.
export function creaRilevatoreSwipe(opzioni = {}) {
  const distanzaMinima = opzioni.distanzaMinima ?? 70;        // px percorsi di lato
  const quantoOrizzontale = opzioni.quantoOrizzontale ?? 1.8; // quanto più di lato che in alto
  const durataMassima = opzioni.durataMassima ?? 900;         // ms: è uno sfioramento, non un trascinamento
  const aperturaAmmessa = opzioni.aperturaAmmessa ?? 45;      // px di apertura fra due dita
  const adesso = opzioni.adesso ?? (() => Date.now());
  let traccia = null;

  const misura = (touches) => {
    const dita = [...touches.values()];
    return {
      numero: dita.length,
      posizioni: dita.map((dito) => ({ x: dito.x, y: dito.y })),
      apertura: dita.length >= 2 ? Math.hypot(dita[0].x - dita[1].x, dita[0].y - dita[1].y) : 0,
    };
  };

  const media = (posizioni, asse) => posizioni.reduce((somma, punto) => somma + punto[asse], 0) / posizioni.length;

  return {
    // Ogni dito che si appoggia ricomincia la misura: il gesto vero parte da
    // quando tutte le dita sono a terra.
    inizio(touches) {
      const stato = misura(touches);
      if (!stato.numero) { traccia = null; return; }
      traccia = {
        numero: stato.numero,
        partenza: stato.posizioni.map((punto) => ({ ...punto })),
        posizioni: stato.posizioni,
        apertura: stato.apertura,
        tempo: adesso(),
        scartoMassimo: 0,
      };
    },

    muovi(touches) {
      if (!traccia) return;
      const stato = misura(touches);
      if (stato.numero !== traccia.numero) { traccia = null; return; }
      // Quanto si sono allontanate o avvicinate le dita rispetto alla partenza.
      // Il movimento di ogni dito arriva in un momento suo, quindi durante uno
      // sfioramento la distanza fra le due oscilla: qui si tiene solo lo scarto
      // più grande, e il giudizio si dà alla fine.
      if (traccia.numero >= 2) {
        traccia.scartoMassimo = Math.max(traccia.scartoMassimo, Math.abs(stato.apertura - traccia.apertura));
      }
      traccia.posizioni = stato.posizioni;
    },

    // Risponde -1 per la pagina precedente, +1 per la successiva, 0 se non era
    // uno sfioramento. Va chiamato quando il primo dito si stacca.
    fine(touches) {
      const corsa = traccia;
      traccia = null;
      if (!corsa) return 0;
      if (adesso() - corsa.tempo > durataMassima) return 0;
      const stato = misura(touches);
      if (stato.numero !== corsa.numero) return 0;
      if (corsa.numero >= 2) {
        // Alla fine le dita sono distanti come all'inizio: sono andate insieme.
        // Se invece si sono aperte o chiuse, anche solo a metà strada, era un
        // ingrandimento e la pagina non deve cambiare.
        if (Math.abs(stato.apertura - corsa.apertura) > aperturaAmmessa) return 0;
        if (corsa.scartoMassimo > aperturaAmmessa * 3) return 0;
      }
      const dx = media(corsa.posizioni, 'x') - media(corsa.partenza, 'x');
      const dy = media(corsa.posizioni, 'y') - media(corsa.partenza, 'y');
      if (Math.abs(dx) < distanzaMinima) return 0;
      if (Math.abs(dx) < Math.abs(dy) * quantoOrizzontale) return 0;
      // Tutte le dita devono andare dalla stessa parte: due dita che vanno in
      // versi opposti stanno ingrandendo o ruotando.
      for (let indice = 0; indice < corsa.numero; indice += 1) {
        const passo = corsa.posizioni[indice].x - corsa.partenza[indice].x;
        if (Math.sign(passo) !== Math.sign(dx) || Math.abs(passo) < distanzaMinima / 2) return 0;
      }
      return dx < 0 ? 1 : -1; // dito verso sinistra: pagina successiva
    },

    annulla() { traccia = null; },
  };
}

// La casella di testo può essere già stata tolta dal foglio: toglierla di nuovo
// non deve fermare l'app.
function togliDalFoglio(elemento) {
  try { elemento.remove(); } catch { /* già tolta */ }
}

export class DrawingSurface {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    // Su iPad i Touch Events stylus hanno superato la prova hardware dei
    // contatti rapidi, mentre i Pointer Events perdevano puntini e lettere.
    // Scegliere un solo flusso prima del primo contatto evita tratti doppi.
    const nav = globalThis.navigator;
    this.preferStylusTouch = options.preferStylusTouch ?? Boolean(nav &&
      (/iPad/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)));

    this.context = canvas.getContext('2d');
    this.elements = [];
    this.tool = 'penna';
    this.color = COLORS[1];
    this.width = WIDTHS[1];
    this.readOnly = false;
    this.drawWithFinger = false;
    this.textDraft = {
      testo: '', colore: COLORS[1], dimensioneTesto: 24, carattere: 'sans',
      grassetto: false, corsivo: false, allineamento: 'left',
    };
    this.active = null;
    this.selectedId = null;
    this.editingId = null;   // id della casella di testo aperta per scriverci
    this.textEditor = null;  // l'elemento HTML editabile in-place (apre la tastiera grande)
    this.pointers = new Map();
    // Quale segno musicale si sta appoggiando, e come incollarlo alla riga del
    // rigo: nei quaderni a pentagramma ci pensa il quaderno.
    this.segnoMusicale = 'semiminima';
    this.agganciaY = options.agganciaY || ((y) => y);
    // Quanto grande viene un segno musicale, in frazione di foglio. Nei quaderni
    // a pentagramma vale esattamente il passo fra due righe del rigo: un segno
    // piu' grande del rigo su cui appoggia si vede subito che e' sbagliato.
    this.unitaMusicale = options.unitaMusicale || (() => 0.016);
    this.gesto = options.gesto || creaGestoCondiviso();
    this.gesto.fogli.push(this);
    this.history = new HistoryStack(30);
    this.history.reset([]);
    this.onChange = options.onChange || (() => {});
    this.onTouchGesture = options.onTouchGesture || (() => {});
    this.onTextRequired = options.onTextRequired || (() => {});
    this.onTextSelection = options.onTextSelection || (() => {});
    this.onActivate = options.onActivate || (() => {}); // "sono io il foglio su cui si scrive"
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    for (const [type, method] of Object.entries({
      pointerdown: 'pointerDown', pointermove: 'pointerMove',
      pointerup: 'pointerUp', pointercancel: 'pointerUp',
    })) {
      this.canvas.addEventListener(type, (event) => {
        if (this.preferStylusTouch && event.pointerType === 'pen') return;
        this[method](event);
      });
    }
    for (const [type, method] of Object.entries({
      touchstart: 'pointerDown', touchmove: 'pointerMove',
      touchend: 'pointerUp', touchcancel: 'pointerUp',
    })) {
      this.canvas.addEventListener(type, (event) => {
        if (!this.preferStylusTouch) return;
        for (const touch of event.changedTouches) {
          // Le dita restano nel flusso Pointer Events per zoom e spostamento.
          if (touch.touchType !== 'stylus') continue;
          this[method]({
            pointerType: 'pen', pointerId: `stylus:${touch.identifier}`,
            clientX: touch.clientX, clientY: touch.clientY,
            pressure: touch.force, fromStylusTouch: true,
            preventDefault: () => event.preventDefault(),
          });
        }
      }, { passive: false });
    }
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  resize() {
    // Misura di impaginazione, non quella a schermo: se il foglio è ingrandito
    // con una trasformazione CSS la risoluzione del canvas non deve cambiare.
    const rect = this.canvas.getBoundingClientRect();
    const width = this.canvas.offsetWidth || rect.width;
    const height = this.canvas.offsetHeight || rect.height;
    if (!width || !height) return;
    const ratio = risoluzioneAmmessa(width, height, Math.min(2, globalThis.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.render();
  }

  setElements(elements = []) {
    this.scartaEditorTesto(); // cambio pagina: la casella aperta non deve restare appesa
    this.elements = clone(elements);
    this.selectedId = null;
    this.history.reset(this.elements);
    this.render();
  }

  setTool(tool) { this.readOnly = false; this.tool = tool; this.selectedId = null; this.render(); }
  setColor(color) {
    this.color = color;
    if (this.tool === 'testo') this.textDraft = { ...this.textDraft, colore: color };
  }
  setWidth(width) { this.width = Number(width); }
  setSegnoMusicale(segno) { if (segnoValido(segno)) this.segnoMusicale = segno; }
  setReadOnly(value) { this.readOnly = Boolean(value); }
  setDrawWithFinger(value) { this.drawWithFinger = Boolean(value); }

  // Misura in pixel della tela: la gomma ne ha bisogno per riportare al foglio
  // la punta della freccia, che nel disegno e' larga tanti pixel.
  misuraFoglio() {
    return { larghezza: this.canvas.width || 1000, altezza: this.canvas.height || 1000 };
  }

  eraseAt(point) {
    // La gomma toglie quel che tocca davvero, non un'area larga attorno: il
    // raggio segue lo spessore scelto e resta vicino a quello della penna.
    const tolerance = Math.max(0.004, this.width / 700);
    const misura = this.misuraFoglio();
    let changed = false;
    const next = [];
    for (const element of this.elements) {
      if (['penna', 'evidenziatore'].includes(element.tipo)) {
        const pieces = splitFreehandStroke(element, point, tolerance);
        if (pieces) { changed = true; next.push(...pieces); }
        else next.push(element);
      } else if (element.tipo === 'sottolineatura') {
        const pieces = splitUnderline(element, point, tolerance);
        if (pieces) { changed = true; next.push(...pieces); }
        else next.push(element);
      } else if (FORME_TAGLIABILI.includes(element.tipo)) {
        // Cerchi, quadrati, righe e frecce si cancellano a pezzi come i tratti
        // a mano libera: la parte toccata sparisce, il resto resta.
        const pieces = tagliaForma(element, point, tolerance, misura);
        if (pieces) { changed = true; next.push(...pieces); }
        else next.push(element);
      } else if (hitTestElement(element, point, tolerance)) changed = true;
      else next.push(element);
    }
    if (changed) this.elements = next;
    return changed;
  }

  eraseBetween(start, end) {
    const tolerance = Math.max(0.004, this.width / 700);
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / (tolerance / 2)));
    let changed = false;
    for (let step = 1; step <= steps; step += 1) {
      changed = this.eraseAt(interpolatePoint(start, end, step / steps)) || changed;
    }
    return changed;
  }

  setTextDraft(draft = {}) {
    this.textDraft = { ...this.textDraft, ...draft };
  }

  updateSelectedText(draft = this.textDraft) {
    const element = this.elements.find((item) => item.id === this.selectedId && item.tipo === 'testo');
    const text = draft.testo?.trim();
    if (!element || !text) return false;
    Object.assign(element, {
      testo: text,
      colore: draft.colore || element.colore || this.color,
      dimensioneTesto: Number(draft.dimensioneTesto) || element.dimensioneTesto || 24,
      carattere: TEXT_FONTS[draft.carattere] ? draft.carattere : (element.carattere || 'sans'),
      grassetto: Boolean(draft.grassetto),
      corsivo: Boolean(draft.corsivo),
      allineamento: ['left', 'center', 'right'].includes(draft.allineamento) ? draft.allineamento : 'left',
    });
    this.textDraft = { ...this.textDraft, ...draft, testo: text };
    this.commit();
    return true;
  }

  // La casella di testo su cui agiscono i comandi dell'astuccio: quella aperta
  // per scriverci, altrimenti l'ultima scelta.
  testoCorrente() {
    const id = this.editingId || this.selectedId;
    if (!id) return null;
    return this.elements.find((item) => item.id === id && item.tipo === 'testo') || null;
  }

  // Cambia misura, grassetto e corsivo della casella: il testo scritto non si
  // tocca. Vale per tutta la casella, che e' il modo che regge senza sorprese:
  // meta' parola in grassetto vorrebbe un testo a pezzi, e la casella nasce
  // proprio per tenere una frase intera.
  // Cambia solo quel che le si passa: chi tocca il colore non deve trovarsi
  // cambiata anche la misura.
  applicaStileTesto(stile = {}) {
    const element = this.testoCorrente();
    if (!element) return false;
    if (stile.dimensioneTesto !== undefined) element.dimensioneTesto = Number(stile.dimensioneTesto) || element.dimensioneTesto || 24;
    if (stile.carattere !== undefined && TEXT_FONTS[stile.carattere]) element.carattere = stile.carattere;
    if (stile.grassetto !== undefined) element.grassetto = Boolean(stile.grassetto);
    if (stile.corsivo !== undefined) element.corsivo = Boolean(stile.corsivo);
    if (stile.colore !== undefined) element.colore = stile.colore;
    this.vestiEditorTesto(element);
    this.commit();
    return true;
  }

  // Se la casella e' aperta per scriverci, lo stile si vede subito anche li':
  // quel che si scrive deve avere l'aspetto di quel che resta sul foglio.
  vestiEditorTesto(element) {
    const editor = this.textEditor;
    if (!editor || this.editingId !== element.id) return;
    const altezza = this.canvas.getBoundingClientRect().height || 1000;
    editor.style.fontSize = `${Math.max(12, (element.dimensioneTesto || 24) * altezza / 1000)}px`;
    editor.style.fontFamily = TEXT_FONTS[element.carattere] || TEXT_FONTS.sans;
    editor.style.fontWeight = element.grassetto ? '700' : '400';
    editor.style.fontStyle = element.corsivo ? 'italic' : 'normal';
  }

  canDraw(event) {
    return !this.readOnly && (event.pointerType === 'pen' || event.pointerType === 'mouse' || this.drawWithFinger);
  }

  pointFromEvent(event) { return normalizePoint(event, this.canvas.getBoundingClientRect()); }

  // Due dita sono sempre un gesto. Un puntatore solo è un gesto quando con
  // quello non si disegna: il dito quando non deve scrivere, e qualunque punta
  // in sola lettura, dove si sfoglia e si scorre soltanto. Se invece con quella
  // punta si disegna, il gesto non la tocca: la penna deve scrivere sempre,
  // anche a foglio ingrandito.
  inGesto(event) {
    return this.gesto.attivo || !this.canDraw(event);
  }

  // Il secondo dito trasforma il tocco in gesto: il segno appena cominciato
  // viene tolto, così l'ingrandimento non lascia scarabocchi sul foglio.
  annullaTrattoInCorso() {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (active.kind === 'erase') this.elements = this.history.current();
    else if (active.kind === 'move-text') {
      const element = this.elements.find((item) => item.id === active.id);
      if (element) Object.assign(element, active.original);
    } else if (active.id) {
      this.elements = this.elements.filter((item) => item.id !== active.id);
      if (this.selectedId === active.id) this.selectedId = null;
    }
    this.render();
  }

  pointerDown(event) {
    // Nella mappa del gesto entrano sempre le dita, perché il secondo dito deve
    // poter fermare un tratto e far partire l'ingrandimento, e ci entrano le
    // punte con cui in questo momento non si disegna, per esempio la penna in
    // sola lettura, che così sfoglia.
    if (event.pointerType === 'touch' || !this.canDraw(event)) {
      this.gesto.touches.set(event.pointerId, { x: event.clientX, y: event.clientY, tipo: event.pointerType });
    }
    this.pointers.set(event.pointerId, this.pointFromEvent(event));
    if (this.textEditor) { this.textEditor.blur(); return; } // il tocco conferma/chiude la casella aperta
    if (event.pointerType === 'touch' && ditaAppoggiate(this.gesto.touches).length >= 2 && !this.gesto.attivo) {
      this.gesto.attivo = true;
      for (const foglio of this.gesto.fogli) foglio.annullaTrattoInCorso();
    }
    if (this.inGesto(event)) {
      this.onTouchGesture('start', event, this.gesto.touches);
      return;
    }
    if (!this.canDraw(event)) return;
    this.onActivate(); // questo foglio diventa quello attivo per astuccio, testo e annulla
    event.preventDefault();
    // Se il puntatore è già stato rilasciato la cattura non serve e non deve
    // interrompere il tratto: si prosegue senza.
    try { if (!event.fromStylusTouch) this.canvas.setPointerCapture?.(event.pointerId); } catch { /* puntatore già chiuso */ }
    const point = this.pointFromEvent(event);
    if (this.tool === 'simbolo') {
      const element = {
        id: createId('segno'), tipo: 'simbolo', segno: this.segnoMusicale,
        x: point.x, y: this.agganciaY(point.y),
        unita: this.unitaMusicale(), colore: this.color, timestamp: Date.now(),
      };
      // `unita` e' una frazione dell'altezza del foglio. Per i bordi in
      // orizzontale serve la stessa misura in frazione della larghezza, che
      // su un foglio orizzontale e' molto diversa.
      const larghezza = this.canvas.offsetWidth;
      const altezza = this.canvas.offsetHeight;
      if (larghezza && altezza) element.unitaX = element.unita * altezza / larghezza;
      this.elements.push(element);
      this.selectedId = element.id;
      this.render();
      this.commit();
      return;
    }
    if (this.tool === 'sposta') {
      // Prima si guarda se si sta tirando una maniglia di quel che è già scelto:
      // in quel caso non si sposta, si ridimensiona.
      const giaScelto = this.elements.find((item) => item.id === this.selectedId);
      const maniglia = giaScelto ? maniglieSotto(giaScelto, point) : null;
      if (maniglia) {
        this.active = {
          kind: 'resize-element', id: giaScelto.id, angolo: maniglia.angolo, start: point,
          original: clone(giaScelto), bordi: riquadroElemento(giaScelto), changed: false,
        };
        return;
      }
      // Altrimenti si prende l'elemento più in alto sotto il dito e lo si porta
      // altrove. Misura e contenuto non cambiano: cambia solo dove sta.
      const scelto = [...this.elements].reverse().find((item) => hitTestElement(item, point, 0.03));
      this.selectedId = scelto ? scelto.id : null;
      this.active = scelto
        ? { kind: 'move-element', id: scelto.id, start: point, original: clone(scelto), moved: false }
        : null;
      this.render();
      return;
    }
    if (this.tool === 'gomma') {
      this.active = { kind: 'erase', last: point, changed: this.eraseAt(point) };
      this.render();
      return;
    }
    if (this.tool === 'testo') {
      const existing = [...this.elements].reverse().find((item) => item.tipo === 'testo' && hitTestElement(item, point, 0.02));
      if (existing) {
        // tocco una casella: mi preparo a spostarla; se non trascino (tap) la apro per scriverci
        this.selectedId = existing.id;
        this.active = { kind: 'move-text', id: existing.id, start: point, original: clone(existing), moved: false };
        this.onTextSelection(clone(existing)); // l'astuccio mostra lo stile di questa casella
        this.render();
        return;
      }
      // punto vuoto: creo la casella qui e la apro subito per scrivere (tastiera grande, come Anteprima)
      const element = {
        id: createId('segno'), tipo: 'testo', testo: '',
        x: Math.max(0, Math.min(0.92, point.x)),
        y: Math.max(0, Math.min(0.94, point.y)),
        // Una casella in cui ci sta una frase, non una parola sola.
        w: 0.62, h: 0.18,
        colore: this.color,
        // Misura e stile sono quelli scelti nell'astuccio: una casella nuova
        // nasce gia' come si vuole, senza doverla ritoccare ogni volta.
        dimensioneTesto: this.dimensioneTestoScelta(),
        carattere: TEXT_FONTS[this.textDraft.carattere] ? this.textDraft.carattere : 'sans',
        grassetto: Boolean(this.textDraft.grassetto),
        corsivo: Boolean(this.textDraft.corsivo),
        allineamento: ['left', 'center', 'right'].includes(this.textDraft.allineamento) ? this.textDraft.allineamento : 'left',
        timestamp: Date.now(),
      };
      this.elements.push(element);
      this.selectedId = element.id;
      this.render();
      this.apriEditorTesto(element);
      return;
    }
    const base = { id: createId('segno'), tipo: this.tool, colore: this.color, spessore: this.width, timestamp: Date.now() };
    if (['penna', 'evidenziatore'].includes(this.tool)) base.punti = [point];
    else Object.assign(base, { x1: point.x, y1: point.y, x2: point.x, y2: point.y });
    this.active = base;
    this.elements.push(base);
    this.render();
  }

  pointerMove(event) {
    const point = this.pointFromEvent(event);
    if (this.gesto.touches.has(event.pointerId)) {
      this.gesto.touches.set(event.pointerId, { x: event.clientX, y: event.clientY, tipo: event.pointerType });
    }
    this.pointers.set(event.pointerId, point);
    if (this.inGesto(event)) {
      this.onTouchGesture('move', event, this.gesto.touches);
      return;
    }
    if (!this.active || !this.canDraw(event)) return;
    event.preventDefault();
    if (this.active.kind === 'erase') {
      this.active.changed = this.eraseBetween(this.active.last, point) || this.active.changed;
      this.active.last = point;
    } else if (this.active.kind) {
      const element = this.elements.find((item) => item.id === this.active.id);
      if (!element) return;
      const dx = point.x - this.active.start.x;
      const dy = point.y - this.active.start.y;
      if (this.active.kind === 'resize-element') {
        ridimensionaElemento(element, this.active.original, bordiTrascinando(this.active.bordi, this.active.angolo, point));
        this.active.changed = true;
      } else if (this.active.kind === 'move-element') {
        spostaElemento(element, this.active.original, dx, dy);
        if (Math.abs(dx) > 0.008 || Math.abs(dy) > 0.008) this.active.moved = true;
      } else if (this.active.kind === 'move-text') {
        element.x = Math.max(0, Math.min(1 - element.w, this.active.original.x + dx));
        element.y = Math.max(0, Math.min(1 - element.h, this.active.original.y + dy));
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) this.active.moved = true;
      } else {
        element.w = Math.max(0.12, Math.min(1 - element.x, this.active.original.w + dx));
        element.h = Math.max(0.07, Math.min(1 - element.y, this.active.original.h + dy));
      }
    } else if (this.active.punti) {
      const last = this.active.punti.at(-1);
      if (Math.hypot(point.x - last.x, point.y - last.y) > 0.0015) this.active.punti.push(point);
    } else {
      this.active.x2 = point.x;
      // Una sottolineatura sta sotto le parole, e le righe di un libro sono
      // dritte: resta orizzontale comunque si muova la mano. Per una riga
      // storta c'è lo strumento Riga.
      this.active.y2 = this.active.tipo === 'sottolineatura' ? this.active.y1 : point.y;
    }
    this.render();
  }

  pointerUp(event) {
    const gesto = this.inGesto(event);
    if (gesto) this.onTouchGesture('end', event, this.gesto.touches);
    this.gesto.touches.delete(event.pointerId);
    this.pointers.delete(event.pointerId);
    // Finché resta a terra un dito del gesto non si torna a scrivere.
    if (this.gesto.attivo && this.gesto.touches.size === 0) this.gesto.attivo = false;
    if (gesto) return;
    if (!this.active || !this.canDraw(event)) return;
    if (this.active.kind === 'erase') {
      const changed = this.active.changed;
      this.active = null;
      if (changed) this.commit();
      else this.render();
      return;
    }
    if (this.active.kind === 'resize-element') {
      const cambiato = this.active.changed;
      this.active = null;
      if (cambiato) this.commit(); else this.render();
      return;
    }
    if (this.active.kind === 'move-element') {
      const spostato = this.active.moved;
      this.active = null;
      // Un tocco senza trascinamento sceglie soltanto: non c'è nulla da salvare.
      if (spostato) this.commit(); else this.render();
      return;
    }
    if (this.active.kind === 'move-text' && !this.active.moved) {
      // tap su una casella esistente (non spostata): la apro per scriverci
      const el = this.elements.find((e) => e.id === this.active.id);
      this.active = null;
      if (el) this.apriEditorTesto(el);
      return;
    }
    if (!this.active.kind && this.active.punti?.length === 1) this.active.punti.push({ ...this.active.punti[0], x: this.active.punti[0].x + 0.0001 });
    this.active = null;
    this.commit();
  }

  // La misura del carattere e' quella scelta nell'astuccio. Prima veniva dallo
  // spessore della penna, e non c'era modo di cambiarla: tre misure fisse e
  // nessun comando.
  dimensioneTestoScelta() {
    return Number(this.textDraft.dimensioneTesto) || 24;
  }

  // Apre una casella di testo editabile IN-PLACE sul foglio: la tastiera grande del
  // dispositivo si apre e si scrive dentro. Al termine (tocco fuori o Invio) il testo
  // resta al suo posto; se la casella resta vuota, si annulla.
  apriEditorTesto(element) {
    const parent = this.canvas.parentElement;
    if (!parent || typeof document === 'undefined') return; // senza DOM (es. test): niente casella
    this.onTextSelection(clone(element)); // l'astuccio mostra lo stile di questa casella
    this.editingId = element.id;
    this.render();
    const rect = this.canvas.getBoundingClientRect();
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.className = 'text-inplace';
    editor.textContent = element.testo || '';
    editor.style.left = `${element.x * 100}%`;
    editor.style.top = `${element.y * 100}%`;
    editor.style.color = element.colore;
    editor.style.fontSize = `${Math.max(12, element.dimensioneTesto * rect.height / 1000)}px`;
    // Grassetto, corsivo e carattere si vedono gia' mentre si scrive.
    editor.style.fontFamily = TEXT_FONTS[element.carattere] || TEXT_FONTS.sans;
    editor.style.fontWeight = element.grassetto ? '700' : '400';
    editor.style.fontStyle = element.corsivo ? 'italic' : 'normal';
    // La casella si apre già larga quanto l'elemento e alta abbastanza da
    // invitare a scrivere una frase; poi cresce da sola col testo.
    editor.style.width = `${Math.min(element.w, 1 - element.x) * 100}%`;
    editor.style.minHeight = `${element.h * 100}%`;
    editor.style.maxWidth = `${Math.max(10, (1 - element.x) * 100)}%`;
    parent.appendChild(editor);
    this.textEditor = editor;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const chiudi = () => {
      if (this.textEditor !== editor) return;
      const testo = editor.textContent.replace(/ /g, ' ').replace(/\s+$/,'').trim();
      this.textEditor = null;
      this.editingId = null;
      // La misura si prende FINCHE' la casella e' ancora sul foglio: una volta
      // tolta, offsetWidth e offsetHeight valgono zero.
      const foglio = this.canvas.getBoundingClientRect();
      const misura = { larghezza: editor.offsetWidth, altezza: editor.offsetHeight };
      togliDalFoglio(editor);
      const el = this.elements.find((e) => e.id === element.id);
      if (el) {
        if (!testo) this.elements = this.elements.filter((e) => e.id !== element.id);
        else {
          el.testo = testo;
          // La casella salvata prende la misura di quella in cui si è scritto:
          // così sul foglio il testo sta come lo si è visto.
          if (foglio.width > 0 && foglio.height > 0 && misura.altezza > 0) {
            el.w = Math.min(1 - el.x, Math.max(el.w, misura.larghezza / foglio.width));
            el.h = Math.min(1 - el.y, Math.max(0.05, misura.altezza / foglio.height));
          }
        }
      }
      this.commit();
    };
    editor.addEventListener('blur', chiudi);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editor.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); editor.blur(); }
    });
  }

  // Toglie la casella senza salvare: si usa quando il foglio cambia sotto.
  scartaEditorTesto() {
    if (!this.textEditor) return;
    const editor = this.textEditor;
    this.textEditor = null;
    this.editingId = null;
    togliDalFoglio(editor);
  }

  commit() {
    this.history.push(this.elements);
    this.render();
    Promise.resolve().then(() => this.onChange(clone(this.elements)));
  }

  undo() {
    const state = this.history.undo();
    if (!state) return false;
    this.elements = state;
    this.selectedId = null;
    this.render();
    Promise.resolve().then(() => this.onChange(clone(this.elements)));
    return true;
  }

  redo() {
    const state = this.history.redo();
    if (!state) return false;
    this.elements = state;
    this.selectedId = null;
    this.render();
    Promise.resolve().then(() => this.onChange(clone(this.elements)));
    return true;
  }

  render(context = this.context, width = this.canvas.width, height = this.canvas.height) {
    disegnaElementi(context, this.elements, width, height, {
      selectedId: this.selectedId,
      saltaId: this.editingId, // in scrittura: quella casella la mostra l'HTML
    });
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }
}

// Raggruppa più fogli (DrawingSurface) sotto un unico astuccio: le scelte comuni
// (strumento, colore, spessore...) valgono per tutti i fogli; annulla/ripeti e il
// testo agiscono sul foglio ATTIVO, cioè l'ultimo toccato. Espone la stessa
// interfaccia che attachToolbox si aspetta da una singola surface, così l'astuccio
// non sa nemmeno che i fogli sono più di uno.
export class SurfaceGroup {
  constructor(surfaces) {
    this.surfaces = surfaces;
    this.active = surfaces[0];
    this._onTextRequired = () => {};
    this._onTextSelection = () => {};
    this.onStateChange = () => {};
    for (const s of surfaces) {
      s.onActivate = () => { this.active = s; };
      s.onTextRequired = () => this._onTextRequired();
      s.onTextSelection = (element) => this._onTextSelection(element);
    }
  }

  // Scelte comuni: valgono per tutti i fogli
  setTool(tool) { this.surfaces.forEach((s) => s.setTool(tool)); this.onStateChange(); }
  setColor(color) { this.surfaces.forEach((s) => s.setColor(color)); }
  setWidth(width) { this.surfaces.forEach((s) => s.setWidth(width)); }
  setReadOnly(value) { this.surfaces.forEach((s) => s.setReadOnly(value)); this.onStateChange(); }
  setDrawWithFinger(value) { this.surfaces.forEach((s) => s.setDrawWithFinger(value)); this.onStateChange(); }
  setTextDraft(draft) { this.surfaces.forEach((s) => s.setTextDraft(draft)); }
  setSegnoMusicale(segno) { this.surfaces.forEach((s) => s.setSegnoMusicale(segno)); }

  // Azioni sul foglio attivo
  undo() { return this.active.undo(); }
  redo() { return this.active.redo(); }
  updateSelectedText(draft) { return this.active.updateSelectedText(draft); }
  testoCorrente() { return this.active.testoCorrente(); }
  applicaStileTesto(stile) { return this.active.applicaStileTesto(stile); }
  render() { this.active.render(); }

  get drawWithFinger() { return this.active.drawWithFinger; }
  get readOnly() { return this.active.readOnly; }
  get tool() { return this.active.tool; }
  get textDraft() { return this.active.textDraft; }
  get selectedId() { return this.active.selectedId; }
  set selectedId(value) { this.active.selectedId = value; }
  get onTextRequired() { return this._onTextRequired; }
  set onTextRequired(fn) { this._onTextRequired = fn; }
  get onTextSelection() { return this._onTextSelection; }
  set onTextSelection(fn) { this._onTextSelection = fn; }
}

function ascii(value) { return new TextEncoder().encode(value); }

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export function makePdfFromJpegs(images) {
  if (!images.length) throw new Error('Non ci sono pagine da esportare.');
  const parts = [ascii('%PDF-1.4\n%Skooling\n')];
  const offsets = [0];
  let total = parts[0].length;
  const objectCount = 2 + images.length * 3;
  const addObject = (number, chunks) => {
    offsets[number] = total;
    const objectParts = [ascii(`${number} 0 obj\n`), ...chunks, ascii('\nendobj\n')];
    parts.push(...objectParts);
    total += objectParts.reduce((sum, part) => sum + part.length, 0);
  };
  addObject(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
  const kids = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  addObject(2, [ascii(`<< /Type /Pages /Count ${images.length} /Kids [${kids}] >>`)]);
  images.forEach((image, index) => {
    const pageNumber = 3 + index * 3;
    const contentNumber = pageNumber + 1;
    const imageNumber = pageNumber + 2;
    const landscape = image.width > image.height;
    const pageWidth = landscape ? 842 : 595;
    const pageHeight = landscape ? 595 : 842;
    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const stream = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${index} Do Q`;
    addObject(pageNumber, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im${index} ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`)]);
    addObject(contentNumber, [ascii(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)]);
    addObject(imageNumber, [
      ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      ascii('\nendstream'),
    ]);
  });
  const xrefOffset = total;
  const xref = [`xref\n0 ${objectCount + 1}\n`, '0000000000 65535 f \n'];
  for (let number = 1; number <= objectCount; number += 1) xref.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  parts.push(ascii(xref.join('')));
  return concatBytes(parts);
}

export async function canvasToJpeg(canvas, quality = 0.9) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Le modalita' restano visibili anche con l'astuccio chiuso. Scegliere uno
// strumento riattiva sempre la scrittura, e tutti i comandi mostrano lo stato vero.
function attachWritingControls(root, surface) {
  const workspace = root.closest('.workspace');
  if (!workspace) return;
  const sync = () => {
    const lettura = surface.readOnly;
    workspace.querySelectorAll('[data-writing-mode]').forEach((button) => {
      const active = (button.dataset.writingMode === 'leggi') === lettura;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    workspace.querySelectorAll('[data-tool], [data-quick-tool]').forEach((button) => {
      const active = !lettura && (button.dataset.tool || button.dataset.quickTool) === surface.tool;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const checkbox = root.querySelector('[data-readonly]');
    if (checkbox) checkbox.checked = lettura;
    workspace.querySelector('[data-writing-status]').textContent = lettura
      ? 'Lettura: tocca Scrivi per usare la Apple Pencil.'
      : surface.drawWithFinger
        ? 'Apple Pencil e dito scrivono. Due dita scorrono e ingrandiscono.'
        : 'Apple Pencil scrive. Il dito scorre, due dita ingrandiscono.';
  };
  surface.onStateChange = sync;
  workspace.querySelectorAll('[data-writing-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const lettura = button.dataset.writingMode === 'leggi';
      if (lettura) surface.setReadOnly(true);
      else root.querySelector('[data-tool="penna"]').click();
      // La barra rapida basta per iniziare: il foglio resta libero.
      root.hidden = true;
      workspace.querySelector('[id^="toggle-"][id$="-tools"]')?.classList.remove('active');
      sync();
    });
  });
  workspace.querySelectorAll('[data-quick-tool]').forEach((button) => {
    button.addEventListener('click', () => root.querySelector(`[data-tool="${button.dataset.quickTool}"]`).click());
  });
  workspace.querySelector('[data-quick-undo]')?.addEventListener('click', () => surface.undo());
  sync();
}

export function attachToolbox(root, surface) {
  attachWritingControls(root, surface);
  const palette = root.querySelector('[data-palette]');
  palette.replaceChildren(...COLORS.map((color, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `color-button${index === 1 ? ' active' : ''}`;
    button.style.background = color;
    button.dataset.color = color;
    button.setAttribute('aria-label', `Colore ${index + 1}`);
    return button;
  }));

  // Comandi del testo: misura del carattere, grassetto e corsivo. Compaiono
  // quando si sceglie lo strumento Testo e spariscono con gli altri. Il testo
  // si scrive sul foglio, non qui: questo pannello ne governa solo l'aspetto.
  const textPanel = document.createElement('section');
  textPanel.className = 'text-panel';
  textPanel.dataset.textPanel = '';
  textPanel.hidden = true;
  textPanel.innerHTML = `
    <label>Dimensione<select data-text-size>${TEXT_SIZES.map((size) => `<option value="${size}"${size === 24 ? ' selected' : ''}>${size}</option>`).join('')}</select></label>
    <label>Carattere<select data-text-font><option value="sans">Semplice</option><option value="serif">Classico</option><option value="mono">Monospazio</option></select></label>
    <div class="text-style-buttons" role="group" aria-label="Stile del testo">
      <button type="button" data-text-bold aria-pressed="false" aria-label="Grassetto"><strong>G</strong></button>
      <button type="button" data-text-italic aria-pressed="false" aria-label="Corsivo"><em>C</em></button>
    </div>
    <p class="text-help" data-text-help>Vale per la casella scelta. Senza casella scelta, vale per la prossima che scrivi.</p>`;
  root.querySelector('.widths')?.insertAdjacentElement('afterend', textPanel);

  const textSize = textPanel.querySelector('[data-text-size]');
  const textFont = textPanel.querySelector('[data-text-font]');
  const textHelp = textPanel.querySelector('[data-text-help]');
  const boldButton = textPanel.querySelector('[data-text-bold]');
  const italicButton = textPanel.querySelector('[data-text-italic]');

  const setPressed = (button, pressed) => {
    button.setAttribute('aria-pressed', String(Boolean(pressed)));
    button.classList.toggle('active', Boolean(pressed));
  };
  const readTextStyle = () => ({
    dimensioneTesto: Number(textSize.value) || 24,
    carattere: textFont.value,
    grassetto: boldButton.getAttribute('aria-pressed') === 'true',
    corsivo: italicButton.getAttribute('aria-pressed') === 'true',
  });
  // Applica quel che dicono i comandi: alla casella scelta se c'e', e comunque
  // alla prossima che si scrivera'.
  const applyTextStyle = () => {
    const stile = readTextStyle();
    surface.setTextDraft(stile);
    textHelp.textContent = surface.applicaStileTesto(stile)
      ? 'Casella aggiornata.'
      : 'Vale per la prossima casella che scrivi. Tocca una casella per cambiarla.';
  };
  // Mostra nei comandi lo stile della casella toccata, cosi' si vede subito
  // com'e' fatta prima di cambiarla.
  const fillTextPanel = (element) => {
    textSize.value = String(element.dimensioneTesto || 24);
    if (!textSize.value) textSize.value = '24';
    textFont.value = TEXT_FONTS[element.carattere] ? element.carattere : 'sans';
    setPressed(boldButton, element.grassetto);
    setPressed(italicButton, element.corsivo);
    textHelp.textContent = 'Questa e’ la casella scelta: i comandi cambiano lei.';
  };

  surface.onTextSelection = (element) => fillTextPanel(element);

  textPanel.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-text-bold') || button.hasAttribute('data-text-italic')) {
      setPressed(button, button.getAttribute('aria-pressed') !== 'true');
      applyTextStyle();
    }
  });
  textPanel.addEventListener('change', applyTextStyle);

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tool) {
      root.querySelectorAll('[data-tool]').forEach((item) => item.classList.toggle('active', item === button));
      surface.setTool(button.dataset.tool);
      // Il testo si scrive sul foglio; qui restano solo misura e stile, e solo
      // quando lo strumento Testo e' quello acceso.
      const scrittura = button.dataset.tool === 'testo';
      textPanel.hidden = !scrittura;
      root.classList.toggle('text-tool-active', scrittura);
      if (scrittura) {
        textSize.value = String(surface.textDraft.dimensioneTesto || 24);
        setPressed(boldButton, surface.textDraft.grassetto);
        setPressed(italicButton, surface.textDraft.corsivo);
        textHelp.textContent = 'Scegli misura e stile, poi tocca il foglio dove scrivere.';
      }
    } else if (button.dataset.color) {
      root.querySelectorAll('[data-color]').forEach((item) => item.classList.toggle('active', item === button));
      surface.setColor(button.dataset.color);
      // Col testo acceso il colore vale anche per la casella scelta.
      if (!textPanel.hidden) surface.applicaStileTesto({ colore: button.dataset.color });
    } else if (button.dataset.width) {
      root.querySelectorAll('[data-width]').forEach((item) => item.classList.toggle('active', item === button));
      surface.setWidth(Number(button.dataset.width));
    } else if (button.hasAttribute('data-undo')) surface.undo();
    else if (button.hasAttribute('data-redo')) surface.redo();
  });
  root.querySelector('[data-readonly]')?.addEventListener('change', (event) => surface.setReadOnly(event.target.checked));
}
