// Le schermate dell'orario: la giornata, la settimana, il cambio dell'orario e
// l'associazione fra le materie e i libri.
//
// Le regole non stanno qui: stanno in orario.js, che non sa niente di schermo.
// Qui c'e' soltanto il disegno e il salvataggio.
//
// DOVE SI SALVA. Orario e associazione stanno nell'archivio `impostazioni`,
// che c'era gia'. Due righe: `orario` e `materie-libri`. Non servono archivi
// nuovi, e soprattutto entrano da soli nel backup e nel ripristino, che gia'
// portano le impostazioni. Un archivio nuovo avrebbe voluto dire alzare la
// versione del database e rifare il backup: piu' rischio, zero vantaggio.
import { DB } from './db.js';
import {
  MATERIE,
  CAMPANELLE,
  PAUSA,
  GIORNI,
  GIORNI_DI_SCUOLA,
  ORE_AL_GIORNO,
  FINE_LEZIONI,
  orarioIniziale,
  normalizzaOrario,
  normalizzaAssociazioni,
  nomeMateria,
  nomeDellOra,
  oreDelGiorno,
  giornoHaLezione,
  indiceDelGiorno,
  prossimoGiornoDiScuola,
  giornataDiScuola,
  libriDelGiorno,
  libriDiMateria,
} from './orario.js';

export const CHIAVE_ORARIO = 'orario';
export const CHIAVE_LIBRI = 'materie-libri';

// Quanti giorni avanti si possono scegliere per scrivere un compito. Due
// settimane: la prof di matematica che il 15 assegna per il 22 ci sta comoda.
const GIORNI_AVANTI = 14;

function elemento(tag, classe, testo) {
  const nodo = document.createElement(tag);
  if (classe) nodo.className = classe;
  if (testo !== undefined) nodo.textContent = testo;
  return nodo;
}

export function dataISO(data) {
  const mese = String(data.getMonth() + 1).padStart(2, '0');
  const giorno = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mese}-${giorno}`;
}

function dataDaISO(valore) {
  return new Date(`${valore}T12:00:00`);
}

function giornoPerEsteso(data) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(data);
}

export class OrarioManager {
  // `apriLibro` e `scriviCompito` restano fuori: sono cose di app.js, e questo
  // modulo non deve sapere come si apre un PDF ne' come e' fatto il modulo dei
  // compiti.
  constructor({ notify = () => {}, apriLibro = () => {}, scriviCompito = () => {}, vaiA = () => {} } = {}) {
    this.notify = notify;
    this.apriLibro = apriLibro;
    this.scriviCompito = scriviCompito;
    this.vaiA = vaiA;
    this.orario = orarioIniziale();
    this.associazioni = normalizzaAssociazioni({});
    this.libri = [];
    this.materiaInModifica = null;
  }

  // -------------------------------------------------------------------------
  // Archivio
  // -------------------------------------------------------------------------
  async carica() {
    const salvato = await DB.get('impostazioni', CHIAVE_ORARIO);
    // La prima volta vale l'orario arrivato dalla scuola. Da quel momento vale
    // sempre e solo la copia salvata, anche se qualcuno svuota una giornata.
    this.orario = salvato ? normalizzaOrario(salvato.valore) : orarioIniziale();
    this.libri = await DB.getAll('libri');
    const legami = await DB.get('impostazioni', CHIAVE_LIBRI);
    this.associazioni = normalizzaAssociazioni(legami?.valore, this.libri);
    return this;
  }

  async salvaOrario() {
    this.orario = normalizzaOrario(this.orario);
    await DB.put('impostazioni', { id: CHIAVE_ORARIO, valore: this.orario });
  }

  async salvaAssociazioni() {
    this.associazioni = normalizzaAssociazioni(this.associazioni, this.libri);
    await DB.put('impostazioni', { id: CHIAVE_LIBRI, valore: this.associazioni });
  }

  // I libri di una materia, per chi sta fuori: il compito che vuole aprire il
  // suo libro passa di qui.
  libriDi(idMateria) {
    return libriDiMateria(this.associazioni, idMateria, this.libri);
  }

  // -------------------------------------------------------------------------
  // La dashboard: le materie di oggi, i libri di oggi, lo zaino di domani.
  // -------------------------------------------------------------------------
  renderOggi(adesso = new Date()) {
    const oggi = indiceDelGiorno(adesso);
    const haLezione = giornoHaLezione(this.orario, oggi);
    const intestazione = document.querySelector('#oggi-eyebrow');
    if (intestazione) intestazione.textContent = giornoPerEsteso(adesso);
    const sottotitolo = document.querySelector('#oggi-subtitle');
    if (sottotitolo) {
      sottotitolo.textContent = haLezione
        ? `Cinque ore, dalle ${CAMPANELLE[0].inizio} alle ${FINE_LEZIONI}.`
        : 'Oggi niente lezioni. Qui sotto c’è già lo zaino del prossimo giorno di scuola.';
    }

    const materie = giornataDiScuola(this.orario, this.associazioni, this.libri, oggi);
    this.disegnaMaterie(document.querySelector('#oggi-materie'), materie, oggi, adesso);
    this.disegnaLibri(document.querySelector('#oggi-libri'), libriDelGiorno(this.orario, this.associazioni, this.libri, oggi), 'Oggi non serve nessun libro.');

    // Lo zaino guarda sempre avanti, anche dopo le 13:25: le lezioni sono
    // finite ma la giornata di oggi resta utile per i compiti ancora da fare.
    const domani = prossimoGiornoDiScuola(this.orario, adesso);
    const titoloZaino = document.querySelector('#zaino-titolo');
    const zaino = document.querySelector('#zaino-libri');
    if (!domani) {
      if (titoloZaino) titoloZaino.textContent = 'Nessun giorno di scuola in vista';
      this.disegnaLibri(zaino, [], 'L’orario è vuoto: riempilo da “Cambia l’orario”.');
      return;
    }
    const eDomani = Math.round((dataDaISO(dataISO(domani)) - dataDaISO(dataISO(adesso))) / 86400000) === 1;
    if (titoloZaino) titoloZaino.textContent = eDomani ? `Domani, ${giornoPerEsteso(domani)}` : giornoPerEsteso(domani);
    this.disegnaLibri(zaino, libriDelGiorno(this.orario, this.associazioni, this.libri, domani.getDay()), 'Per quel giorno non serve nessun libro.');
  }

  disegnaMaterie(posto, materie, indiceGiorno, data) {
    if (!posto) return;
    posto.replaceChildren();
    if (!materie.length) {
      posto.append(elemento('p', 'small-copy', 'Nessuna lezione in questo giorno.'));
      return;
    }
    for (const ora of oreDelGiorno(this.orario, indiceGiorno)) {
      const voce = elemento('div', 'ora-voce');
      voce.append(elemento('span', 'ora-campanella', `${ora.inizio}–${ora.fine}`));
      voce.append(elemento('strong', 'ora-materia', ora.nome));
      if (PAUSA.dopoOra === ora.numero) voce.classList.add('prima-della-pausa');
      posto.append(voce);
      if (PAUSA.dopoOra === ora.numero) {
        posto.append(elemento('div', 'ora-pausa', `Pausa ${PAUSA.inizio}–${PAUSA.fine}`));
      }
    }
    const scrivi = elemento('button', 'button secondary', 'Scrivi un compito di oggi');
    scrivi.type = 'button';
    scrivi.addEventListener('click', () => this.apriGiorno(dataISO(data)));
    posto.append(scrivi);
  }

  disegnaLibri(posto, zaino, vuoto) {
    if (!posto) return;
    posto.replaceChildren();
    if (!zaino.length) {
      const messaggio = elemento('p', 'small-copy', vuoto);
      posto.append(messaggio);
      // Senza associazione non ci sono libri da nessuna parte: si dice dove si
      // rimedia, invece di lasciare tre riquadri vuoti senza spiegazione.
      if (!Object.values(this.associazioni).some((elenco) => elenco.length)) {
        messaggio.textContent = 'I libri non sono ancora collegati alle materie.';
        const vai = elemento('button', 'button secondary', 'Collega i libri alle materie');
        vai.type = 'button';
        // Niente `data-go`: i pulsanti della navigazione si collegano una volta
        // sola all'avvio, e questo nasce dopo. Si chiama la navigazione a mano.
        vai.addEventListener('click', () => this.vaiA('materie-libri'));
        posto.append(vai);
      }
      return;
    }
    for (const voce of zaino) {
      const bottone = elemento('button', 'libro-pillola');
      bottone.type = 'button';
      bottone.append(elemento('strong', '', voce.libro.titolo));
      bottone.append(elemento('span', '', voce.materia));
      bottone.addEventListener('click', () => this.apriLibro(voce.libro.id));
      posto.append(bottone);
    }
  }

  // -------------------------------------------------------------------------
  // La settimana intera, dentro il diario.
  // -------------------------------------------------------------------------
  renderSettimana(adesso = new Date()) {
    const posto = document.querySelector('#orario-settimana');
    if (!posto) return;
    const oggi = indiceDelGiorno(adesso);
    const tabella = elemento('table', 'settimana-tabella');
    const testa = elemento('thead');
    const rigaTesta = elemento('tr');
    rigaTesta.append(elemento('th', 'colonna-ora', 'Ora'));
    for (const indice of GIORNI_DI_SCUOLA) {
      const cella = elemento('th', '', GIORNI[indice].nome);
      if (indice === oggi) cella.classList.add('oggi');
      rigaTesta.append(cella);
    }
    testa.append(rigaTesta);
    const corpo = elemento('tbody');
    for (let ora = 0; ora < ORE_AL_GIORNO; ora += 1) {
      const riga = elemento('tr');
      riga.append(elemento('th', 'colonna-ora', `${CAMPANELLE[ora].inizio}\n${CAMPANELLE[ora].fine}`));
      for (const indice of GIORNI_DI_SCUOLA) {
        const voce = oreDelGiorno(this.orario, indice)[ora];
        const cella = elemento('td', '', voce ? voce.nome : '—');
        if (indice === oggi) cella.classList.add('oggi');
        if (!voce || !voce.materie.length) cella.classList.add('libera');
        riga.append(cella);
      }
      corpo.append(riga);
      if (PAUSA.dopoOra === ora + 1) {
        const pausa = elemento('tr', 'riga-pausa');
        const cella = elemento('td', '', `Pausa ${PAUSA.inizio}–${PAUSA.fine}`);
        cella.colSpan = GIORNI_DI_SCUOLA.length + 1;
        pausa.append(cella);
        corpo.append(pausa);
      }
    }
    tabella.append(testa, corpo);
    posto.replaceChildren(tabella);
  }

  // I prossimi giorni fra cui scegliere per scrivere un compito. Solo i giorni
  // con lezione: un compito per domenica non esiste.
  renderProssimiGiorni(adesso = new Date()) {
    const posto = document.querySelector('#giorni-prossimi');
    if (!posto) return;
    posto.replaceChildren();
    for (let avanti = 0; avanti <= GIORNI_AVANTI; avanti += 1) {
      const data = new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate() + avanti);
      if (!giornoHaLezione(this.orario, data.getDay())) continue;
      const bottone = elemento('button', 'giorno-pillola');
      bottone.type = 'button';
      if (avanti === 0) bottone.classList.add('oggi');
      bottone.append(elemento('span', 'giorno-nome', GIORNI[data.getDay()].breve));
      bottone.append(elemento('strong', 'giorno-numero', String(data.getDate())));
      bottone.setAttribute('aria-label', `Scrivi un compito per ${giornoPerEsteso(data)}`);
      bottone.addEventListener('click', () => this.apriGiorno(dataISO(data)));
      posto.append(bottone);
    }
  }

  // -------------------------------------------------------------------------
  // Il giorno aperto: le materie di quel giorno della settimana, una per una.
  // Si tocca la materia e si scrive il compito li' sotto.
  // -------------------------------------------------------------------------
  // Un elenco di cose da toccare, dentro la finestrella. Lo usano sia il giorno
  // aperto dal diario sia il compito che vuole aprire il libro della materia:
  // e' la stessa domanda, "quale di questi?", e merita una risposta sola.
  mostraScelta({ eyebrow = '', titolo = '', nota = '', voci = [] }) {
    const dialogo = document.querySelector('#giorno-dialog');
    if (!dialogo) return;
    document.querySelector('#giorno-eyebrow').textContent = eyebrow;
    document.querySelector('#giorno-titolo').textContent = titolo;
    document.querySelector('#giorno-nota').textContent = nota;
    const posto = document.querySelector('#giorno-materie');
    posto.replaceChildren();
    for (const voce of voci) {
      const bottone = elemento('button', 'materia-scelta');
      bottone.type = 'button';
      bottone.append(elemento('strong', '', voce.nome));
      if (voce.sotto) bottone.append(elemento('span', '', voce.sotto));
      bottone.addEventListener('click', () => { dialogo.close(); voce.azione(); });
      posto.append(bottone);
    }
    dialogo.showModal();
  }

  apriGiorno(consegna) {
    const data = dataDaISO(consegna);
    const materie = giornataDiScuola(this.orario, this.associazioni, this.libri, data.getDay());
    this.mostraScelta({
      eyebrow: 'Scrivi un compito',
      titolo: giornoPerEsteso(data),
      nota: materie.length ? 'Tocca la materia giusta e scrivi il compito.' : 'In questo giorno non c’è lezione.',
      voci: materie.map((materia) => ({
        nome: materia.nome,
        sotto: materia.libri.length ? materia.libri.map((libro) => libro.titolo).join(' · ') : 'Nessun libro collegato',
        azione: () => this.scriviCompito({ idMateria: materia.id, materia: materia.nome, consegna }),
      })),
    });
  }

  // Dal compito scritto nel diario al libro giusto: un tocco. Se la materia ha
  // piu' di un libro si chiede quale, invece di indovinare.
  apriLibroDiMateria(idMateria) {
    const libri = this.libriDi(idMateria);
    if (!libri.length) {
      this.notify(`${nomeMateria(idMateria) || 'Questa materia'} non ha ancora un libro collegato.`, true);
      return;
    }
    if (libri.length === 1) {
      this.apriLibro(libri[0].id);
      return;
    }
    this.mostraScelta({
      eyebrow: nomeMateria(idMateria),
      titolo: 'Quale libro?',
      nota: 'Questa materia ha più di un libro.',
      voci: libri.map((libro) => ({ nome: libro.titolo, azione: () => this.apriLibro(libro.id) })),
    });
  }

  // -------------------------------------------------------------------------
  // Cambiare l'orario. Ogni ora e' una scelta: nessun cambio della scuola deve
  // mai piu' passare dal codice.
  // -------------------------------------------------------------------------
  renderEditor() {
    const posto = document.querySelector('#orario-editor');
    if (!posto) return;
    posto.replaceChildren();
    for (const indice of GIORNI_DI_SCUOLA) {
      const colonna = elemento('article', 'orario-giorno');
      colonna.append(elemento('h2', '', GIORNI[indice].nome));
      const ore = oreDelGiorno(this.orario, indice);
      for (let numero = 0; numero < ORE_AL_GIORNO; numero += 1) {
        colonna.append(this.campoOra(indice, numero, ore[numero]));
        if (PAUSA.dopoOra === numero + 1) colonna.append(elemento('p', 'ora-pausa', `Pausa ${PAUSA.inizio}–${PAUSA.fine}`));
      }
      posto.append(colonna);
    }
  }

  campoOra(indiceGiorno, numero, ora) {
    const campanella = CAMPANELLE[numero];
    const riga = elemento('div', 'orario-campo');
    riga.append(elemento('span', 'ora-campanella', `${campanella.inizio}–${campanella.fine}`));

    const scelta = elemento('select');
    scelta.setAttribute('aria-label', `${GIORNI[indiceGiorno].nome}, ${numero + 1}ª ora`);
    const attuale = (ora?.materie || []).join('+');
    const opzioni = [
      { valore: '', nome: 'Ora libera' },
      ...MATERIE.map((materia) => ({ valore: materia.id, nome: materia.nome })),
      { valore: 'storia+geografia', nome: 'Storia / Geografia (ora doppia)' },
    ];
    // Un'ora doppia diversa da storia/geografia, se mai arrivasse, non si perde
    // solo perche' questa schermata non l'aveva prevista.
    if (attuale && !opzioni.some((opzione) => opzione.valore === attuale)) {
      opzioni.push({ valore: attuale, nome: nomeDellOra(ora) });
    }
    for (const opzione of opzioni) {
      const nodo = elemento('option', '', opzione.nome);
      nodo.value = opzione.valore;
      scelta.append(nodo);
    }
    scelta.value = attuale;

    const etichetta = elemento('input');
    etichetta.type = 'text';
    etichetta.maxLength = 30;
    etichetta.placeholder = 'Etichetta (es. Antologia)';
    etichetta.value = ora?.etichetta || '';
    etichetta.setAttribute('aria-label', `Etichetta della ${numero + 1}ª ora di ${GIORNI[indiceGiorno].nome}`);

    const salva = async () => {
      if (!Array.isArray(this.orario[indiceGiorno]) || !this.orario[indiceGiorno].length) {
        this.orario[indiceGiorno] = Array.from({ length: ORE_AL_GIORNO }, () => ({ materie: [], etichetta: '' }));
      }
      this.orario[indiceGiorno][numero] = {
        materie: scelta.value ? scelta.value.split('+') : [],
        etichetta: etichetta.value.trim(),
      };
      await this.salvaOrario();
      this.renderSettimana();
      this.renderOggi();
      this.renderProssimiGiorni();
    };
    scelta.addEventListener('change', salva);
    etichetta.addEventListener('change', salva);

    riga.append(scelta, etichetta);
    return riga;
  }

  async ripristinaOrarioDellaScuola() {
    this.orario = orarioIniziale();
    await this.salvaOrario();
    this.renderEditor();
    this.renderSettimana();
    this.renderOggi();
    this.renderProssimiGiorni();
    this.notify('Rimesso l’orario arrivato dalla scuola.');
  }

  // -------------------------------------------------------------------------
  // I libri per materia. Si fa una volta e si cambia quando serve.
  // -------------------------------------------------------------------------
  renderLibriPerMateria() {
    const posto = document.querySelector('#materie-libri-elenco');
    if (!posto) return;
    posto.replaceChildren();
    const senzaLibri = document.querySelector('#materie-libri-vuoto');
    if (senzaLibri) senzaLibri.hidden = this.libri.length > 0;
    for (const materia of MATERIE) {
      const scheda = elemento('article', 'materia-scheda');
      scheda.append(elemento('h2', '', materia.nome));
      const scelti = this.libriDi(materia.id);
      const elenco = elemento('div', 'materia-libri');
      if (!scelti.length) elenco.append(elemento('p', 'small-copy', 'Nessun libro collegato.'));
      for (const libro of scelti) elenco.append(elemento('span', 'libro-tag', libro.titolo));
      scheda.append(elenco);
      const cambia = elemento('button', 'button secondary', scelti.length ? 'Cambia i libri' : 'Scegli i libri');
      cambia.type = 'button';
      cambia.disabled = this.libri.length === 0;
      cambia.addEventListener('click', () => this.apriSceltaLibri(materia));
      scheda.append(cambia);
      posto.append(scheda);
    }
  }

  apriSceltaLibri(materia) {
    const dialogo = document.querySelector('#materia-libri-dialog');
    if (!dialogo) return;
    this.materiaInModifica = materia.id;
    document.querySelector('#materia-libri-titolo').textContent = materia.nome;
    const posto = document.querySelector('#materia-libri-scelte');
    posto.replaceChildren();
    const scelti = new Set((this.associazioni[materia.id] || []));
    for (const libro of this.libri) {
      const riga = elemento('label', 'scelta-libro');
      const casella = elemento('input');
      casella.type = 'checkbox';
      casella.value = libro.id;
      casella.checked = scelti.has(libro.id);
      riga.append(casella, elemento('span', '', libro.titolo));
      posto.append(riga);
    }
    dialogo.showModal();
  }

  async confermaSceltaLibri() {
    if (!this.materiaInModifica) return;
    const scelti = [...document.querySelectorAll('#materia-libri-scelte input:checked')].map((casella) => casella.value);
    this.associazioni[this.materiaInModifica] = scelti;
    await this.salvaAssociazioni();
    this.materiaInModifica = null;
    this.renderLibriPerMateria();
    this.renderOggi();
    this.notify('Libri collegati alla materia.');
  }

  // Dopo un libro aggiunto o eliminato: l'elenco va riletto, altrimenti lo
  // zaino continuerebbe a proporre un libro che non c'e' piu'.
  async aggiornaLibri() {
    this.libri = await DB.getAll('libri');
    const prima = JSON.stringify(this.associazioni);
    this.associazioni = normalizzaAssociazioni(this.associazioni, this.libri);
    if (JSON.stringify(this.associazioni) !== prima) await this.salvaAssociazioni();
  }
}
