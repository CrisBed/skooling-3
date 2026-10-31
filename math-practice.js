import { DB, createId } from './db.js';
import {
  PRACTICE_QUESTIONS, createPracticeStore, startPractice, advancePractice,
  answerPractice, hintPractice, finishPractice, checkAnswer, resumePractice, reflectPractice,
} from './math-practice-model.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dateLabel = value => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' }).format(typeof value === 'number' ? new Date(value) : new Date(value + 'T12:00:00Z'));
const button = (action, text, primary = false) => `<button type="button" class="button ${primary ? 'primary' : 'secondary'}" data-math-action="${action}">${text}</button>`;

// Disegno locale, senza immagini esterne. Le etichette esplicitano la quantità anche senza colore.
export function fractionPizza(numerator, denominator) {
  const label = `${numerator} fette colorate su ${denominator} parti uguali`;
  const slices = Array.from({ length: denominator }, (_, index) => {
    const start = index * 2 * Math.PI / denominator - Math.PI / 2;
    const end = (index + 1) * 2 * Math.PI / denominator - Math.PI / 2;
    const x1 = 100 + 84 * Math.cos(start), y1 = 100 + 84 * Math.sin(start);
    const x2 = 100 + 84 * Math.cos(end), y2 = 100 + 84 * Math.sin(end);
    return `<path d="M 100 100 L ${x1.toFixed(3)} ${y1.toFixed(3)} A 84 84 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" class="${index < numerator ? 'math-slice-filled' : 'math-slice-empty'}"/>`;
  }).join('');
  return `<figure class="math-pizza"><svg viewBox="0 0 200 200" role="img" aria-label="${label}"><title>${label}</title>${slices}<circle cx="100" cy="100" r="84" class="math-pizza-edge"/></svg><figcaption><strong>${numerator}/${denominator}</strong><span>${label}</span></figcaption></figure>`;
}

function workedExample() {
  return `<div class="math-pizza-pair">${fractionPizza(1, 2)}<span class="math-equals" aria-label="uguale a">=</span>${fractionPizza(2, 4)}</div><p class="math-key-idea">Più pezzi, stessa quantità: <strong>1/2 = 2/4</strong>.</p><p>Taglia ogni metà in due. I pezzi diventano quattro e quelli colorati diventano due. La parte colorata è ancora metà pizza.</p><dl class="math-definitions"><div><dt>Numeratore</dt><dd>Il numero sopra la linea: quante parti prendi.</dd></div><div><dt>Denominatore</dt><dd>Il numero sotto la linea: in quante parti uguali dividi l’intero.</dd></div></dl>`;
}

let api = {}, current = null, epoch = 0;

function controller(container, isCurrent) {
  const store = createPracticeStore(DB);
  let progress, screen = 'home', selectedId = null, returnTo = 'summary';
  let busy = false, work = Promise.resolve();
  const find = selector => container.querySelector(selector);
  const storageNote = () => DB.session?.temporary
    ? 'Prova temporanea su questo computer. I progressi restano nella sessione aperta; l’archivio approvato resta protetto.'
    : 'I progressi sono salvati nell’archivio di questo profilo.';

  function heading(kicker, title, text = '') {
    return `<div class="math-heading"><p class="eyebrow">${h(kicker)}</p><h1 tabindex="-1">${h(title)}</h1>${text ? `<p>${h(text)}</p>` : ''}</div>`;
  }

  function shell(content, focus = true) {
    if (!isCurrent()) return;
    container.innerHTML = `<div class="math-practice">${content}<p class="math-storage-note">${h(storageNote())}</p></div>`;
    container.querySelectorAll('[data-math-action]').forEach(b => b.addEventListener('click', () => action(b.dataset.mathAction)));
    if (focus) find('h1')?.focus({ preventScroll: true });
  }

  function fail(error) {
    if (!isCurrent()) return;
    shell(`${heading('MATEMATICA', 'Riprendiamo con calma')}<article class="math-card"><p role="alert">${h(error.message || 'Il salvataggio non è riuscito. I dati precedenti sono conservati.')}</p><p>Riapri il percorso per rileggere l’ultimo salvataggio.</p><div class="math-actions">${button('reload', 'Riapri il percorso', true)}</div></article>`);
  }

  async function change(makeProgress, nextScreen = 'session') {
    if (busy) return;
    busy = true;
    container.querySelectorAll('button,input,textarea,select').forEach(element => { element.disabled = true; });
    work = (async () => {
      progress = await store.save(makeProgress());
      screen = nextScreen;
      if (screen === 'summary') selectedId = progress.history.at(-1)?.id;
      paint();
    })();
    try { await work; } catch (error) { fail(error); }
    finally { busy = false; }
  }

  function paintHome() {
    const completed = progress.history.filter(s => s.status === 'completed').at(-1);
    shell(`${heading('PERCORSO DI PROVA: FRAZIONI', 'Matematica, un passo alla volta', 'Circa 10 minuti. Nessun conto alla rovescia: puoi fermarti e riprendere.')}<article class="math-card math-welcome"><p class="math-small-label">IL NOSTRO OBIETTIVO</p><h2>Capire perché 1/2 e 2/4 sono la stessa quantità.</h2><p>Guardiamo una pizza, riconosciamo i due numeri di una frazione e proviamo tre piccoli passaggi.</p><p class="math-source">Esempio preparato per questa prova. Non è tratto da un libro caricato.</p>${progress.active ? '<p class="math-resume-note">Hai un tentativo in corso. Riprendi dal punto in cui eri.</p>' : ''}${completed ? `<p>Ripasso suggerito: <strong>${h(dateLabel(completed.reviewOn))}</strong>. Puoi rivederlo quando vuoi.</p>` : ''}<div class="math-actions">${button(progress.active ? 'resume' : 'start', progress.active ? 'Riprendi il percorso' : 'Inizia con la pizza', true)}${progress.active ? button('start', 'Comincia un nuovo tentativo') : ''}${progress.history.length ? button('history', 'Rivedi i tuoi tentativi') : ''}</div>${progress.active ? '<p class="math-caption">Un nuovo tentativo conserva quello attuale tra i tentativi da riprendere.</p>' : ''}</article>`);
  }

  function paintSession() {
    const session = progress.active;
    if (!session) { screen = 'home'; return paintHome(); }
    const step = session.step;
    const stage = ['Un esempio insieme', 'Il numeratore', 'Il denominatore', 'La stessa metà', 'Con parole tue'][step];
    const top = `${heading('PERCORSO DI PROVA: FRAZIONI', stage)}<p class="math-step">Passaggio ${step + 1} di 5</p><progress class="math-progress" max="5" value="${step + 1}" aria-label="Passaggio ${step + 1} di 5"></progress>`;
    if (step === 0) {
      shell(`${top}<article class="math-card">${workedExample()}<div class="math-actions">${button('next', 'Provo io', true)}${button('pause', 'Mi fermo qui')}</div></article>`);
      return;
    }
    if (step === 4) {
      shell(`${top}<article class="math-card"><h2>Perché 1/2 e 2/4 valgono la stessa quantità?</h2><p>Scrivi come lo spiegheresti a un amico. Bastano poche parole, anche un’idea ancora da completare.</p><label class="math-reflection-label" for="math-reflection">Il mio ragionamento<textarea id="math-reflection" maxlength="800" rows="4" placeholder="Secondo me la quantità resta uguale perché…">${h(session.reflection)}</textarea></label><p class="math-caption">Questo è un appunto da rileggere, senza correzione automatica. Puoi anche saltarlo per ora.</p><p id="math-form-feedback" role="status" aria-live="polite"></p><div class="math-actions">${button('finish', 'Salva il pensiero e concludi', true)}${button('skip', 'Per ora salto')}${button('pause', 'Mi fermo qui')}</div></article>`);
      return;
    }
    const question = PRACTICE_QUESTIONS[step - 1], answer = session.answers[question.id];
    const feedback = answer.attempts ? checkAnswer(question.id, answer.value) : null;
    const input = question.choices
      ? `<fieldset class="math-choices" ${answer.correct ? 'disabled' : ''}><legend>Scegli un numero</legend>${question.choices.map(value => `<label class="math-choice"><input type="radio" name="math-choice" value="${value}" ${answer.value === value ? 'checked' : ''}><span>${value}</span></label>`).join('')}</fieldset>`
      : `<label class="math-answer-label" for="math-answer">La mia frazione<input id="math-answer" type="text" inputmode="text" autocomplete="off" spellcheck="false" maxlength="40" placeholder="Per esempio 1/2" value="${h(answer.value)}" ${answer.correct ? 'readonly' : ''}></label><p class="math-caption">Puoi usare una frazione equivalente. Non serve ridurla ai minimi termini.</p>`;
    shell(`${top}<article class="math-card"><h2 id="math-question">${h(question.title)}</h2><div class="math-question-layout">${fractionPizza(step === 3 ? 2 : 3, 4)}<form id="math-question-form" aria-labelledby="math-question">${input}<div id="math-form-feedback" class="math-feedback ${answer.correct ? 'math-feedback-correct' : ''}" role="status" aria-live="polite">${feedback ? `<p>${h(feedback.message)}</p>` : ''}</div>${answer.hints ? `<ol class="math-hints">${question.hints.slice(0, answer.hints).map(text => `<li>${h(text)}</li>`).join('')}</ol>` : ''}<div class="math-actions">${answer.correct ? button('next', 'Continuo', true) : '<button class="button primary" type="submit">Controlla con me</button>'}${!answer.correct && answer.hints < 2 ? button('hint', answer.hints ? 'Un altro indizio' : 'Un indizio') : ''}${button('pause', 'Mi fermo qui')}</div></form></div></article>`);
    find('#math-question-form').addEventListener('submit', event => {
      event.preventDefault();
      if (answer.correct || busy) return;
      const value = question.choices ? find('input[name="math-choice"]:checked')?.value || '' : find('#math-answer').value;
      const result = checkAnswer(question.id, value);
      if (result.kind === 'invalid') {
        find('#math-form-feedback').textContent = result.message;
        find('#math-answer')?.focus();
        return;
      }
      change(() => answerPractice(progress, value, Date.now()));
    });
  }

  function selected() { return progress.history.find(s => s.id === selectedId) || progress.history.at(-1); }

  function paintSummary() {
    const session = selected();
    if (!session) { screen = 'home'; return paintHome(); }
    selectedId = session.id;
    const completed = session.status === 'completed';
    const hintsUsed = Object.values(session.answers).some(a => a.hints > 0);
    const learned = PRACTICE_QUESTIONS.filter(q => session.answers[q.id].correct);
    const past = progress.history.slice().reverse();
    shell(`${heading('IL TUO PERCORSO CON LE FRAZIONI', completed ? 'Un piccolo passo fatto.' : 'Questo tentativo si può riprendere.', `Tentativo del ${dateLabel(session.startedAt)}`)}<article class="math-card">${past.length > 1 ? `<label class="math-history-label" for="math-history-select">I tentativi conservati<select id="math-history-select">${past.map((s, index) => `<option value="${h(s.id)}" ${s.id === session.id ? 'selected' : ''}>${h(dateLabel(s.startedAt))}, ${s.status === 'completed' ? 'concluso' : 'da riprendere'} (${past.length - index})</option>`).join('')}</select></label>` : ''}<h2>${completed ? 'Cosa hai incontrato' : 'Cosa hai già esplorato'}</h2>${learned.length ? `<ul class="math-learned">${learned.map(q => `<li>${h(q.explanation)}</li>`).join('')}</ul>` : '<p>Abbiamo iniziato dall’esempio della pizza. Puoi tornare lì con calma.</p>'}${hintsUsed ? '<p>Hai usato gli indizi per orientarti. Puoi usarli di nuovo quando ti servono.</p>' : ''}${session.reflection ? `<div class="math-saved-thought"><h3>Il tuo pensiero</h3><p>${h(session.reflection)}</p><small>Un appunto da rileggere, senza valutazione automatica.</small></div>` : ''}${completed ? `<p class="math-review-date">Ripasso suggerito: <strong>${h(dateLabel(session.reviewOn))}</strong>.</p><p>Prova a spiegare perché 1/2 = 2/4, poi inventa un’altra frazione che vale metà. Puoi parlarne con un adulto.</p>` : ''}<div class="math-actions">${button(completed ? 'example' : 'recover', completed ? 'Rivedi l’esempio' : 'Riprendi da qui', true)}${button('start', 'Provo di nuovo')}${button('home', 'Torna a Matematica')}</div><p class="math-caption">I tentativi precedenti rimangono conservati.</p></article>`);
    find('#math-history-select')?.addEventListener('change', event => { selectedId = event.target.value; paint(); });
  }

  function paint() {
    if (!isCurrent()) return;
    if (screen === 'home') return paintHome();
    if (screen === 'session') return paintSession();
    if (screen === 'summary') return paintSummary();
    shell(`${heading('RIVEDIAMO INSIEME', 'Una pizza, due modi di dividerla')}<article class="math-card">${workedExample()}<div class="math-actions">${button(returnTo, 'Torna al riepilogo', true)}${button('start', 'Provo di nuovo')}</div></article>`);
  }

  async function flush() {
    const text = find('#math-reflection')?.value;
    await work;
    if (text !== undefined && progress?.active?.step === 4 && text !== progress.active.reflection) {
      progress = await store.save(reflectPractice(progress, text, Date.now()));
    }
  }

  function action(name) {
    if (busy) return;
    if (name === 'reload') return MathPractice.render(container);
    if (name === 'start') return change(() => startPractice(progress, createId('math'), Date.now()));
    if (name === 'resume') { screen = 'session'; return paint(); }
    if (name === 'next') return change(() => advancePractice(progress, Date.now()));
    if (name === 'hint') return change(() => hintPractice(progress, Date.now()));
    if (name === 'recover') return change(() => resumePractice(progress, selected().id, createId('math'), Date.now()));
    if (name === 'pause') {
      const text = find('#math-reflection')?.value;
      if (text !== undefined && text !== progress.active.reflection) return change(() => reflectPractice(progress, text, Date.now()), 'home');
      screen = 'home'; return paint();
    }
    if (name === 'finish' || name === 'skip') {
      const text = find('#math-reflection').value;
      if (name === 'finish' && !text.trim()) { find('#math-form-feedback').textContent = 'Scrivi un pensiero oppure scegli «Per ora salto».'; find('#math-reflection').focus(); return; }
      return change(() => finishPractice(progress, text, name === 'skip', Date.now()), 'summary');
    }
    if (name === 'history') { selectedId = progress.history.at(-1)?.id; screen = 'summary'; return paint(); }
    if (name === 'example') { returnTo = 'summary'; screen = 'example'; return paint(); }
    if (name === 'summary' || name === 'home') { screen = name; return paint(); }
  }

  return {
    async load() { try { progress = await store.load(); paint(); } catch (error) { fail(error); } },
    flush,
  };
}

export const MathPractice = {
  init(options = {}) { api = options; },
  async render(container = document.querySelector('#matematica')) {
    if (!container) throw Error('La pagina di Matematica non è disponibile.');
    const visit = ++epoch, previous = current;
    current = null;
    try { await previous?.flush(); } catch (error) { api.notify?.(error.message, true); }
    if (visit !== epoch) return;
    current = controller(container, () => visit === epoch);
    await current.load();
  },
  async leave() {
    ++epoch;
    const previous = current;
    current = null;
    await previous?.flush();
  },
};
