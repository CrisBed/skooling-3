// Come si affiancano le pagine quando la doppia pagina e' accesa.
//
// Le due regole sono DIVERSE e stanno qui vicine di proposito, perche' libri e
// quaderni riusano la stessa `SurfaceGroup` di strumenti.js e la tentazione di
// accoppiarli allo stesso modo e' forte.
//
// LIBRI. La pagina 1 e' la copertina e in un libro aperto sta sempre da sola.
// Il retro di copertina, la pagina 2, si affianca alla 3, e da li' in poi le
// coppie sono pari-dispari: 2-3, 4-5, 6-7, fino alla fine. Se il libro ha un
// numero PARI di pagine anche l'ultima resta sola, perche' la dispari che la
// precede si e' gia' accoppiata con la pari prima di lei. Se il numero e'
// DISPARI l'ultima pagina chiude normalmente la sua coppia.
//
// QUADERNI. Un quaderno non ha copertina, quindi le coppie restano 1-2, 3-4,
// 5-6. Quella regola vive in quaderni.js e non passa da qui: e' un `% 2`
// sull'indice del foglio, e non deve essere sostituita con le funzioni di
// questo file.

// La pagina di sinistra della coppia che contiene `numero`. E' sempre la 1
// oppure una pagina pari.
export function paginaSinistraLibro(numero) {
  const pagina = Math.max(1, Math.floor(Number(numero)) || 1);
  return pagina <= 1 ? 1 : pagina - (pagina % 2);
}

// La pagina di destra della coppia, oppure null quando quella di sinistra sta
// da sola: la copertina, e l'ultima pagina di un libro con pagine pari.
export function paginaDestraLibro(numero, totale) {
  const sinistra = paginaSinistraLibro(numero);
  if (sinistra === 1) return null;
  const destra = sinistra + 1;
  return destra <= Number(totale) ? destra : null;
}

// La pagina di sinistra della coppia precedente e della successiva. Servono
// perche' il passo non e' costante: dalla copertina si avanza di una pagina,
// da tutte le altre di due.
export function coppiaPrecedenteLibro(numero) {
  return paginaSinistraLibro(Math.max(1, paginaSinistraLibro(numero) - 2));
}

export function coppiaSuccessivaLibro(numero, totale) {
  const sinistra = paginaSinistraLibro(numero);
  const avanti = sinistra === 1 ? 2 : sinistra + 2;
  return avanti <= Number(totale) ? avanti : sinistra;
}

// Tutte le coppie del libro, dalla copertina all'ultima pagina. Serve per
// provare la sequenza intera e non solo le prime pagine.
export function coppieLibro(totale) {
  const pagine = Math.max(0, Math.floor(Number(totale)) || 0);
  const coppie = [];
  for (let sinistra = 1; sinistra <= pagine; sinistra = sinistra === 1 ? 2 : sinistra + 2) {
    coppie.push([sinistra, paginaDestraLibro(sinistra, pagine)]);
  }
  return coppie;
}
