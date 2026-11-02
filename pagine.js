// Affiancamento dei libri: i riferimenti restano sempre i fogli fisici PDF.
// Il lato viene invece dal numero stampato, quando è noto: dispari a sinistra,
// pari a destra. La copertina senza numero resta separata e non viene contata.
// Senza corrispondenza si conserva il fallback storico: copertina 1, poi 2-3.
// I quaderni hanno una regola propria e non usano questo modulo.

function foglio(numero) {
  return Math.max(1, Math.floor(Number(numero)) || 1);
}

function numeroStampato(numero, numbering) {
  if (!numbering?.known) return null;
  if (Number.isInteger(numbering.offset)) return numero - numbering.offset;
  const label = numbering.labels?.[numero - 1]?.trim();
  if (!label || !/^\d+$/.test(label)) return null;
  const value = Number(label);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function copertina(numero, numbering) {
  return numero === 1 && !(numeroStampato(1, numbering) > 0);
}

// Usato soltanto quando manca la compagna: anche un foglio pari isolato deve
// conservare il lato destro. La copertina non ha un lato numerato.
export function paginaSingolaADestra(numero, numbering = null) {
  const pagina = foglio(numero);
  if (copertina(pagina, numbering)) return false;
  const printed = numeroStampato(pagina, numbering);
  return (printed ?? pagina - 1) % 2 === 0;
}

function affiancabili(prima, numbering) {
  return !copertina(prima, numbering) &&
    !paginaSingolaADestra(prima, numbering) &&
    paginaSingolaADestra(prima + 1, numbering);
}

// Il primo foglio fisico della coppia contenente `numero`. Il nome storico è
// conservato: quando è un foglio isolato pari, il lettore lo dispone a destra.
export function paginaSinistraLibro(numero, numbering = null) {
  const pagina = foglio(numero);
  return pagina > 1 && affiancabili(pagina - 1, numbering) ? pagina - 1 : pagina;
}

export function paginaDestraLibro(numero, totale, numbering = null) {
  const prima = paginaSinistraLibro(numero, numbering);
  return prima < Number(totale) && affiancabili(prima, numbering) ? prima + 1 : null;
}

export function coppiaPrecedenteLibro(numero, numbering = null) {
  const prima = paginaSinistraLibro(numero, numbering);
  return paginaSinistraLibro(Math.max(1, prima - 1), numbering);
}

export function coppiaSuccessivaLibro(numero, totale, numbering = null) {
  const prima = paginaSinistraLibro(numero, numbering);
  const prossima = prima + (paginaDestraLibro(prima, totale, numbering) ? 2 : 1);
  return prossima <= Number(totale) ? prossima : prima;
}

export function coppieLibro(totale, numbering = null) {
  const pagine = Math.max(0, Math.floor(Number(totale)) || 0);
  const coppie = [];
  for (let prima = 1; prima <= pagine;) {
    const seconda = paginaDestraLibro(prima, pagine, numbering);
    coppie.push([prima, seconda]);
    prima += seconda ? 2 : 1;
  }
  return coppie;
}
