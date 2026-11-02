// Attività letterali costruite soltanto dalla fonte fornita, senza generazione o servizi esterni.
import { canonical } from './sync-model.js';

const THEMES = {
  storia: { title: 'Detective del tempo', prompt: 'Cerca nelle parole del brano le tracce da seguire.', reflection: 'Quale indizio ti aiuta a raccontare questo passaggio?', aside: 'Il calendario non risolve il caso da solo: le prove sono nel testo.' },
  scienze: { title: 'Laboratorio degli indizi', prompt: 'Osserva il brano come un piccolo campione da esplorare.', reflection: 'Che cosa hai osservato nel brano? Quale domanda ti è rimasta?', aside: 'Prima osserviamo. Il camice, per questa volta, è facoltativo.' },
  geografia: { title: 'Esploratori sulla pagina', prompt: 'Segui le tracce del brano e costruisci il tuo percorso.', reflection: 'Quali parole useresti per raccontare ciò che hai esplorato?', aside: 'La bussola oggi punta al testo, senza fare le valigie.' },
  italiano: { title: 'Officina delle parole', prompt: 'Apri il cofano della frase: come stanno insieme le parole?', reflection: 'Che cosa cambia se racconti questa idea con parole tue?', aside: 'Gli attrezzi sono le parole. Puoi spostarle e rimetterle a posto.' },
  lingue: { title: 'Passaporto per le parole', prompt: 'Ascolta con gli occhi la frase e segui l’ordine delle parole.', reflection: 'Quale espressione vuoi portare con te? Come la ricordi?', aside: 'Il passaporto non scade. Anche i tentativi fanno parte del viaggio.' },
  tecnologia: { title: 'Smonta l’idea', prompt: 'Cerca nel brano i pezzi dell’idea e come si collegano.', reflection: 'Quali due pezzi dell’idea riesci a collegare?', aside: 'Qui si smontano le idee: non avanzano viti sul tavolo.' },
  arte: { title: 'Occhio d’artista', prompt: 'Fermati su due dettagli che il brano ti fa notare.', reflection: 'Quale dettaglio vuoi raccontare o disegnare?', aside: 'Prima di correre alla risposta, diamo spazio allo sguardo.' },
  musica: { title: 'Le parole hanno ritmo', prompt: 'Cerca nel brano due tracce da tenere insieme.', reflection: 'Quale collegamento vuoi ricordare di questo brano?', aside: 'Nessun assolo obbligatorio: oggi la prima traccia è sulla pagina.' },
  religione: { title: 'Domande e significati', prompt: 'Leggi il brano e cerca due indizi per una domanda.', reflection: 'Quale domanda o significato vuoi approfondire?', aside: 'Puoi distinguere ciò che dice il brano da ciò che pensi tu.' },
  motoria: { title: 'Allenamento di idee', prompt: 'Leggi con calma e individua due passaggi da ricordare.', reflection: 'Quale passaggio spiegheresti prima a un compagno?', aside: 'Questo giro si allenano le idee: niente cronometro.' },
  generic: { title: 'Caccia agli indizi', prompt: 'Esplora il brano e scegli le parole che vuoi portare con te.', reflection: 'Quali due indizi ti aiutano a raccontare quello che hai letto?', aside: 'Le prove sono nella fonte. Le tue domande possono andare più lontano.' },
};
const LANGUAGES = new Set(['inglese', 'francese', 'spagnolo', 'tedesco', 'lingue', 'latino']);
const CLOZE_SUBJECTS = new Set(['storia', 'scienze', 'geografia']);
const STOP_WORDS = new Set('anche ancora alcuni alcune altri altre aveva avevano abbiamo avere essere erano erano essere fatto fanno fosse furono grazie infatti insieme mentre molto molti molte nella nelle negli nello della delle degli dello dalla dalle dagli dallo sulla sulle sugli sullo senza sotto sopra prima quale quali quando quanto quanti quante questa queste questi questo quella quelle quelli quello quindi stessa stesse stessi stesso stata state stati stato tutte tutti tutta tutto verso vostro vostra vostri vostre nostro nostra nostri nostre perché perche oppure sempre soltanto durante attraverso proprio spesso vengono veniva venivano viene'.split(' '));
const SOURCE_PREFIX = 'source-mission-v1-';
const problem = () => Error('Il percorso salvato non è leggibile. I dati sono conservati senza modificarli.');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Controlla ${label}.`);
  return value.trim();
}
function subjectKind(subject) {
  const normalized = subject.toLocaleLowerCase('it').trim();
  if (LANGUAGES.has(normalized)) return 'lingue';
  if (['educazione fisica', 'educazione-fisica', 'educazione motoria', 'scienze motorie', 'motoria'].includes(normalized)) return 'motoria';
  return Object.hasOwn(THEMES, normalized) ? normalized : 'generic';
}
function words(value) {
  return [...value.matchAll(/[\p{L}\p{M}]+/gu)].map(match => ({ value: match[0], index: match.index }));
}
const normalizedWord = value => value.normalize('NFC').toLocaleLowerCase('it');
function eligibleWords(value) {
  return words(value).filter(word => word.value.length >= 5 && word.value.length <= 40 && !STOP_WORDS.has(normalizedWord(word.value)));
}
function readableQuote(segments) {
  for (const segment of segments) {
    for (const match of segment.matchAll(/[^.!?\n]+[.!?]+/gu)) {
      const quote = match[0].trim();
      if (quote.length >= 48 && quote.length <= 260 && words(quote).length >= 8) return quote;
    }
  }
  return null;
}
function stableIndex(value, size) {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return (hash >>> 0) % size;
}

function challengeFor(kind, source) {
  // Soltanto il marcatore tecnico dell’estrazione viene escluso dalle attività.
  const segments = source.text.split(/\[Pagina PDF \d+\]/g).filter(part => part.trim());
  if (!segments.length) throw Error('La fonte non contiene ancora testo da esplorare.');
  const quote = readableQuote(segments);
  if (quote && (kind === 'italiano' || kind === 'lingue')) {
    const tokens = [...quote.matchAll(/\S+/gu)];
    const first = tokens[Math.ceil(tokens.length / 3)].index;
    const second = tokens[Math.ceil(tokens.length * 2 / 3)].index;
    return { kind: 'order', prompt: 'Rimetti i tre pezzi nello stesso ordine del brano.', quote, chunks: [quote.slice(0, first), quote.slice(first, second), quote.slice(second)] };
  }
  if (quote && CLOZE_SUBJECTS.has(kind)) {
    const candidates = eligibleWords(quote);
    const answer = candidates.find(word => candidates.filter(other => normalizedWord(other.value) === normalizedWord(word.value)).length === 1)?.value;
    if (answer) {
      const seen = new Set([normalizedWord(answer)]), alternatives = [];
      for (const segment of segments) {
        for (const word of eligibleWords(segment)) {
          const key = normalizedWord(word.value);
          if (!seen.has(key)) { seen.add(key); alternatives.push(word.value); }
          if (alternatives.length === 2) break;
        }
        if (alternatives.length === 2) break;
      }
      if (alternatives.length === 2) {
        const options = [...alternatives];
        options.splice(stableIndex(source.id + source.fingerprint + answer, 3), 0, answer);
        return { kind: 'cloze', prompt: 'Quale parola del brano manca in questa frase?', quote, answer, options };
      }
    }
  }
  // I frammenti brevi, le tabelle e i testi incompleti restano osservazioni, senza risposta inventata.
  const observation = quote || segments[0].trim().slice(0, 500).trimEnd();
  return { kind: 'observe', prompt: 'Cerca nel brano fino a due indizi: parole, dettagli o collegamenti che vuoi ricordare. Poi confrontali con la fonte.', quote: observation };
}

export function buildSourceMission({ topic, source } = {}) {
  if (!plainObject(topic) || !plainObject(source) || !['book', 'material'].includes(source.kind)) throw Error('Scegli un argomento e una fonte locale leggibile.');
  const topicId = text(topic.id, 250, 'l’identità dell’argomento'), title = text(topic.titolo, 120, 'il titolo dell’argomento');
  const subject = text(topic.materia, 80, 'la materia');
  const clean = { kind: source.kind, id: text(source.id, 250, 'l’identità della fonte'), title: text(source.title, 500, 'il titolo della fonte'), label: text(source.label, 600, 'il riferimento della fonte') };
  if (typeof source.text !== 'string' || !source.text.trim() || source.text.length > 18000) throw Error('La fonte deve contenere testo leggibile, fino a 18000 caratteri. Scegli un estratto più breve se serve.');
  clean.text = source.text; // Conservare la fonte esatta; il limite dell’estratto non la tronca.
  if (source.page !== undefined) {
    if (!Number.isSafeInteger(source.page) || source.page < 1) throw Error('La pagina della fonte non è valida.');
    clean.page = source.page;
  }
  clean.fingerprint = text(source.fingerprint, 500, 'l’impronta della fonte');
  const kind = subjectKind(subject);
  return { version: 1, topicId, title, subject, theme: { ...THEMES[kind] }, source: clean, challenge: challengeFor(kind, clean) };
}

export function validateSourceMission(value) {
  if (!plainObject(value) || value.version !== 1) throw problem();
  const clean = buildSourceMission({ topic: { id: value.topicId, titolo: value.title, materia: value.subject }, source: value.source });
  // Ricostruire l’attività impedisce di accettare risposte o citazioni aggiunte al salvataggio.
  if (canonical(clean) !== canonical(value)) throw problem();
  return clean;
}

function checkAnswer(challenge, value) {
  if (challenge.kind === 'observe') return { kind: 'invalid', message: 'Questo passaggio si rilegge e si confronta con il brano: non viene corretto automaticamente.' };
  if (challenge.kind === 'cloze') {
    if (typeof value !== 'string' || !challenge.options.includes(value)) return { kind: 'invalid', message: 'Scegli una delle parole ricavate dal brano.' };
    return value === challenge.answer
      ? { kind: 'correct', message: `Nel brano la frase usa proprio «${challenge.answer}».` }
      : { kind: 'retry', message: 'Questa parola è nella fonte, ma non è quella tolta da questa frase. Cerca di nuovo l’indizio nel brano.' };
  }
  if (!Array.isArray(value) || value.length !== 3 || Array.from(value).some(index => !Number.isInteger(index) || index < 0 || index > 2) || new Set(value).size !== 3) return { kind: 'invalid', message: 'Scegli tutti e tre i pezzi, una volta ciascuno.' };
  return value.every((index, position) => index === position)
    ? { kind: 'correct', message: 'I tre pezzi seguono proprio l’ordine del brano.' }
    : { kind: 'retry', message: 'Nel brano questi pezzi hanno un altro ordine. Rileggi la frase e prova un nuovo collegamento.' };
}

export function checkMissionAnswer(mission, value) { return checkAnswer(validateSourceMission(mission).challenge, value); }

export function maskMissionQuote(mission) {
  const { challenge } = validateSourceMission(mission);
  if (challenge.kind !== 'cloze' || typeof challenge.answer !== 'string' || !challenge.answer) throw Error('Questo passaggio non contiene una parola da nascondere.');
  const token = words(challenge.quote).find(word => word.value === challenge.answer);
  if (!token) throw problem();
  return challenge.quote.slice(0, token.index) + '_____' + challenge.quote.slice(token.index + token.value.length);
}

function timestamp(value) { return Number.isSafeInteger(value) && value >= 0; }
function validateActivity(value, archived) {
  if (!plainObject(value) || typeof value.id !== 'string' || !value.id || value.id.length > 250 || !Number.isInteger(value.step) || value.step < 0 || value.step > 2 || typeof value.hints !== 'boolean' || typeof value.reflection !== 'string' || value.reflection.length > 2000 || !timestamp(value.updatedAt)) throw problem();
  const mission = validateSourceMission(value.mission), challenge = mission.challenge;
  let answer = value.answer;
  if (answer !== null) {
    if (challenge.kind === 'cloze') { if (typeof answer !== 'string' || !challenge.options.includes(answer)) throw problem(); }
    else if (challenge.kind === 'order') {
      if (!Array.isArray(answer) || answer.length > 3 || Array.from(answer).some(index => !Number.isInteger(index) || index < 0 || index > 2) || new Set(answer).size !== answer.length) throw problem();
      answer = [...answer];
    } else if (typeof answer !== 'string' || answer.length > 2000) throw problem();
  }
  if (value.step === 2 && challenge.kind !== 'observe' && checkAnswer(challenge, answer).kind !== 'correct') throw problem();
  const clean = { id: value.id, mission, step: value.step, answer, hints: value.hints, reflection: value.reflection, updatedAt: value.updatedAt };
  if (archived) {
    // completedAt è la data di archiviazione. Arrivare alla riflessione non equivale a concludere.
    if (!['completed', 'paused'].includes(value.status) || (value.status === 'completed' && value.step !== 2)
      || !timestamp(value.completedAt) || value.completedAt < value.updatedAt) throw problem();
    clean.status = value.status;
    clean.completedAt = value.completedAt;
  }
  return clean;
}

export function validateMissionProgress(value) {
  if (!plainObject(value) || value.version !== 1 || !Object.hasOwn(value, 'active') || !Array.isArray(value.history)) throw problem();
  const active = value.active === null ? null : validateActivity(value.active, false);
  const history = Array.from(value.history).map(item => validateActivity(item, true));
  const ids = history.map(item => item.id);
  if (active) ids.push(active.id);
  if (new Set(ids).size !== ids.length) throw problem();
  return { version: 1, active, history };
}

export function createSourceMissionStore(db, key) {
  if (typeof key !== 'string' || !key.startsWith(SOURCE_PREFIX) || key.length <= SOURCE_PREFIX.length || key.length > 400) throw Error('Il percorso deve appartenere a un argomento preciso.');
  const topicId = key.slice(SOURCE_PREFIX.length);
  let row = null, previous = null, ready = false;
  function scoped(value) {
    const clean = validateMissionProgress(value);
    if ([...clean.history, ...(clean.active ? [clean.active] : [])].some(item => item.mission.topicId !== topicId)) throw Error('Questo percorso appartiene a un altro argomento. I dati sono conservati.');
    return clean;
  }
  return {
    async load() {
      ready = false;
      const current = await db.get('impostazioni', key);
      const progress = current === null ? { version: 1, active: null, history: [] } : scoped(current.valore);
      row = structuredClone(current); previous = progress; ready = true;
      return structuredClone(progress);
    },
    async save(value) {
      if (!ready || typeof db.putIfUnchanged !== 'function') throw Error('Il percorso è in sola lettura. Riapri l’argomento prima di salvare.');
      const clean = scoped(value);
      if (clean.history.length < previous.history.length || previous.history.some((item, index) => canonical(item) !== canonical(clean.history[index]))) throw Error('I tentativi precedenti devono restare conservati.');
      ready = false;
      await db.putIfUnchanged('impostazioni', { id: key, valore: clean }, canonical(row));
      const current = await db.get('impostazioni', key);
      if (!current || canonical(scoped(current.valore)) !== canonical(clean)) throw Error('Il percorso è cambiato in un’altra finestra. Riapri l’argomento per leggerlo.');
      row = structuredClone(current); previous = clean; ready = true;
      return structuredClone(clean);
    },
  };
}
