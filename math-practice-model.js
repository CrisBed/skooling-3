// Percorso preparato: nessuna chiamata AI, nessun voto e nessuna inferenza sullo studente.
import { canonical } from './sync-model.js';

export const PRACTICE_KEY = 'math-practice-fractions-v1';
export const PRACTICE_QUESTIONS = Object.freeze([
  { id: 'numerator', title: 'Hai preso 3/4 di pizza. Quale numero conta le fette prese?', correct: '3', choices: ['3', '4'],
    hints: ['Il numeratore indica quante parti stai prendendo.', 'È il numero sopra la linea: in 3/4 stai prendendo 3 parti.'],
    retry: 'Il 4 conta tutte le parti della pizza. Qui cerchiamo le fette prese: guarda il numero sopra la linea.',
    explanation: 'Il 3 conta le fette prese. Questo numero si chiama numeratore.' },
  { id: 'denominator', title: 'In 3/4, quale numero racconta come è stata tagliata la pizza?', correct: '4', choices: ['3', '4'],
    hints: ['Il denominatore indica in quante parti uguali è diviso l’intero.', 'È il numero sotto la linea: in 3/4 l’intero è diviso in 4 parti uguali.'],
    retry: 'Il 3 conta le fette prese. Guarda invece tutte le parti della pizza: il numero sotto la linea.',
    explanation: 'Il 4 dice che la pizza è divisa in quattro parti uguali: è il denominatore.' },
  { id: 'half', title: 'Trova un modo di scrivere metà pizza.', correct: '1/2',
    hints: ['Puoi contare le fette colorate e poi tutte le fette.', 'Nella pizza sono colorate 2 fette su 4: 2/4 vale quanto 1/2. Anche altri tagli possono dare la stessa metà.'],
    retry: 'Cerchiamo la stessa quantità di mezza pizza. Conta le fette scelte e tutte le fette: con 4 parti uguali, quante ne prenderesti?',
    explanation: 'Funziona: la tua frazione vale ancora metà pizza. Cambiano i pezzi, la quantità resta la stessa.' },
]);

export function parseFraction(value) {
  if (typeof value !== 'string' || !/^\s*\d{1,5}\s*\/\s*\d{1,5}\s*$/.test(value)) {
    throw Error('Scrivi due numeri interi con una barra, per esempio 1/2.');
  }
  const [numerator, denominator] = value.split('/').map(Number);
  if (numerator > 10000 || denominator < 1 || denominator > 10000) {
    throw Error('Usa numeri da 0 a 10000. Il numero sotto la linea deve essere maggiore di zero.');
  }
  return { numerator, denominator };
}

export function reduceFraction({ numerator, denominator }) {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || numerator > 10000 || !Number.isSafeInteger(denominator) || denominator < 1 || denominator > 10000) {
    throw Error('Frazione non valida.');
  }
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

export function equivalentFractions(left, right) {
  const a = reduceFraction(parseFraction(left)), b = reduceFraction(parseFraction(right));
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

export function checkAnswer(questionId, value) {
  const question = PRACTICE_QUESTIONS.find(q => q.id === questionId);
  if (!question) throw Error('Passaggio del percorso non valido.');
  const text = typeof value === 'string' ? value.trim() : '';
  if (question.choices && !question.choices.includes(text)) return { kind: 'invalid', message: 'Scegli uno dei due numeri.' };
  try {
    const correct = question.choices ? text === question.correct : equivalentFractions(text, question.correct);
    return { kind: correct ? 'correct' : 'retry', message: correct ? question.explanation : question.retry };
  } catch (error) { return { kind: 'invalid', message: error.message }; }
}

export function emptyProgress() { return { version: 1, active: null, history: [] }; }

function timestamp(value) { return Number.isSafeInteger(value) && value >= 0; }
function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value; }

export function nextReviewDate(now) {
  if (!timestamp(now)) throw Error('Data del percorso non valida.');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const day = ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validateSession(value, active) {
  const bad = () => { throw Error('Il percorso salvato non è leggibile. È conservato senza modificarlo.'); };
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 160
      || !timestamp(value.startedAt) || !timestamp(value.updatedAt) || value.updatedAt < value.startedAt
      || !Number.isInteger(value.step) || value.step < 0 || value.step > 5 || !value.answers
      || typeof value.reflection !== 'string' || value.reflection.length > 800 || typeof value.reflectionSkipped !== 'boolean') bad();
  if (active ? value.status !== 'active' || value.step === 5 || value.endedAt !== null || value.reviewOn !== null
    : !['completed', 'paused'].includes(value.status) || !timestamp(value.endedAt) || value.endedAt < value.updatedAt) bad();
  if (value.status === 'completed') {
    if (value.step !== 5 || !validDay(value.reviewOn) || value.reviewOn !== nextReviewDate(value.endedAt)
      || (!value.reflectionSkipped && !value.reflection.trim())) bad();
  } else if (value.step > 4 || value.reviewOn !== null) bad();
  const answers = {};
  PRACTICE_QUESTIONS.forEach((question, index) => {
    const a = value.answers[question.id];
    if (!a || typeof a.value !== 'string' || a.value.length > 40 || typeof a.correct !== 'boolean'
      || !Number.isSafeInteger(a.attempts) || a.attempts < 0 || !Number.isInteger(a.hints) || a.hints < 0 || a.hints > 2) bad();
    if (a.attempts === 0 ? a.value !== '' || a.correct : checkAnswer(question.id, a.value).kind === 'invalid' || a.correct !== (checkAnswer(question.id, a.value).kind === 'correct')) bad();
    if (value.step > index + 1 && !a.correct) bad();
    if (value.step < index + 1 && (a.attempts || a.hints)) bad();
    answers[question.id] = { value: a.value, correct: a.correct, attempts: a.attempts, hints: a.hints };
  });
  return {
    id: value.id, startedAt: value.startedAt, updatedAt: value.updatedAt, step: value.step,
    status: value.status, answers, reflection: value.reflection, reflectionSkipped: value.reflectionSkipped,
    endedAt: value.endedAt, reviewOn: value.reviewOn,
  };
}

export function validatePractice(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.history) || !Object.hasOwn(value, 'active')) {
    throw Error('Il percorso salvato non è leggibile. È conservato senza modificarlo.');
  }
  const active = value.active === null ? null : validateSession(value.active, true);
  const history = value.history.map(item => validateSession(item, false));
  const ids = history.map(item => item.id);
  if (active) ids.push(active.id);
  if (new Set(ids).size !== ids.length) throw Error('Il percorso contiene sessioni duplicate. I dati sono conservati.');
  return { version: 1, active, history };
}

function touching(progress, now) {
  const p = validatePractice(progress);
  if (!p.active) throw Error('Prima avvia o riprendi il percorso.');
  if (!timestamp(now)) throw Error('Data del percorso non valida.');
  p.active.updatedAt = Math.max(now, p.active.updatedAt);
  return p;
}

export function startPractice(progress, id, now) {
  const p = validatePractice(progress);
  if (!timestamp(now) || typeof id !== 'string' || !id || id.length > 160 || p.history.some(s => s.id === id) || p.active?.id === id) throw Error('Nuova sessione non valida.');
  if (p.active) {
    const endedAt = Math.max(now, p.active.updatedAt);
    p.history.push({ ...p.active, status: 'paused', endedAt, updatedAt: endedAt });
  }
  p.active = {
    id, startedAt: now, updatedAt: now, step: 0, status: 'active',
    answers: Object.fromEntries(PRACTICE_QUESTIONS.map(q => [q.id, { value: '', correct: false, attempts: 0, hints: 0 }])),
    reflection: '', reflectionSkipped: false, endedAt: null, reviewOn: null,
  };
  return p;
}

export function resumePractice(progress, archivedId, newId, now) {
  const saved = validatePractice(progress).history.find(item => item.id === archivedId);
  if (!saved || saved.status !== 'paused') throw Error('Questo tentativo si può solo rileggere.');
  const p = startPractice(progress, newId, now);
  p.active = { ...saved, id: newId, startedAt: now, updatedAt: now, status: 'active', endedAt: null, reviewOn: null };
  return p;
}

export function advancePractice(progress, now) {
  const p = touching(progress, now), step = p.active.step;
  if (step > 3 || (step > 0 && !p.active.answers[PRACTICE_QUESTIONS[step - 1].id].correct)) throw Error('Completa questo piccolo passaggio prima di proseguire.');
  p.active.step++;
  return p;
}

export function answerPractice(progress, value, now) {
  const p = touching(progress, now), question = PRACTICE_QUESTIONS[p.active.step - 1];
  if (!question) throw Error('Questo passaggio non contiene una domanda.');
  const result = checkAnswer(question.id, value);
  if (result.kind === 'invalid') throw Error(result.message);
  const answer = p.active.answers[question.id];
  if (answer.correct) throw Error('Questo passaggio è già completato. Puoi proseguire.');
  p.active.answers[question.id] = { ...answer, value: value.trim(), correct: result.kind === 'correct', attempts: answer.attempts + 1 };
  return p;
}

export function hintPractice(progress, now) {
  const p = touching(progress, now), question = PRACTICE_QUESTIONS[p.active.step - 1];
  if (!question) throw Error('Questo passaggio non contiene indizi.');
  const answer = p.active.answers[question.id];
  answer.hints = Math.min(2, answer.hints + 1);
  return p;
}

export function reflectPractice(progress, text, now) {
  const p = touching(progress, now);
  if (p.active.step !== 4 || typeof text !== 'string' || text.length > 800) throw Error('L’appunto deve contenere al massimo 800 caratteri.');
  p.active.reflection = text;
  return p;
}

export function finishPractice(progress, reflection, skip, now) {
  const p = touching(progress, now);
  if (p.active.step !== 4) throw Error('Prima completa i tre piccoli passaggi.');
  if (typeof reflection !== 'string' || reflection.length > 800 || typeof skip !== 'boolean' || (!skip && !reflection.trim())) throw Error('Scrivi un pensiero oppure scegli «Per ora salto».');
  const endedAt = p.active.updatedAt;
  p.history.push({ ...p.active, step: 5, status: 'completed', reflection: reflection.trim(), reflectionSkipped: skip, endedAt, reviewOn: nextReviewDate(endedAt) });
  p.active = null;
  return p;
}

// La stessa API DB conserva il perimetro del profilo e l’eventuale overlay RAM del Mac.
// Senza una lettura riuscita, o dopo un errore CAS, non è ammessa alcuna scrittura.
export function createPracticeStore(db) {
  let row = null, ready = false;
  return {
    async load() {
      ready = false;
      const current = await db.get('impostazioni', PRACTICE_KEY);
      const progress = current === null ? emptyProgress() : validatePractice(current.valore);
      row = structuredClone(current);
      ready = true;
      return progress;
    },
    async save(value) {
      if (!ready || typeof db.putIfUnchanged !== 'function') throw Error('Il percorso è in sola lettura. Riaprilo prima di salvare.');
      const clean = validatePractice(value);
      ready = false;
      await db.putIfUnchanged('impostazioni', { id: PRACTICE_KEY, valore: clean }, canonical(row));
      const current = await db.get('impostazioni', PRACTICE_KEY);
      if (!current || canonical(validatePractice(current.valore)) !== canonical(clean)) throw Error('Il percorso è cambiato in un’altra finestra. Riaprilo per ritrovare l’ultimo salvataggio.');
      row = structuredClone(current);
      ready = true;
      return clean;
    },
  };
}
