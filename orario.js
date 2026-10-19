// L'orario delle lezioni, e tutto quello che l'app ne ricava.
//
// Questo file non tocca lo schermo e non tocca l'archivio: sono solo regole.
// Chi disegna (app.js) gli passa l'orario e l'associazione materie-libri letti
// dall'archivio, e riceve indietro le materie di oggi, i libri di oggi e i
// libri di domani. Cosi' la regola si prova da sola, senza browser.
//
// TRE COSE DA NON SBAGLIARE, decise con Cristian:
//
// 1. Le MATERIE sono entita' proprie, non testo libero. "Italiano antologia" e
//    "Italiano grammatica" NON sono due materie: sono due ore della stessa
//    materia Italiano, con un'etichetta diversa. I compiti si scrivono sulla
//    materia Italiano, altrimenti Gabriel si ritroverebbe i compiti sparsi su
//    quattro italiani diversi.
//
// 2. L'ora di storia/geografia e' UNA sola ora che punta a DUE materie. Quando
//    si scrive un compito da quell'ora si sceglie quale delle due: per questo
//    uno slot tiene un elenco di materie e non una materia sola.
//
// 3. I libri si agganciano alle MATERIE, mai ai giorni. Nessun libro e' scritto
//    qui dentro. Da orario + associazione l'app deriva da sola i libri della
//    giornata: se la scuola cambia l'orario, i libri del lunedi' cambiano da
//    soli senza che nessuno tocchi il codice.

// Le materie della classe. L'id non cambia mai: e' quello che finisce
// nell'archivio, dentro i compiti e dentro l'associazione con i libri. Il nome
// e' solo quello che si legge sullo schermo.
export const MATERIE = [
  { id: 'italiano', nome: 'Italiano' },
  { id: 'matematica', nome: 'Matematica' },
  { id: 'geometria', nome: 'Geometria' },
  { id: 'storia', nome: 'Storia' },
  { id: 'geografia', nome: 'Geografia' },
  { id: 'inglese', nome: 'Inglese' },
  { id: 'scienze', nome: 'Scienze' },
  { id: 'musica', nome: 'Musica' },
  { id: 'arte', nome: 'Arte' },
  { id: 'tecnologia', nome: 'Tecnologia' },
];

export const MATERIE_PER_ID = new Map(MATERIE.map((materia) => [materia.id, materia]));

// Le campanelle: cinque lezioni da 55 minuti, con la pausa dopo la seconda.
export const CAMPANELLE = [
  { inizio: '8:30', fine: '9:25' },
  { inizio: '9:25', fine: '10:20' },
  { inizio: '10:40', fine: '11:35' },
  { inizio: '11:35', fine: '12:30' },
  { inizio: '12:30', fine: '13:25' },
];

// La pausa non e' un'ora di lezione: sta fra la seconda e la terza e serve solo
// a disegnare l'orario per com'e' davvero.
export const PAUSA = { inizio: '10:20', fine: '10:40', dopoOra: 2 };

export const ORE_AL_GIORNO = CAMPANELLE.length;
export const FINE_LEZIONI = CAMPANELLE.at(-1).fine;

// I giorni stanno nell'ordine di JavaScript: 0 e' domenica, 6 e' sabato. Si
// tiene questo ordine e non il lunedi' in testa, cosi' `data.getDay()` entra
// nell'elenco senza conti in mezzo, che sono il posto dove si sbaglia.
export const GIORNI = [
  { indice: 0, nome: 'Domenica', breve: 'Dom' },
  { indice: 1, nome: 'Lunedì', breve: 'Lun' },
  { indice: 2, nome: 'Martedì', breve: 'Mar' },
  { indice: 3, nome: 'Mercoledì', breve: 'Mer' },
  { indice: 4, nome: 'Giovedì', breve: 'Gio' },
  { indice: 5, nome: 'Venerdì', breve: 'Ven' },
  { indice: 6, nome: 'Sabato', breve: 'Sab' },
];

// I giorni che si vedono nella schermata dell'orario: sabato e domenica non
// hanno lezione, e una tabella con due colonne vuote si legge peggio.
export const GIORNI_DI_SCUOLA = [1, 2, 3, 4, 5];

// L'orario ricevuto dalla scuola, quello intestato ORARIO PROVVISORIO e
// comunicato come definitivo. E' solo il punto di partenza: dalla schermata
// Orario si cambia qualunque ora, e da quel momento vale la copia salvata
// nell'archivio. Nessuno deve rimettere le mani qui dentro per un cambio.
export function orarioIniziale() {
  const ora = (materie, etichetta) => ({ materie, etichetta });
  const vuoto = () => [];
  return [
    vuoto(), // domenica
    [
      ora(['italiano'], 'Antologia'),
      ora(['italiano'], 'Grammatica'),
      ora(['storia', 'geografia'], ''),
      ora(['arte'], ''),
      ora(['arte'], ''),
    ],
    [
      ora(['matematica'], ''),
      ora(['geometria'], ''),
      ora(['italiano'], 'Letture'),
      ora(['storia', 'geografia'], ''),
      ora(['inglese'], ''),
    ],
    [
      ora(['italiano'], 'Antologia'),
      ora(['italiano'], 'Grammatica'),
      ora(['inglese'], ''),
      ora(['scienze'], ''),
      ora(['scienze'], ''),
    ],
    [
      ora(['musica'], ''),
      ora(['musica'], ''),
      ora(['matematica'], ''),
      ora(['storia', 'geografia'], ''),
      ora(['italiano'], 'Book talk'),
    ],
    [
      ora(['inglese'], ''),
      ora(['inglese'], ''),
      ora(['geometria'], ''),
      ora(['tecnologia'], ''),
      ora(['tecnologia'], ''),
    ],
    vuoto(), // sabato
  ];
}

// Rimette in riga qualunque cosa arrivi dall'archivio: sette giorni, ognuno con
// cinque ore o nessuna, e dentro le ore solo materie che esistono davvero.
// Un'ora rimasta senza materie valide diventa un'ora libera, che si vede e si
// puo' riempire: e' meglio di un buco che fa saltare la schermata.
export function normalizzaOrario(valore) {
  const giorni = Array.isArray(valore) ? valore : [];
  return GIORNI.map((giorno) => {
    const ore = Array.isArray(giorni[giorno.indice]) ? giorni[giorno.indice] : [];
    if (!ore.length) return [];
    return Array.from({ length: ORE_AL_GIORNO }, (_, indice) => normalizzaOra(ore[indice]));
  });
}

function normalizzaOra(valore) {
  const grezze = Array.isArray(valore?.materie) ? valore.materie : [];
  const materie = [...new Set(grezze.filter((id) => MATERIE_PER_ID.has(id)))];
  const etichetta = typeof valore?.etichetta === 'string' ? valore.etichetta.trim() : '';
  return { materie, etichetta };
}

export function nomeMateria(id) {
  return MATERIE_PER_ID.get(id)?.nome || '';
}

// I compiti scritti prima che l'orario esistesse hanno la materia come testo
// libero, e quel testo si continua a poter scrivere a mano. Qui si prova a
// riconoscerlo: "matematica", "Matematica " e "MATEMATICA" sono la stessa
// materia, e il compito puo' aprire il suo libro come tutti gli altri.
export function idMateriaDaNome(nome) {
  const cercato = String(nome ?? '').trim().toLocaleLowerCase('it');
  if (!cercato) return '';
  return MATERIE.find((materia) => materia.nome.toLocaleLowerCase('it') === cercato)?.id || '';
}

// Come si legge un'ora sull'orario: "Italiano (Antologia)", oppure
// "Storia / Geografia" quando l'ora punta a due materie.
export function nomeDellOra(ora) {
  const nomi = (ora?.materie || []).map(nomeMateria).filter(Boolean);
  if (!nomi.length) return 'Ora libera';
  const testa = nomi.join(' / ');
  return ora.etichetta ? `${testa} (${ora.etichetta})` : testa;
}

export function giornoHaLezione(orario, indiceGiorno) {
  return (normalizzaOrario(orario)[indiceGiorno] || []).some((ora) => ora.materie.length > 0);
}

// Le ore di un giorno, gia' accoppiate alla loro campanella. E' quello che
// serve per disegnare sia la settimana sia la giornata.
export function oreDelGiorno(orario, indiceGiorno) {
  const ore = normalizzaOrario(orario)[indiceGiorno] || [];
  return ore.map((ora, indice) => ({
    ...ora,
    numero: indice + 1,
    inizio: CAMPANELLE[indice]?.inizio || '',
    fine: CAMPANELLE[indice]?.fine || '',
    nome: nomeDellOra(ora),
  }));
}

// Le materie di un giorno, una volta sola ciascuna e nell'ordine in cui
// compaiono. Le due arte del lunedi' fanno una voce sola: a Gabriel serve
// sapere che oggi c'e' arte, non che c'e' due volte.
export function materieDelGiorno(orario, indiceGiorno) {
  const viste = [];
  for (const ora of oreDelGiorno(orario, indiceGiorno)) {
    for (const id of ora.materie) if (!viste.includes(id)) viste.push(id);
  }
  return viste;
}

// Il giorno della settimana di una data, nell'indice di GIORNI.
export function indiceDelGiorno(data = new Date()) {
  return data.getDay();
}

// Il prossimo giorno con lezione dopo quello dato. Sabato e domenica portano a
// lunedi'. Restituisce la data vera, cosi' chi disegna sa anche che giorno del
// mese e': "Domani, martedi' 22".
export function prossimoGiornoDiScuola(orario, data = new Date()) {
  for (let avanti = 1; avanti <= 7; avanti += 1) {
    const prossima = new Date(data.getFullYear(), data.getMonth(), data.getDate() + avanti);
    if (giornoHaLezione(orario, prossima.getDay())) return prossima;
  }
  return null;
}

// ---------------------------------------------------------------------------
// I libri. L'associazione e' un oggetto { idMateria: [idLibro, ...] } e non sa
// niente dei giorni: e' la schermata "Libri per materia" a riempirla, una volta
// sola, e da li' in poi l'orario fa il resto.
// ---------------------------------------------------------------------------
export function normalizzaAssociazioni(valore, libriEsistenti = null) {
  const esistono = libriEsistenti ? new Set(libriEsistenti.map((libro) => libro.id ?? libro)) : null;
  const risultato = {};
  for (const materia of MATERIE) {
    const elenco = Array.isArray(valore?.[materia.id]) ? valore[materia.id] : [];
    // Un libro cancellato dalla libreria sparisce anche da qui: tenerlo
    // vorrebbe dire un pulsante che apre il vuoto.
    risultato[materia.id] = [...new Set(elenco.filter((id) => typeof id === 'string' && (!esistono || esistono.has(id))))];
  }
  return risultato;
}

export function libriDiMateria(associazioni, idMateria, libri = []) {
  const perId = new Map(libri.map((libro) => [libro.id, libro]));
  return (normalizzaAssociazioni(associazioni)[idMateria] || [])
    .map((id) => perId.get(id))
    .filter(Boolean);
}

// La giornata come la vede la dashboard: una voce per materia, con i suoi
// libri gia' dentro. Materie senza libri restano nell'elenco, con la lista
// vuota: e' cosi' che la schermata puo' dire "questa materia non ha ancora un
// libro" invece di far sparire l'ora.
export function giornataDiScuola(orario, associazioni, libri, indiceGiorno) {
  return materieDelGiorno(orario, indiceGiorno).map((id) => ({
    id,
    nome: nomeMateria(id),
    libri: libriDiMateria(associazioni, id, libri),
  }));
}

// I libri da mettere nello zaino per un giorno: ogni libro una volta sola,
// nell'ordine delle ore. Due ore di arte non fanno due volte lo stesso libro.
export function libriDelGiorno(orario, associazioni, libri, indiceGiorno) {
  const zaino = [];
  for (const materia of giornataDiScuola(orario, associazioni, libri, indiceGiorno)) {
    for (const libro of materia.libri) {
      if (!zaino.some((dentro) => dentro.libro.id === libro.id)) zaino.push({ libro, materia: materia.nome });
    }
  }
  return zaino;
}
