import {Agenda} from './agenda.js';
import {initMenu} from './navigation.js';
import { renderGradebook } from './gradebook.js';
import { renderReview } from './flashcards.js';
import { initStudents } from './students.js';
import { Tutor } from './tutor.js';
// Coordinamento dell'applicazione e interfaccia principale.
import { DriveSync } from './drive-sync.js';
import { schoolQuiet } from './routine-model.js';
import { Routine } from './routine.js';
import { Studio } from './studio.js';
import { DB, createId } from './db.js';
import { PDFViewer, extractPdfCover } from './pdf-viewer.js';
import { NotebookManager } from './quaderni.js';
import { AlbumManager, ridimensionaFoto, sistemaFotoSenzaAlbum } from './album.js';
import { cercaNeiLibri, normalizza } from './ricerca.js';
import { mostraDiario } from './diario.js';
import { OrarioManager } from './orario-vista.js';
import { idMateriaDaNome, nomeMateria } from './orario.js';
import { downloadBlob } from './strumenti.js';

const state = { books: [], tasks: [], taskFilter: 'todo', coverUrls: [], fotoCompito: null, urlCompiti: [] };
let notebooks;
let album;
let orario;
let toastTimer;

export function notify(text, error = false) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 5200 : 3000);
}

export function showProgress(title, detail = '', value = 0) {
  document.querySelector('#progress-title').textContent = title;
  document.querySelector('#progress-detail').textContent = detail;
  document.querySelector('#progress-bar').value = value;
  document.querySelector('#progress-overlay').hidden = false;
}

export function hideProgress() {
  document.querySelector('#progress-overlay').hidden = true;
}

function showReview(){return renderReview(document.querySelector('#ripasso'),{notify,refresh:showReview});}

export function navigate(view, options={}) {
  if(view==='agenda') Agenda.render().catch(error=>notify(error.message,true));
  if(view==='voti') renderGradebook(document.querySelector('#voti'),{...options,notify}).catch(error=>notify(error.message,true));
  if(view==='ripasso') showReview().catch(error=>notify(error.message,true));
  if (view !== 'tutor') Tutor.leave();
  if (view === 'tutor') Tutor.render().catch(error => notify(error.message, true));
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === view));
  document.querySelectorAll('[data-go]').forEach((button) => button.classList.toggle('active', button.dataset.go === view));
  if (view === 'routine') Routine.render().catch(error => notify(error.message, true));
  if (['studio', 'progressi', 'viaggio'].includes(view)) Studio.render(view).catch(error => notify(error.message, true));
  if (view === 'libreria') renderLibrary();
  if (view === 'quaderni') notebooks.renderList();
  // Oggi, il biglietto e i giorni del diario si rifanno a ogni visita: se nel
  // frattempo e' passata la mezzanotte cambiano da soli, senza riavviare l'app.
  if (view === 'oggi') orario.renderOggi();
  if (view === 'compiti') { mostraDiario(); orario.renderSettimana(); orario.renderProssimiGiorni(); renderTasks(); }
  if (view === 'orario') orario.renderEditor();
  if (view === 'materie-libri') orario.renderLibriPerMateria();
  if (view === 'album') album.renderList();
  if (view === 'impostazioni') updateStorage();
  document.querySelector('#main-content').scrollTo?.(0, 0);
  verificaAggiornamentoInSospeso();
}

export const App = { navigate, notify, showProgress, hideProgress };

// Visore della foto a schermo pieno, usato dall'album e dai compiti.
let urlVisore;
export function mostraFoto({ titolo = '', immagine } = {}) {
  if (!(immagine instanceof Blob)) return;
  if (urlVisore) URL.revokeObjectURL(urlVisore);
  urlVisore = URL.createObjectURL(immagine);
  const dialogo = document.querySelector('#photo-dialog');
  document.querySelector('#photo-viewer-image').src = urlVisore;
  document.querySelector('#photo-viewer-image').alt = titolo;
  document.querySelector('#photo-viewer-title').textContent = titolo;
  dialogo.showModal();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}

function bindNavigation() {
  initMenu();
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  document.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.addEventListener('skooling:message', (event) => notify(event.detail.text, event.detail.error));
  document.addEventListener('skooling:reader-closed', () => { renderLibrary(); verificaAggiornamentoInSospeso(); });
  document.addEventListener('skooling:quaderno-chiuso', () => verificaAggiornamentoInSospeso());
  const onlineStatus = () => {
    const pill = document.querySelector('#offline-state');
    pill.textContent = navigator.onLine ? 'Pronto offline' : 'Modalità aereo';
    pill.classList.toggle('offline', !navigator.onLine);
  };
  window.addEventListener('online', onlineStatus);
  window.addEventListener('offline', onlineStatus);
  onlineStatus();
}

async function importPdfs(files) {
  const pdfs = [...files].filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) return notify('Scegli un file PDF.', true);
  let imported = 0;
  for (let index = 0; index < pdfs.length; index += 1) {
    const file = pdfs[index];
    showProgress('Aggiungo i libri', `${file.name} · ${index + 1} di ${pdfs.length}`, index / pdfs.length);
    try {
      const cover = await extractPdfCover(file);
      await DB.put('libri', {
        id: createId('libro'),
        titolo: file.name.replace(/\.pdf$/i, ''),
        materia: 'Da scegliere',
        copertina: cover,
        blob: file,
        data: Date.now(),
        ultimaPagina: 1,
      });
      imported += 1;
    } catch {
      notify(`“${file.name}” non sembra un PDF leggibile. Gli altri file continuano.`, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  hideProgress();
  document.querySelector('#pdf-input').value = '';
  await renderLibrary();
  await orario.aggiornaLibri();
  if (imported) notify(imported === 1 ? 'Libro aggiunto alla libreria.' : `${imported} libri aggiunti alla libreria.`);
}

async function renderLibrary() {
  state.books = (await DB.getAll('libri')).sort((a, b) => b.data - a.data);
  // Il segnaposto di lettura sta in un archivio suo: rimetterlo sul libro solo
  // per mostrarlo, senza toccare il libro salvato.
  const letture = new Map((await DB.getAll('letture')).map((l) => [l.id, l.pagina]));
  for (const libro of state.books) libro.ultimaPagina = letture.get(libro.id) || libro.ultimaPagina || 1;
  state.coverUrls.forEach((url) => URL.revokeObjectURL(url));
  state.coverUrls = [];
  const query = document.querySelector('#book-search').value.trim().toLocaleLowerCase('it');
  const subject = document.querySelector('#book-subject-filter').value;
  const subjects = [...new Set(state.books.map((book) => book.materia).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const filter = document.querySelector('#book-subject-filter');
  const selected = filter.value;
  filter.innerHTML = '<option value="">Tutte le materie</option>' + subjects.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  filter.value = subjects.includes(selected) ? selected : '';
  const filtered = state.books.filter((book) => (!query || `${book.titolo} ${book.materia}`.toLocaleLowerCase('it').includes(query)) && (!subject || book.materia === subject));
  document.querySelector('#library-empty').hidden = state.books.length > 0;
  const grid = document.querySelector('#book-grid');
  grid.replaceChildren();
  if (!filtered.length && state.books.length) {
    const message = document.createElement('div');
    message.className = 'empty-state compact';
    message.innerHTML = '<h2>Nessun libro trovato</h2><p>Prova un’altra parola o cambia materia.</p>';
    grid.append(message);
  }
  for (const book of filtered) grid.append(makeBookCard(book));
}

function makeBookCard(book) {
  const article = document.createElement('article');
  article.className = 'book-card';
  let cover = `<div class="book-cover-placeholder">${escapeHtml(book.titolo)}</div>`;
  if (book.copertina instanceof Blob) {
    const url = URL.createObjectURL(book.copertina);
    state.coverUrls.push(url);
    cover = `<img src="${url}" alt="Copertina di ${escapeHtml(book.titolo)}">`;
  }
  article.innerHTML = `<button type="button" class="book-open"><div class="book-cover">${cover}</div><div class="book-info"><strong>${escapeHtml(book.titolo)}</strong><span>${escapeHtml(book.materia)} · Riprendi da pagina ${book.ultimaPagina || 1}</span></div></button><button type="button" class="card-menu" aria-label="Azioni per ${escapeHtml(book.titolo)}">⋯</button><div class="card-actions" hidden><button type="button" data-edit>Rinomina e materia</button><button type="button" data-delete class="danger-text">Elimina libro</button></div>`;
  article.querySelector('.book-open').addEventListener('click', () => book.blob instanceof Blob ? openBook(book.id, book.ultimaPagina) : attachBookPDF(book));
  if (!(book.blob instanceof Blob)) article.querySelector('.book-info span').textContent = 'Collega PDF su questo dispositivo';
  article.querySelector('.card-menu').addEventListener('click', () => { const menu = article.querySelector('.card-actions'); menu.hidden = !menu.hidden; });
  article.querySelector('[data-edit]').addEventListener('click', () => openBookDialog(book));
  article.querySelector('[data-delete]').addEventListener('click', () => deleteBook(book));
  return article;
}

function attachBookPDF(book) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/pdf,.pdf';
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    showProgress('Collego il PDF', 'Conservo le scritte già sincronizzate…', .2);
    try {
      const cover = await extractPdfCover(file);
      const current = await DB.get('libri', book.id);
      if (!current) throw Error('Il libro è stato eliminato. Riprova dalla libreria.');
      await DB.put('libri', { ...current, blob: file, copertina: cover });
      await renderLibrary(); notify('PDF collegato. Le scritte sono conservate.');
    } catch (error) { notify(error.message, true); } finally { hideProgress(); }
  }); input.click();
}

async function openBook(id, page = 1, evidenzia = '') {
  if(DriveSync.isBusy())return notify('Attendi la fine dell’aggiornamento dei dispositivi prima di aprire il libro.');
  const book = await DB.get('libri', id);
  if (book && !(book.blob instanceof Blob)) { attachBookPDF(book); return; }

  showProgress('Apro il libro', 'Preparo la pagina…', 0.25);
  try {
    PDFViewer.setDrawWithFinger(document.querySelector('#global-finger-draw').checked);
    await PDFViewer.open(id, page, evidenzia);
  } catch (error) {
    notify(error.message, true);
  } finally {
    hideProgress();
  }
}

function openBookDialog(book) {
  document.querySelector('#edit-book-id').value = book.id;
  document.querySelector('#edit-book-title').value = book.titolo;
  document.querySelector('#edit-book-subject').value = book.materia;
  document.querySelector('#book-dialog').showModal();
}

async function deleteBook(book) {
  if (!confirm(`Eliminare “${book.titolo}” e tutte le sue annotazioni?`)) return;
  chiudiRicerca();
  await DB.delete('libri', book.id);
  // Via anche il testo indicizzato: senza il libro non serve più a nessuno.
  await DB.delete('indicelibri', book.id).catch(() => {});
  await DB.delete('letture', book.id).catch(() => {});
  await DB.deleteWhere('annotazioni', (item) => item.idLibro === book.id);
  await DB.deleteWhere('segnalibri', (item) => item.idLibro === book.id);
  await renderLibrary();
  await orario.aggiornaLibri();
  notify('Libro eliminato.');
}

// ---------------------------------------------------------------------------
// Ricerca dentro i libri. Il testo dentro il PDF ce lo mette l'OCR dello
// scanner: Skooling lo legge soltanto. Un libro ancora senza testo non è un
// errore, viene solo lasciato fuori dai risultati e detto in fondo, così si sa
// quali mancano ancora di passare nello scanner.
// ---------------------------------------------------------------------------
function evidenziaNellaFrase(frase, termine) {
  const semplice = normalizza(frase);
  const da = semplice.indexOf(normalizza(termine));
  if (da < 0) return escapeHtml(frase);
  return `${escapeHtml(frase.slice(0, da))}<mark>${escapeHtml(frase.slice(da, da + termine.length))}</mark>${escapeHtml(frase.slice(da + termine.length))}`;
}

function chiudiRicerca() {
  document.querySelector('#search-results').hidden = true;
  document.querySelector('#book-grid').hidden = false;
  document.querySelector('#library-empty').hidden = state.books.length > 0;
}

async function cercaNelTestoDeiLibri() {
  const richiesta = document.querySelector('#book-search').value.trim();
  if (richiesta.length < 2) return notify('Scrivi almeno due lettere da cercare.', true);
  const libri = state.books;
  if (!libri.length) return notify('Non c’è ancora nessun libro in libreria.', true);

  const pannello = document.querySelector('#search-results');
  const elenco = document.querySelector('#search-results-list');
  const nota = document.querySelector('#search-results-note');
  document.querySelector('#book-grid').hidden = true;
  document.querySelector('#library-empty').hidden = true;
  document.querySelector('#search-results-title').textContent = `“${richiesta}”`;
  elenco.replaceChildren();
  nota.hidden = true;
  pannello.hidden = false;

  let trovati = 0;
  showProgress('Cerco dentro i libri', 'Preparo la ricerca…', 0);
  try {
    const { senzaTesto } = await cercaNeiLibri(libri, richiesta, {
      onProgress: ({ libro, fatti, totale, avanzamentoLibro }) => {
        const quota = (fatti + avanzamentoLibro) / Math.max(1, totale);
        showProgress('Cerco dentro i libri', libro ? `${libro.titolo} · ${fatti + 1} di ${totale}` : 'Finito', quota);
      },
      onLibro: ({ libro, pagine }) => {
        if (!pagine.length) return;
        trovati += pagine.length;
        elenco.append(schedaRisultati(libro, pagine, richiesta));
      },
    });
    if (!trovati) {
      const vuoto = document.createElement('p');
      vuoto.className = 'search-empty';
      vuoto.textContent = 'Nessuna pagina con questa parola nei libri che hanno il testo.';
      elenco.append(vuoto);
    }
    if (senzaTesto.length) {
      nota.textContent = `Ricerca non disponibile per: ${senzaTesto.map((libro) => libro.titolo).join(', ')}. `
        + 'Sono scansioni senza testo: lo avranno dopo il passaggio nello scanner con il riconoscimento del testo.';
      nota.hidden = false;
    }
  } catch (error) {
    notify('La ricerca non è riuscita. Riprova.', true);
  } finally {
    hideProgress();
  }
}

function schedaRisultati(libro, pagine, richiesta) {
  const blocco = document.createElement('div');
  blocco.className = 'search-book';
  const titolo = document.createElement('h3');
  titolo.textContent = `${libro.titolo} · ${pagine.length} ${pagine.length === 1 ? 'pagina' : 'pagine'}`;
  blocco.append(titolo);
  for (const trovata of pagine) {
    const voce = document.createElement('button');
    voce.type = 'button';
    voce.className = 'search-hit';
    voce.innerHTML = `<span class="search-page">Pagina ${trovata.numero}</span>`
      + `<span class="search-phrase">${evidenziaNellaFrase(trovata.frase, richiesta)}</span>`;
    voce.addEventListener('click', () => openBook(libro.id, trovata.numero, richiesta));
    blocco.append(voce);
  }
  return blocco;
}

function bindLibrary() {
  document.querySelector('#search-inside').addEventListener('click', cercaNelTestoDeiLibri);
  document.querySelector('#search-close').addEventListener('click', chiudiRicerca);
  document.querySelector('#book-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); cercaNelTestoDeiLibri(); }
  });
  document.querySelector('#pdf-input').addEventListener('change', (event) => importPdfs(event.target.files));
  // Cambiare la richiesta o la materia vuol dire ricominciare: i risultati di
  // prima si chiudono, altrimenti resterebbero appesi sopra la libreria.
  document.querySelector('#book-search').addEventListener('input', () => { chiudiRicerca(); renderLibrary(); });
  document.querySelector('#book-subject-filter').addEventListener('change', () => { chiudiRicerca(); renderLibrary(); });
  document.querySelector('#book-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.querySelector('#edit-book-id').value;
    const book = await DB.get('libri', id);
    if (!book) return;
    book.titolo = document.querySelector('#edit-book-title').value.trim();
    book.materia = document.querySelector('#edit-book-subject').value.trim();
    await DB.put('libri', book);
    document.querySelector('#book-dialog').close();
    await renderLibrary();
    notify('Dettagli del libro aggiornati.');
  });
}

function tomorrowDate() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function populateTaskLinks(selected = '') {
  const select = document.querySelector('#task-link');
  const books = await DB.getAll('libri');
  const notebookItems = await DB.getAll('quaderni');
  select.innerHTML = '<option value="">Nessun collegamento</option>'
    + books.map((book) => `<option value="libro|${book.id}">Libro: ${escapeHtml(book.titolo)}</option>`).join('')
    + notebookItems.map((notebook) => `<option value="quaderno|${notebook.id}">Quaderno: ${escapeHtml(notebook.titolo)}</option>`).join('');
  select.value = selected;
  document.querySelector('#task-link-page-row').hidden = !select.value;
}

// La foto scelta per il compito che si sta scrivendo: si tiene da parte finché
// il compito non viene salvato.
function mostraFotoCompito(immagine) {
  state.fotoCompito = immagine instanceof Blob ? immagine : null;
  const anteprima = document.querySelector('#task-photo-preview');
  const togli = document.querySelector('#task-photo-remove');
  if (anteprima.src.startsWith('blob:')) URL.revokeObjectURL(anteprima.src);
  if (!state.fotoCompito) {
    anteprima.removeAttribute('src');
    anteprima.hidden = true;
    togli.hidden = true;
    return;
  }
  anteprima.src = URL.createObjectURL(state.fotoCompito);
  anteprima.hidden = false;
  togli.hidden = false;
}

// Apre il foglio di un compito nuovo. Arrivando dal giorno del diario la
// materia e la consegna sono gia' decise: Gabriel ha toccato la materia giusta
// dentro il giorno giusto, e non deve scriverle un'altra volta.
async function apriNuovoCompito({ materia = '', idMateria = '', consegna = '' } = {}) {
  document.querySelector('#task-form').reset();
  document.querySelector('#edit-task-id').value = '';
  document.querySelector('#task-dialog-title').textContent = materia ? `Compito di ${materia}` : 'Nuovo compito';
  document.querySelector('#task-subject').value = materia;
  document.querySelector('#task-materia-id').value = idMateria;
  document.querySelector('#task-due').value = consegna || tomorrowDate();
  mostraFotoCompito(null);
  await populateTaskLinks();
  document.querySelector('#task-dialog').showModal();
  if (materia) document.querySelector('#task-description').focus();
}

function bindTasks() {
  document.querySelector('#new-task').addEventListener('click', () => apriNuovoCompito());
  document.querySelector('#task-photo').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return notify('Scegli una foto.', true);
    try {
      mostraFotoCompito(await ridimensionaFoto(file));
    } catch {
      notify('Questa foto non si riesce a leggere. Riprova a scattarla.', true);
    }
  });
  document.querySelector('#task-photo-remove').addEventListener('click', () => mostraFotoCompito(null));
  document.querySelector('#task-link').addEventListener('change', (event) => { document.querySelector('#task-link-page-row').hidden = !event.target.value; });
  document.querySelectorAll('[data-task-filter]').forEach((button) => button.addEventListener('click', () => {
    state.taskFilter = button.dataset.taskFilter;
    document.querySelectorAll('[data-task-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderTasks();
  }));
  document.querySelector('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.querySelector('#edit-task-id').value || createId('compito');
    const previous = await DB.get('compiti', id);
    const [tipo = '', linkId = ''] = document.querySelector('#task-link').value.split('|');
    await DB.put('compiti', {
      id,
      materia: document.querySelector('#task-subject').value.trim(),
      // L'id della materia e' quello che poi apre il libro giusto. Se il
      // compito e' stato scritto a mano si ricava dal testo, quando combacia.
      idMateria: document.querySelector('#task-materia-id').value
        || idMateriaDaNome(document.querySelector('#task-subject').value),
      descrizione: document.querySelector('#task-description').value.trim(),
      consegna: document.querySelector('#task-due').value,
      stato: previous?.stato || 'todo',
      collegamento: tipo ? { tipo, id: linkId, pagina: Number(document.querySelector('#task-link-page').value) || 1 } : null,
      foto: state.fotoCompito,
      data: previous?.data || Date.now(),
    });
    mostraFotoCompito(null);
    document.querySelector('#task-dialog').close();
    await renderTasks();
    notify('Compito salvato.');
  });
}

async function renderTasks() {
  state.tasks = (await DB.getAll('compiti')).sort((a, b) => a.consegna.localeCompare(b.consegna));
  state.urlCompiti.forEach((url) => URL.revokeObjectURL(url));
  state.urlCompiti = [];
  const filtered = state.tasks.filter((task) => state.taskFilter === 'all' || task.stato === state.taskFilter);
  document.querySelector('#task-empty').hidden = filtered.length > 0;
  const list = document.querySelector('#task-list');
  list.replaceChildren();
  for (const task of filtered) list.append(makeTaskCard(task));
  document.dispatchEvent(new Event('skooling:agenda-changed'));
}

function makeTaskCard(task) {
  const article = document.createElement('article');
  article.className = `task-card${task.stato === 'done' ? ' done' : ''}`;
  const due = new Date(`${task.consegna}T12:00:00`);
  const overdue = task.stato !== 'done' && due < new Date(new Date().toDateString());
  const dateLabel = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(due);
  let miniatura = '';
  if (task.foto instanceof Blob) {
    const url = URL.createObjectURL(task.foto);
    state.urlCompiti.push(url);
    miniatura = `<button type="button" class="task-photo" aria-label="Apri la foto del compito"><img src="${url}" alt=""></button>`;
  }
  // La materia del compito apre il libro della materia, quando ce n'e' uno
  // collegato: e' il tocco che porta Gabriel dal compito al libro giusto.
  const idMateria = task.idMateria || idMateriaDaNome(task.materia);
  const conLibro = Boolean(idMateria) && orario.libriDi(idMateria).length > 0;
  const materiaHtml = conLibro
    ? `<button type="button" class="task-materia" aria-label="Apri il libro di ${escapeHtml(nomeMateria(idMateria))}">${escapeHtml(nomeMateria(idMateria))} <span aria-hidden="true">▤</span></button>`
    : escapeHtml(task.materia);
  article.innerHTML = `<button type="button" class="task-check" aria-label="${task.stato === 'done' ? 'Segna da fare' : 'Segna fatto'}">✓</button>${miniatura}<div class="task-copy"><strong>${escapeHtml(task.descrizione)}</strong><span>${materiaHtml}${task.collegamento ? ' · Ha un collegamento' : ''}</span></div><div class="task-date${overdue ? ' overdue' : ''}">${overdue ? 'Scaduto · ' : ''}${dateLabel}</div><div class="task-actions">${task.collegamento ? '<button type="button" data-open-link aria-label="Apri collegamento">↗</button>' : ''}<button type="button" data-edit aria-label="Modifica compito">✎</button><button type="button" data-delete class="danger-text" aria-label="Elimina compito">×</button></div>`;
  article.querySelector('.task-check').addEventListener('click', async () => { task.stato = task.stato === 'done' ? 'todo' : 'done'; await DB.put('compiti', task); renderTasks(); });
  article.querySelector('.task-photo')?.addEventListener('click', () => mostraFoto({ titolo: task.descrizione, immagine: task.foto }));
  article.querySelector('.task-materia')?.addEventListener('click', () => orario.apriLibroDiMateria(idMateria));
  article.querySelector('[data-open-link]')?.addEventListener('click', () => openTaskLink(task));
  article.querySelector('[data-edit]').addEventListener('click', () => editTask(task));
  article.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!confirm('Eliminare questo compito?')) return;
    await DB.delete('compiti', task.id);
    renderTasks();
  });
  return article;
}

async function editTask(task) {
  document.querySelector('#edit-task-id').value = task.id;
  document.querySelector('#task-dialog-title').textContent = 'Modifica compito';
  document.querySelector('#task-subject').value = task.materia;
  document.querySelector('#task-materia-id').value = task.idMateria || idMateriaDaNome(task.materia);
  document.querySelector('#task-description').value = task.descrizione;
  document.querySelector('#task-due').value = task.consegna;
  mostraFotoCompito(task.foto);
  const linkValue = task.collegamento ? `${task.collegamento.tipo}|${task.collegamento.id}` : '';
  await populateTaskLinks(linkValue);
  document.querySelector('#task-link-page').value = task.collegamento?.pagina || 1;
  document.querySelector('#task-dialog').showModal();
}

async function openTaskLink(task) {
  const link = task.collegamento;
  if (!link) return;
  if (link.tipo === 'libro') await openBook(link.id, link.pagina);
  else await notebooks.open(link.id, link.pagina);
}

function bindOrario() {
  document.querySelector('#orario-ripristina').addEventListener('click', async () => {
    if (!confirm('Rimettere l’orario arrivato dalla scuola? Le ore cambiate a mano si perdono.')) return;
    await orario.ripristinaOrarioDellaScuola();
  });
  document.querySelector('#materia-libri-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await orario.confermaSceltaLibri();
    document.querySelector('#materia-libri-dialog').close();
  });
}

function bindSettings() {
  const finger = document.querySelector('#global-finger-draw');
  finger.addEventListener('change', async () => {
    await DB.put('impostazioni', { id: 'disegna-dito', valore: finger.checked });
    PDFViewer.setDrawWithFinger(finger.checked);
    notebooks.setDrawWithFinger(finger.checked);
  });
  const backupMode = document.querySelector('#backup-mode');
  backupMode.addEventListener('change', () => {
    document.querySelector('#backup-mode-copy').textContent = backupMode.value === 'completo'
      ? 'Conserva tutti i dati, compresi i PDF dei libri senza scritte. Utile prima di cambiare tablet.'
      : 'Conserva tutti i quaderni, le scritte, i materiali, i risultati e le routine. Include i PDF dei libri annotati; gli altri libri vanno reimportati dopo il ripristino.';
  });
  document.querySelector('#export-backup').addEventListener('click', async () => {
    const mode = backupMode.value;
    showProgress('Creo il backup', 'Raccolgo i dati scelti…', 0);
    try {
      const backup = await DB.exportBackup((value) => showProgress('Creo il backup', 'Raccolgo i dati scelti…', value), { mode });
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(backup, `Skooling-backup-${mode}-${date}.skooling`);
      notify('Backup pronto. Conservalo in un posto sicuro.');
    } catch {
      notify('Il backup non è riuscito. Controlla lo spazio e riprova.', true);
    } finally { hideProgress(); }
  });
  document.querySelector('#import-backup').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    if (!confirm('Importando il backup sostituirai i dati presenti su questo dispositivo. Continuare?')) { event.target.value = ''; return; }
    document.dispatchEvent(new Event('skooling:backup-importing'));
    showProgress('Importo il backup', 'Tieni aperta l’app durante l’importazione.', 0);
    try {
      await DB.importBackup(file, (value) => showProgress('Importo il backup', value < 0.85 ? 'Leggo e controllo libri e quaderni…' : 'Completo il ripristino…', value));
      notify('Backup importato. Skooling si riavvia.');
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      notify(error.message, true);
    } finally {
      event.target.value = '';
      hideProgress();
    }
  });
}

async function updateStorage() {
  try {
    const missing = (await DB.get('impostazioni', 'backup-libri-esclusi'))?.valore || [];
    const books = await DB.getAll('libri');
    const present = new Set(books.map(book => book.id));
    const remaining = missing.filter(book => !present.has(book.id));
    const list = document.querySelector('#backup-missing-list');
    list.replaceChildren(...remaining.map(book => { const li = document.createElement('li'); li.textContent = `${book.titolo}${book.materia ? ' · ' + book.materia : ''} `;
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'button secondary'; dismiss.textContent = 'Già reimportato';
      dismiss.addEventListener('click', async () => { const saved = (await DB.get('impostazioni', 'backup-libri-esclusi'))?.valore || []; await DB.put('impostazioni', { id: 'backup-libri-esclusi', valore: saved.filter(item => item.id !== book.id) }); await updateStorage(); });
      li.append(dismiss); return li; }));
    document.querySelector('#backup-missing').hidden = !remaining.length;
    const status = await DB.storageStatus();
    const percent = status.quota ? Math.min(100, status.usage / status.quota * 100) : 0;
    document.querySelector('#storage-bar').style.width = `${percent}%`;
    document.querySelector('#storage-copy').textContent = status.quota
      ? `${formatBytes(status.usage)} usati, ${formatBytes(status.remaining)} ancora disponibili.`
      : 'Lo spazio è gestito automaticamente dall’iPad.';
    document.querySelector('#persistence-copy').textContent = status.persisted
      ? 'Protezione dei dati offline attiva.'
      : 'Safari gestisce automaticamente la conservazione dei dati.';
    if (status.low) notify('Lo spazio sta finendo. Esporta un backup e libera spazio sull’iPad.', true);
  } catch {
    document.querySelector('#storage-copy').textContent = 'Lo spazio è gestito automaticamente dall’iPad.';
  }
}

// ---------------------------------------------------------------------------
// Aggiornamento a distanza. Skooling non ha un server: la versione nuova arriva
// dal service worker. All'avvio e a ogni ritorno online l'app chiede se c'è una
// versione nuova; quando c'è, il service worker nuovo prende il posto del
// vecchio e l'app si ricarica da sola. Chi la usa non deve fare nulla, e non
// resta bloccato su una copia vecchia.
// ---------------------------------------------------------------------------
let aggiornamentoInSospeso = false;
document.addEventListener('skooling:map-closed', verificaAggiornamentoInSospeso);
document.addEventListener('close', verificaAggiornamentoInSospeso, true);
document.addEventListener('skooling:tutor-idle', verificaAggiornamentoInSospeso);
function editingOpen(){return Boolean(document.querySelector('dialog[open]'))||Tutor.isBusy()||(Tutor.inSession()&&document.querySelector('#tutor')?.classList.contains('active'));}

function applicaAggiornamento() {
  if(DB.session?.dirty||DriveSync.isBusy()||document.querySelector('dialog[open]')){aggiornamentoInSospeso=true;return;}
  // Se c'è un libro o un quaderno aperto si aspetta: il lavoro è già salvato,
  // ma ricaricare sotto le mani mentre si scrive sarebbe sgradevole.
  if (editingOpen() || !document.querySelector('#progress-overlay').hidden) { aggiornamentoInSospeso = true; return; }
  if (document.body.classList.contains('workspace-open')) {
    aggiornamentoInSospeso = true;
    if (!schoolQuiet()) notify('Skooling si è aggiornato. La versione nuova parte appena chiudi il libro o il quaderno.');
    return;
  }
  if (!schoolQuiet()) notify('Skooling si è aggiornato.');
  setTimeout(() => { if(DB.session?.dirty||DriveSync.isBusy()||document.querySelector('dialog[open]')){aggiornamentoInSospeso=true;return;} if (editingOpen()) { aggiornamentoInSospeso = true; return; } location.reload(); }, 800);
}

export function verificaAggiornamentoInSospeso() {
  if(DB.session?.dirty||DriveSync.isBusy()||document.querySelector('dialog[open]'))return;
  if (editingOpen()) return;
  if (!aggiornamentoInSospeso || document.body.classList.contains('workspace-open') || !document.querySelector('#progress-overlay').hidden) return;
  aggiornamentoInSospeso = false;
  location.reload();
}

// Chiede la versione al worker che controlla questo dispositivo, anche offline.
// Leggere sw.js dalla rete mostrerebbe invece la versione disponibile sul server.
async function mostraVersioneInstallata(worker = navigator.serviceWorker?.controller) {
  const label = document.querySelector('#app-version');
  if (!worker) { label.textContent = 'Versione non disponibile'; return; }
  const channel = new MessageChannel();
  const chiudi = () => { channel.port1.close(); channel.port2.close(); };
  const timer = setTimeout(() => { label.textContent = 'Versione non disponibile'; chiudi(); }, 3000);
  channel.port1.onmessage = (event) => {
    clearTimeout(timer);
    label.textContent = /^\d+$/.test(event.data?.versione)
      ? `Versione ${event.data.versione}` : 'Versione non disponibile';
    chiudi();
  };
  worker.postMessage('skooling:versione', [channel.port2]);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) { document.querySelector('#app-version').textContent = 'Versione non disponibile'; return; }
  try {
    // updateViaCache 'none': il file sw.js si scarica sempre dalla rete, mai
    // dalla cache del browser. È questo che fa arrivare l'aggiornamento subito.
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    const giaControllato = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.ready.then((ready) => mostraVersioneInstallata(navigator.serviceWorker.controller || ready.active));
    let ricaricato = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      mostraVersioneInstallata();
      if (!giaControllato || ricaricato) return;
      ricaricato = true;
      applicaAggiornamento();
    });
    const controlla = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    controlla();
    window.addEventListener('online', controlla);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') controlla(); });
  } catch {
    notify('Per usare Skooling offline, aprilo da un indirizzo sicuro e ricarica.', true);
  }
}

async function start() {
  try {
    await DB.init();
    notebooks = new NotebookManager({ notify, showProgress, hideProgress });
    album = new AlbumManager({ notify, showProgress, hideProgress, mostraFoto });
    orario = new OrarioManager({
      notify,
      apriLibro: (id) => openBook(id),
      scriviCompito: (dettagli) => apriNuovoCompito(dettagli),
      vaiA: navigate,
    });
    await orario.carica();
    initStudents({notify,canSwitch:()=>!document.body.classList.contains('workspace-open')&&document.querySelector('#progress-overlay').hidden&&!document.querySelector('dialog[open]')&&!Studio.isRecording()&&!Tutor.isBusy()&&!DriveSync.isBusy()});
    bindNavigation();
    bindLibrary();
    bindTasks();
    bindOrario();
    bindSettings();
    const fingerSetting = await DB.get('impostazioni', 'disegna-dito');
    document.querySelector('#global-finger-draw').checked = Boolean(fingerSetting?.valore);
    PDFViewer.setDrawWithFinger(Boolean(fingerSetting?.valore));
    notebooks.setDrawWithFinger(Boolean(fingerSetting?.valore));
    // Le foto salvate prima degli album vanno messe in un album per giornata,
    // altrimenti sparirebbero dall'elenco pur restando nell'archivio.
    await sistemaFotoSenzaAlbum();
    mostraDiario();
    orario.renderOggi();
    orario.renderSettimana();
    orario.renderProssimiGiorni();
    await Promise.all([renderLibrary(), notebooks.renderList(), renderTasks(), album.renderList(), updateStorage()]);
    Tutor.init({ navigate, notify });
    Studio.init({ openTutor: topic => Tutor.open(topic), navigate, notify, openBook, openNotebook: (id, page) => notebooks.open(id, page),
      openStudy: async (topic) => {
        document.body.classList.add('study-split');
        for (const selector of ['#reader-tools', '#notebook-tools']) document.querySelector(selector).hidden = true;
        for (const selector of ['#toggle-reader-tools', '#toggle-notebook-tools']) document.querySelector(selector).classList.remove('active');
        await openBook(topic.libro, topic.pagina);
        if (document.querySelector('#lettore-pdf').hidden) { document.body.classList.remove('study-split'); return; }
        await notebooks.open(topic.quaderno, 1);
        if (document.querySelector('#editor-quaderno').hidden) document.body.classList.remove('study-split');
      }
    });
    for (const event of ['skooling:reader-closed', 'skooling:quaderno-chiuso']) document.addEventListener(event, () => {
      document.body.classList.remove('study-split');
      if (!document.querySelector('#lettore-pdf').hidden || !document.querySelector('#editor-quaderno').hidden) document.body.classList.add('workspace-open');
      window.dispatchEvent(new Event('resize'));
    });
    await Routine.init({ notify });
    await DriveSync.init();
    document.addEventListener('skooling:sync-applied', async () => {
      await orario.carica();
      const active = document.querySelector('.view.active')?.id;
      if (active) navigate(active);
    });
    await Agenda.init({navigate,newHomework:()=>apriNuovoCompito(),editHomework:async id=>editTask(await DB.get('compiti',id)),newExam:()=>navigate('voti',{addNew:true}),editExam:id=>navigate('voti',{editId:id})});
    navigate('tutor');
    await registerServiceWorker();
  } catch (error) {
    notify(error.message || 'Skooling non riesce ad avviarsi. Ricarica la pagina.', true);
  }
}

start();
