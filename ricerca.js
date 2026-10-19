// Ricerca per parola dentro il testo dei libri.
//
// Skooling il testo non lo produce: lo aggiunge l'OCR dello scanner, che salva
// le parole sopra la scansione dentro il PDF stesso. Qui si legge soltanto
// quello che nel file c'è già. Un libro scansionato senza OCR non ha nessuna
// parola da leggere: non è un errore, semplicemente non si può cercare dentro.
import { DB } from './db.js';

// PDF.js si carica solo quando serve davvero leggere un libro. Cosi' questo
// modulo resta leggero e le sue parti di puro calcolo si possono provare da
// sole, senza tirarsi dietro tutto il lettore.
async function apriDocumento(blob) {
  const pdfjsLib = await import('./vendor/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
  // Anche qui serve wasmUrl, per lo stesso motivo spiegato in pdf-viewer.js:
  // senza il modulo WebAssembly le immagini CCITTFax non si decodificano.
  return pdfjsLib.getDocument({ data: await blob.arrayBuffer(), wasmUrl: './vendor/' });
}

// Le due matrici di PDF.js moltiplicate fra loro: sei numeri, che si fanno qui
// invece di caricare la libreria solo per questo.
export function componiMatrici(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

// Accenti, maiuscole, apostrofi storti e spazi doppi non devono far fallire una
// ricerca: si confronta tutto ridotto alla stessa forma semplice.
export function normalizza(valore) {
  return String(valore ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// Il pezzo di frase attorno alla parola trovata, per far capire il contesto
// senza aprire il libro.
export function estraiFrase(testo, posizione, lunghezza, contorno = 48) {
  const inizio = Math.max(0, posizione - contorno);
  const fine = Math.min(testo.length, posizione + lunghezza + contorno);
  const frase = testo.slice(inizio, fine).trim();
  return `${inizio > 0 ? '…' : ''}${frase}${fine < testo.length ? '…' : ''}`;
}

// Le pagine che contengono la parola cercata. `pagine` sono le pagine con del
// testo: {numero, testo}. Di ogni pagina si tiene la prima occorrenza, perché
// quel che serve è sapere dove andare.
export function cercaNelTesto(pagine, richiesta, massimo = 80) {
  const cercata = normalizza(richiesta);
  if (cercata.length < 2) return [];
  const trovate = [];
  for (const pagina of pagine) {
    const testo = pagina.testo || '';
    const posizione = normalizza(testo).indexOf(cercata);
    if (posizione < 0) continue;
    trovate.push({
      numero: pagina.numero,
      frase: estraiFrase(testo, posizione, cercata.length),
      termine: cercata,
    });
    if (trovate.length >= massimo) break;
  }
  return trovate;
}

// Un libro cambia quando lo si reimporta dopo l'OCR: l'impronta se ne accorge e
// fa rifare l'indice invece di rispondere col testo vecchio.
export function improntaLibro(libro) {
  return `${libro.blob?.size ?? 0}-${libro.data ?? 0}`;
}

// Legge il testo pagina per pagina. Le pagine senza nessuna parola non entrano
// nell'indice: su un libro solo scansionato l'indice resta vuoto.
export async function leggiTestoDelPdf(pdf, onProgress = () => {}) {
  const pagine = [];
  for (let numero = 1; numero <= pdf.numPages; numero += 1) {
    const pagina = await pdf.getPage(numero);
    const contenuto = await pagina.getTextContent();
    const testo = contenuto.items.map((voce) => voce.str || '').join(' ').replace(/\s+/g, ' ').trim();
    if (testo) pagine.push({ numero, testo });
    pagina.cleanup?.();
    onProgress(numero / pdf.numPages);
  }
  return pagine;
}

// L'indice di un libro, preso da quello già salvato quando è ancora buono.
// Rileggere il testo di un libro di seicento pagine richiede tempo: si fa una
// volta sola, e le ricerche successive rispondono subito.
export async function indiceDelLibro(libro, onProgress = () => {}) {
  const impronta = improntaLibro(libro);
  const salvato = await DB.get('indicelibri', libro.id);
  if (salvato && salvato.impronta === impronta) return salvato;

  const task = await apriDocumento(libro.blob);
  const pdf = await task.promise;
  try {
    const pagine = await leggiTestoDelPdf(pdf, onProgress);
    const indice = {
      id: libro.id,
      impronta,
      pagine,
      haTesto: pagine.length > 0,
      pagineTotali: pdf.numPages,
      creatoIl: Date.now(),
    };
    await DB.put('indicelibri', indice);
    return indice;
  } finally {
    await task.destroy().catch(() => {});
  }
}

// Cerca in tutti i libri dati. Chiama `onLibro` appena un libro è pronto, così
// i risultati compaiono uno alla volta invece di far aspettare la fine.
export async function cercaNeiLibri(libri, richiesta, { onProgress = () => {}, onLibro = () => {} } = {}) {
  const risultati = [];
  const senzaTesto = [];
  for (let indice = 0; indice < libri.length; indice += 1) {
    const libro = libri[indice];
    onProgress({ libro, fatti: indice, totale: libri.length, avanzamentoLibro: 0 });
    try {
      const indicizzato = await indiceDelLibro(libro, (quota) => {
        onProgress({ libro, fatti: indice, totale: libri.length, avanzamentoLibro: quota });
      });
      if (!indicizzato.haTesto) {
        senzaTesto.push(libro);
        onLibro({ libro, pagine: [], haTesto: false });
        continue;
      }
      const pagine = cercaNelTesto(indicizzato.pagine, richiesta);
      if (pagine.length) risultati.push({ libro, pagine });
      onLibro({ libro, pagine, haTesto: true });
    } catch {
      // Un PDF che non si riesce ad aprire non ferma la ricerca negli altri.
      senzaTesto.push(libro);
      onLibro({ libro, pagine: [], haTesto: false });
    }
  }
  onProgress({ fatti: libri.length, totale: libri.length, avanzamentoLibro: 1 });
  return { risultati, senzaTesto };
}

// I rettangoli da evidenziare su una pagina già disegnata. PDF.js dice dove sta
// ogni pezzo di testo; dentro al pezzo la posizione della parola si stima in
// proporzione ai caratteri, che per far vedere dov'è basta e avanza.
export function rettangoliDaEvidenziare(contenuto, viewport, richiesta) {
  const cercata = normalizza(richiesta);
  if (cercata.length < 2) return [];
  const rettangoli = [];
  for (const voce of contenuto.items || []) {
    const testo = voce.str || '';
    if (!testo.trim()) continue;
    const semplice = normalizza(testo);
    let da = semplice.indexOf(cercata);
    if (da < 0) continue;
    const matrice = componiMatrici(viewport.transform, voce.transform);
    const altezza = Math.hypot(matrice[2], matrice[3]) || voce.height || 12;
    const larghezzaTotale = (voce.width || 0) * viewport.scale;
    while (da >= 0) {
      const quotaInizio = semplice.length ? da / semplice.length : 0;
      const quotaLarghezza = semplice.length ? cercata.length / semplice.length : 1;
      // Il punto che PDF.js da' e' la riga su cui appoggiano le lettere: il
      // riquadro sale sopra e scende un poco sotto, per coprire anche le code
      // di g, p e q.
      rettangoli.push({
        x: matrice[4] + larghezzaTotale * quotaInizio,
        y: matrice[5] - altezza * 0.92,
        larghezza: Math.max(4, larghezzaTotale * quotaLarghezza),
        altezza: altezza * 1.2,
      });
      da = semplice.indexOf(cercata, da + cercata.length);
    }
  }
  return rettangoli;
}
