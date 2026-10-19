// Il diario: il biglietto del giorno nella sezione Compiti.
//
// È la direzione che Cristian ha scelto fra le tre bozze, quella chiamata
// "Smemo": scritta a mano, biglietto con l'ombra netta e la rotazione leggera,
// nastro adesivo per la data, e metà schermo dedicata alla roba del giorno,
// l'altra metà ai compiti veri.
//
// Il contenuto NON si scrive a mano ogni sera: l'app se lo porta dentro, 240
// giorni già pronti in diario-contenuti.js, e ne mostra uno al giorno.
import { CONTENUTI_DIARIO } from './diario-contenuti.js';

export const GIORNI_DEL_DIARIO = CONTENUTI_DIARIO.length;

// Il giorno da cui si comincia a contare. Serve solo come punto fermo: non
// cambia niente di importante, ma se lo si sposta cambia quale biglietto esce
// oggi, quindi si lascia dov'è.
const PRIMO_GIORNO = Date.UTC(2026, 8, 1);

// Di quanto si salta nell'elenco a ogni giorno che passa.
//
// 91 e 240 non hanno divisori in comune, e questo basta a garantire da solo le
// due cose chieste: saltando di 91 in 91 si passa una volta per TUTTI e 240 i
// biglietti prima di rivederne uno, e quando finiscono il giro ricomincia da
// capo. Nessun elenco da tenere, nessuna memoria da consultare: basta la data.
//
// Il salto grande serve anche a un'altra cosa: nel file i contenuti stanno
// raggruppati per tipo, e saltando di 91 due giorni di fila non capitano quasi
// mai nello stesso gruppo. Lunedì una battuta, martedì una curiosità.
const PASSO = 91;

export const ETICHETTE = {
  battuta: 'La battuta di oggi',
  quiz: 'Quiz lampo',
  curiosita: 'Lo sapevi?',
  sfida: 'La sfida di oggi',
  oroscopo: 'L’oroscopo della scuola',
  parola: 'La parola di oggi',
};

// Quanti giorni sono passati dal punto fermo. Si conta in UTC sulla data locale
// del calendario, così l'ora legale non fa saltare un giorno avanti o indietro.
export function numeroDelGiorno(data = new Date()) {
  const giorno = Date.UTC(data.getFullYear(), data.getMonth(), data.getDate());
  return Math.round((giorno - PRIMO_GIORNO) / 86400000);
}

export function indiceDelGiorno(data = new Date()) {
  const salto = numeroDelGiorno(data) * PASSO;
  return ((salto % GIORNI_DEL_DIARIO) + GIORNI_DEL_DIARIO) % GIORNI_DEL_DIARIO;
}

export function contenutoDelGiorno(data = new Date()) {
  return CONTENUTI_DIARIO[indiceDelGiorno(data)];
}

export function dataSulNastro(data = new Date()) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(data);
}

function elemento(tag, classe, testo) {
  const nodo = document.createElement(tag);
  if (classe) nodo.className = classe;
  if (testo !== undefined) nodo.textContent = testo;
  return nodo;
}

// Il corpo del biglietto cambia col tipo di contenuto. Il quiz è l'unico con
// cui si gioca: si tocca una risposta e si scopre subito com'è andata.
function corpoDelBiglietto(contenuto) {
  const corpo = elemento('div', 'smemo-body');
  if (contenuto.t === 'quiz') {
    corpo.append(elemento('p', 'smemo-testo', contenuto.domanda));
    const risposte = elemento('div', 'smemo-risposte');
    const esito = elemento('p', 'smemo-esito');
    esito.hidden = true;
    contenuto.risposte.forEach((risposta, indice) => {
      const bottone = elemento('button', 'smemo-risposta', risposta);
      bottone.type = 'button';
      bottone.addEventListener('click', () => {
        if (risposte.classList.contains('rispolto')) return; // una volta sola
        risposte.classList.add('rispolto');
        risposte.querySelectorAll('button').forEach((altro, posto) => {
          altro.classList.toggle('giusta', posto === contenuto.giusta);
          altro.classList.toggle('sbagliata', altro === bottone && posto !== contenuto.giusta);
          altro.disabled = true;
        });
        esito.textContent = (indice === contenuto.giusta ? 'Giusto! ' : 'Non ci siamo. ') + contenuto.dopo;
        esito.hidden = false;
      });
      risposte.append(bottone);
    });
    corpo.append(risposte, esito);
    return corpo;
  }
  if (contenuto.t === 'curiosita') {
    corpo.append(elemento('p', 'smemo-titoletto', contenuto.titolo));
    corpo.append(elemento('p', 'smemo-testo', contenuto.testo));
    return corpo;
  }
  if (contenuto.t === 'oroscopo') {
    corpo.append(elemento('p', 'smemo-titoletto', contenuto.segno));
    corpo.append(elemento('p', 'smemo-testo', contenuto.testo));
    return corpo;
  }
  if (contenuto.t === 'parola') {
    corpo.append(elemento('p', 'smemo-parola', contenuto.parola));
    corpo.append(elemento('p', 'smemo-testo', contenuto.significato));
    return corpo;
  }
  corpo.append(elemento('p', 'smemo-testo', contenuto.testo));
  return corpo;
}

export function creaBiglietto(data = new Date(), contenuto = contenutoDelGiorno(data)) {
  const biglietto = elemento('article', 'smemo-card');
  biglietto.dataset.tipo = contenuto.t;
  biglietto.append(elemento('span', 'smemo-tape', dataSulNastro(data)));
  biglietto.append(elemento('p', 'smemo-kicker', ETICHETTE[contenuto.t] || 'Oggi'));
  biglietto.append(corpoDelBiglietto(contenuto));
  return biglietto;
}

// Disegna il biglietto di oggi nella metà schermo che gli spetta. Si ridisegna
// a ogni visita alla sezione: se nel frattempo è passata la mezzanotte, il
// biglietto cambia da solo senza riavviare l'app.
export function mostraDiario(data = new Date()) {
  const posto = document.querySelector('#diario-oggi');
  if (!posto) return null;
  const biglietto = creaBiglietto(data);
  posto.replaceChildren(biglietto);
  return biglietto;
}
