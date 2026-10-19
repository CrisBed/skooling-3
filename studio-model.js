export function validateQuiz(value) {
  if (!value || !Array.isArray(value.domande) || !value.domande.length || value.domande.length > 100) throw new Error('Servono da 1 a 100 domande.');
  return { domande: value.domande.map((q, i) => {
    if (typeof q.domanda !== 'string' || !q.domanda.trim() || q.domanda.length > 3000 || !Array.isArray(q.opzioni) || q.opzioni.length < 2 || q.opzioni.length > 6 || q.opzioni.some(x => typeof x !== 'string' || !x.trim() || x.length > 1000) || !Number.isInteger(q.corretta) || q.corretta < 0 || q.corretta >= q.opzioni.length) throw new Error(`Domanda ${i + 1}: controlla testo, opzioni e indice della risposta corretta (parte da 0).`);
    return { domanda: q.domanda, opzioni: q.opzioni, corretta: q.corretta, spiegazione: String(q.spiegazione || '').slice(0, 5000), fonte: String(q.fonte || '').slice(0, 1000) };
  }) };
}
export function scoreQuiz(quiz, answers) {
  if (answers.length !== quiz.domande.length || answers.some((a,i) => !Number.isInteger(a) || a < 0 || a >= quiz.domande[i].opzioni.length)) throw new Error('Rispondi a tutte le domande.');
  const errori = quiz.domande.flatMap((q, i) => answers[i] === q.corretta ? [] : [i]);
  return { corrette: quiz.domande.length - errori.length, totale: quiz.domande.length, errori };
}
export function safeNotebookURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['notebooklm.google.com', 'notebooklm.google', 'notebook.google.com'].includes(u.hostname) && u.pathname.startsWith('/notebook/') ? u.href : null; } catch { return null; }
}
export function studyPrompt(topic, kind = 'quiz') {
 return `Lavora soltanto sulle fonti del notebook. Argomento: ${topic.titolo}. Materia: ${topic.materia}. Pagine o capitolo: ${topic.pagine || 'individua le sezioni pertinenti e dichiarale'}. Livello: scuola secondaria di primo grado. Se una risposta non è nelle fonti, dichiaralo. Non inventare numeri di pagina. ${kind === 'quiz' ? 'Crea 8 domande con 4 opzioni, una sola corretta, spiegazione e fonte. Restituisci SOLO JSON, senza blocchi di codice, in questo formato: {"domande":[{"domanda":"...","opzioni":["...","...","...","..."],"corretta":0,"spiegazione":"...","fonte":"titolo e pagina o sezione"}]}. corretta è un indice da 0 a 3. Varia la posizione della risposta corretta.' : 'Crea un riassunto chiaro e una breve scaletta per ripetere a voce. Indica fonti e sezioni utilizzate.'}`;
}
