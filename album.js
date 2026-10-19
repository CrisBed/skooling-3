// Album delle attività: le foto dei laboratori, delle gite e delle giornate di
// classe che non appartengono a un compito. Restano sul dispositivo come tutto
// il resto.
//
// Le foto stanno dentro un ALBUM, che è una cartella con un nome. Quando si
// aggiunge una foto e non si è già dentro a un album, l'app ne propone uno
// nuovo col nome della data di oggi (13-09-2026), che si può cambiare subito o
// rinominare in qualunque momento, come si rinomina una cartella. Dentro
// l'album le foto si chiamano 1, 2, 3 finché non si dà loro un nome: così una
// festa e le sue singole foto si ritrovano per nome, non a memoria.
import { DB, createId } from './db.js';

// Le foto dei tablet sono grandi: si rimpiccioliscono prima di archiviarle, così
// l'album non si mangia lo spazio del dispositivo. Il lato lungo basta che stia
// dentro questa misura per vedersi bene anche a schermo intero.
const LATO_MASSIMO = 1600;

export async function ridimensionaFoto(file, latoMassimo = LATO_MASSIMO) {
  const immagine = await caricaImmagine(file);
  const lato = Math.max(immagine.width, immagine.height);
  const scala = lato > latoMassimo ? latoMassimo / lato : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(immagine.width * scala);
  canvas.height = Math.round(immagine.height * scala);
  canvas.getContext('2d').drawImage(immagine, 0, 0, canvas.width, canvas.height);
  immagine.close?.();
  const ridotta = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  // Se la foto era già piccola, comprimerla non conviene: si tiene l'originale.
  return ridotta && ridotta.size < file.size ? ridotta : file;
}

function caricaImmagine(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const immagine = new Image();
    immagine.onload = () => { URL.revokeObjectURL(url); resolve(immagine); };
    immagine.onerror = () => { URL.revokeObjectURL(url); reject(new Error('foto illeggibile')); };
    immagine.src = url;
  });
}

export function nomeDalFile(file) {
  const senzaEstensione = file.name.replace(/\.[a-z0-9]+$/i, '').trim();
  return senzaEstensione || 'Foto';
}

// Il nome proposto per un album nuovo: la data del giorno, nella forma in cui
// si scrive a mano sul quaderno.
export function nomeDataAlbum(quando = new Date()) {
  const due = (valore) => String(valore).padStart(2, '0');
  return `${due(quando.getDate())}-${due(quando.getMonth() + 1)}-${quando.getFullYear()}`;
}

// Il numero più alto già usato dentro un album: la foto nuova prende il
// successivo, così la numerazione non torna mai indietro nemmeno dopo che
// qualcuna è stata eliminata o rinominata.
export function numeroMassimo(foto, idAlbum) {
  return foto
    .filter((scatto) => scatto.idAlbum === idAlbum)
    .reduce((massimo, scatto) => Math.max(massimo, Number(scatto.numero) || 0), 0);
}

// Come si chiama una foto nell'elenco: il nome scelto, altrimenti il suo numero.
export function nomeFoto(scatto) {
  const titolo = (scatto.titolo || '').trim();
  return titolo || String(scatto.numero || 1);
}

// Le foto salvate prima che esistessero gli album non hanno una casa. Si
// raccolgono in un album per giornata, col nome della data in cui sono state
// scattate: nessuna foto resta fuori, e i nomi sono già quelli giusti.
export async function sistemaFotoSenzaAlbum() {
  const foto = await DB.getAll('foto');
  const orfane = foto.filter((scatto) => !scatto.idAlbum).sort((a, b) => (a.data || 0) - (b.data || 0));
  if (!orfane.length) return 0;
  const album = await DB.getAll('album');
  const perNome = new Map(album.map((voce) => [voce.nome, voce]));
  const nuovi = [];
  const contatori = new Map();
  const sistemate = orfane.map((scatto) => {
    const nome = nomeDataAlbum(new Date(scatto.data || Date.now()));
    let contenitore = perNome.get(nome);
    if (!contenitore) {
      contenitore = { id: createId('album'), nome, data: scatto.data || Date.now() };
      perNome.set(nome, contenitore);
      nuovi.push(contenitore);
    }
    const numero = (contatori.get(contenitore.id) ?? numeroMassimo(foto, contenitore.id)) + 1;
    contatori.set(contenitore.id, numero);
    return { ...scatto, idAlbum: contenitore.id, numero, titolo: scatto.titolo || String(numero) };
  });
  if (nuovi.length) await DB.putMany('album', nuovi);
  await DB.putMany('foto', sistemate);
  return sistemate.length;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function giornoLeggibile(quando) {
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(quando));
}

export class AlbumManager {
  constructor(options = {}) {
    this.notify = options.notify || (() => {});
    this.showProgress = options.showProgress || (() => {});
    this.hideProgress = options.hideProgress || (() => {});
    this.mostraFoto = options.mostraFoto || (() => {});
    // Gli indirizzi temporanei delle immagini si liberano a ogni ridisegno,
    // altrimenti la memoria cresce a ogni visita all'album.
    this.urls = [];
    // Quale album si sta guardando: null vuol dire l'elenco di tutti gli album.
    this.apertoId = null;
    // Le foto scelte che aspettano di sapere in quale album andare.
    this.inArrivo = [];
    this.bind();
  }

  bind() {
    document.querySelector('#album-input').addEventListener('change', (event) => this.fotoScelte(event.target.files));
    document.querySelector('#album-back').addEventListener('click', () => this.tornaAgliAlbum());
    document.querySelector('#album-target').addEventListener('change', () => this.aggiornaDialogo());
    document.querySelector('#album-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.confermaDestinazione();
    });
  }

  // ---- dove vanno le foto appena scelte ----------------------------------

  async fotoScelte(files) {
    const immagini = [...files].filter((file) => file.type.startsWith('image/'));
    document.querySelector('#album-input').value = '';
    if (!immagini.length) return this.notify('Scegli una foto.', true);
    // Dentro un album non c'è niente da chiedere: le foto entrano lì.
    if (this.apertoId) return this.aggiungi(immagini, this.apertoId);
    this.inArrivo = immagini;
    const album = (await DB.getAll('album')).sort((a, b) => b.data - a.data);
    const scelta = document.querySelector('#album-target');
    scelta.replaceChildren();
    const nuovo = document.createElement('option');
    nuovo.value = '';
    nuovo.textContent = 'Nuovo album';
    scelta.append(nuovo);
    for (const voce of album) {
      const opzione = document.createElement('option');
      opzione.value = voce.id;
      opzione.textContent = voce.nome;
      scelta.append(opzione);
    }
    scelta.value = '';
    document.querySelector('#album-name').value = nomeDataAlbum();
    document.querySelector('#album-dialog-count').textContent = immagini.length === 1
      ? 'Una foto da mettere via.'
      : `${immagini.length} foto da mettere via.`;
    this.aggiornaDialogo();
    document.querySelector('#album-dialog').showModal();
  }

  // Il nome si chiede solo per un album nuovo. Il campo nascosto perde anche
  // l'obbligo, altrimenti bloccherebbe l'invio restando invisibile.
  aggiornaDialogo() {
    const nuovo = !document.querySelector('#album-target').value;
    const riga = document.querySelector('#album-name-row');
    riga.hidden = !nuovo;
    document.querySelector('#album-name').required = nuovo;
  }

  async confermaDestinazione() {
    const scelto = document.querySelector('#album-target').value;
    const immagini = this.inArrivo;
    this.inArrivo = [];
    document.querySelector('#album-dialog').close();
    if (!immagini.length) return;
    let idAlbum = scelto;
    if (!idAlbum) {
      const nome = document.querySelector('#album-name').value.trim() || nomeDataAlbum();
      const album = { id: createId('album'), nome, data: Date.now() };
      await DB.put('album', album);
      idAlbum = album.id;
    }
    await this.aggiungi(immagini, idAlbum);
    // Appena messe via, si aprono: si vede subito dove sono finite.
    this.apertoId = idAlbum;
    await this.renderList();
  }

  async aggiungi(immagini, idAlbum) {
    const foto = await DB.getAll('foto');
    let numero = numeroMassimo(foto, idAlbum);
    let aggiunte = 0;
    for (let indice = 0; indice < immagini.length; indice += 1) {
      const file = immagini[indice];
      this.showProgress('Aggiungo le foto', `${indice + 1} di ${immagini.length}`, indice / immagini.length);
      try {
        numero += 1;
        await DB.put('foto', {
          id: createId('foto'),
          idAlbum,
          numero,
          // Di partenza la foto si chiama col suo numero: si rinomina quando serve.
          titolo: String(numero),
          immagine: await ridimensionaFoto(file),
          data: Date.now(),
        });
        aggiunte += 1;
      } catch {
        numero -= 1;
        this.notify(`“${file.name}” non si riesce a leggere. Le altre continuano.`, true);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.hideProgress();
    await this.renderList();
    if (aggiunte) this.notify(aggiunte === 1 ? 'Foto aggiunta all’album.' : `${aggiunte} foto aggiunte all’album.`);
  }

  // ---- i due livelli: gli album, e le foto dentro un album ----------------

  tornaAgliAlbum() {
    this.apertoId = null;
    return this.renderList();
  }

  async apri(idAlbum) {
    this.apertoId = idAlbum;
    await this.renderList();
  }

  liberaIndirizzi() {
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls = [];
  }

  immagineDi(scatto, testo) {
    if (!(scatto?.immagine instanceof Blob)) return '<div class="album-missing">Foto non disponibile</div>';
    const url = URL.createObjectURL(scatto.immagine);
    this.urls.push(url);
    return `<img src="${url}" alt="${escapeHtml(testo)}" loading="lazy">`;
  }

  async renderList() {
    const album = await DB.getAll('album');
    const foto = await DB.getAll('foto');
    // Se l'album aperto è stato eliminato altrove, si torna all'elenco.
    if (this.apertoId && !album.some((voce) => voce.id === this.apertoId)) this.apertoId = null;
    this.liberaIndirizzi();
    const griglia = document.querySelector('#album-grid');
    griglia.replaceChildren();
    if (this.apertoId) this.mostraAlbumAperto(album, foto, griglia);
    else this.mostraElencoAlbum(album, foto, griglia);
  }

  mostraElencoAlbum(album, foto, griglia) {
    document.querySelector('#album-back').hidden = true;
    document.querySelector('#album-eyebrow').textContent = 'Laboratori e giornate di classe';
    document.querySelector('#album-title').textContent = 'Album';
    document.querySelector('#album-subtitle').textContent = 'Ogni gita, festa o laboratorio ha il suo album.';
    document.querySelector('#album-empty').hidden = album.length > 0;
    const ordinati = [...album].sort((a, b) => b.data - a.data);
    for (const voce of ordinati) {
      griglia.append(this.schedaAlbum(voce, foto.filter((scatto) => scatto.idAlbum === voce.id)));
    }
  }

  mostraAlbumAperto(album, foto, griglia) {
    const aperto = album.find((voce) => voce.id === this.apertoId);
    const dentro = foto
      .filter((scatto) => scatto.idAlbum === aperto.id)
      .sort((a, b) => (a.numero || 0) - (b.numero || 0));
    document.querySelector('#album-back').hidden = false;
    document.querySelector('#album-eyebrow').textContent = 'Album';
    document.querySelector('#album-title').textContent = aperto.nome;
    document.querySelector('#album-subtitle').textContent = dentro.length === 1
      ? 'Una foto. Tocca “Cambia nome” per darle il suo.'
      : `${dentro.length} foto. Ognuna può avere il suo nome.`;
    document.querySelector('#album-empty').hidden = dentro.length > 0;
    for (const scatto of dentro) griglia.append(this.schedaFoto(scatto, aperto));
  }

  // ---- le due schede ------------------------------------------------------

  schedaAlbum(album, dentro) {
    const scheda = document.createElement('article');
    scheda.className = 'album-card';
    const copertina = [...dentro].sort((a, b) => (a.numero || 0) - (b.numero || 0))[0];
    const quante = dentro.length === 1 ? '1 foto' : `${dentro.length} foto`;
    scheda.innerHTML = `<button type="button" class="album-open">${this.immagineDi(copertina, album.nome)}</button>`
      + `<div class="album-info"><strong>${escapeHtml(album.nome)}</strong><span>${quante} · ${giornoLeggibile(album.data)}</span></div>`
      + '<button type="button" class="card-menu" aria-label="Azioni album">⋯</button>'
      + '<div class="card-actions" hidden><button type="button" data-rename>Rinomina album</button><button type="button" data-delete class="danger-text">Elimina album</button></div>';
    scheda.querySelector('.album-open').addEventListener('click', () => this.apri(album.id));
    this.collegaMenu(scheda);
    scheda.querySelector('[data-rename]').addEventListener('click', async () => {
      const nome = prompt('Come si chiama questo album?', album.nome);
      if (nome === null) return;
      await DB.put('album', { ...album, nome: nome.trim() || album.nome });
      await this.renderList();
    });
    scheda.querySelector('[data-delete]').addEventListener('click', async () => {
      const avviso = dentro.length
        ? `Eliminare l’album “${album.nome}” e le sue ${dentro.length === 1 ? 'foto' : `${dentro.length} foto`}?`
        : `Eliminare l’album “${album.nome}”?`;
      if (!confirm(avviso)) return;
      await DB.deleteWhere('foto', (scatto) => scatto.idAlbum === album.id);
      await DB.delete('album', album.id);
      await this.renderList();
      this.notify('Album eliminato.');
    });
    return scheda;
  }

  schedaFoto(scatto, album) {
    const scheda = document.createElement('article');
    scheda.className = 'album-card';
    const nome = nomeFoto(scatto);
    scheda.innerHTML = `<button type="button" class="album-open">${this.immagineDi(scatto, nome)}</button>`
      + `<div class="album-info"><strong>${escapeHtml(nome)}</strong><span>${giornoLeggibile(scatto.data)}</span></div>`
      + '<button type="button" class="card-menu" aria-label="Azioni foto">⋯</button>'
      + '<div class="card-actions" hidden><button type="button" data-rename>Cambia nome</button><button type="button" data-delete class="danger-text">Elimina foto</button></div>';
    scheda.querySelector('.album-open').addEventListener('click', () => this.mostraFoto({ titolo: `${album.nome} · ${nome}`, immagine: scatto.immagine }));
    this.collegaMenu(scheda);
    scheda.querySelector('[data-rename]').addEventListener('click', async () => {
      const titolo = prompt('Come si chiama questa foto?', nome);
      if (titolo === null) return;
      await DB.put('foto', { ...scatto, titolo: titolo.trim() || String(scatto.numero || 1) });
      await this.renderList();
    });
    scheda.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm(`Eliminare la foto “${nome}”?`)) return;
      await DB.delete('foto', scatto.id);
      await this.renderList();
      this.notify('Foto eliminata.');
    });
    return scheda;
  }

  collegaMenu(scheda) {
    scheda.querySelector('.card-menu').addEventListener('click', () => {
      const menu = scheda.querySelector('.card-actions');
      menu.hidden = !menu.hidden;
    });
  }
}
