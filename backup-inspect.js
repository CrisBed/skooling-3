// Anteprima limitata all'intestazione: la verifica completa avviene una sola
// volta, durante l'importazione incrementale. I PDF non vengono decodificati qui.
const LIMIT = 128 * 1024;
export async function inspectBackup(file) {
  if (!file || typeof file.slice !== 'function' || !Number.isFinite(file.size) || file.size <= 0) throw Error('Scegli un file di backup leggibile.');
  const bytesRead = Math.min(LIMIT, file.size);
  const text = new TextDecoder('utf-8', {fatal:true}).decode(await file.slice(0, bytesRead).arrayBuffer(), {stream:file.size > bytesRead});
  let at = 0;
  const whitespace = () => {while (/\s/.test(text[at] || '') && at < text.length) at++;};
  const expect = char => {whitespace();if (text[at++] !== char) throw Error('L’intestazione del backup è incompleta o non leggibile.');};
  const value = () => {
    whitespace();const start = at;let depth = 0, quoted = false, escaped = false;
    for (; at < text.length; at++) {
      const char = text[at];
      if (quoted) {if (escaped) escaped = false;else if (char === '\\') escaped = true;else if (char === '"') {quoted = false;if (!depth) {at++;return JSON.parse(text.slice(start, at));}}continue;}
      if (char === '"') quoted = true;
      else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') {if (!depth) break;depth--;if (!depth) {at++;return JSON.parse(text.slice(start, at));}}
      else if (!depth && /[,\s]/.test(char)) break;
    }
    if (quoted || depth || at === start) throw Error('L’intestazione è incompleta o supera 128 KB. Il contenuto non è stato importato.');
    return JSON.parse(text.slice(start, at));
  };
  expect('{');const header = {};let storesSeen = false;
  while (at < text.length) {
    const key = value();if (typeof key !== 'string') throw Error('Intestazione del backup non valida.');expect(':');
    if (key === 'stores') {expect('{');storesSeen = true;break;}
    if (Object.hasOwn(header, key)) throw Error('Intestazione duplicata nel backup.');
    Object.defineProperty(header, key, {value:value(), enumerable:true});
    whitespace();if (text[at] === '}') break;expect(',');
  }
  if (header.formato !== 'skooling' || header.versione !== 1 || !storesSeen) throw Error('Questo non è un backup di Skooling con intestazione verificabile.');
  if (header.tipoBackup !== undefined && !['essenziale','completo','giornaliero'].includes(header.tipoBackup)) throw Error('Tipo di backup non riconosciuto.');
  if (header.libriEsclusi !== undefined && (!Array.isArray(header.libriEsclusi) || header.libriEsclusi.some(row => !row || typeof row.id !== 'string'))) throw Error('Elenco dei libri esclusi non valido.');
  const tipoBackup = header.tipoBackup || 'non-specificato', libriEsclusi = header.libriEsclusi || [];
  const excludedCopy=Object.hasOwn(header,'libriEsclusi') ? `${libriEsclusi.length} libri esclusi dal file;` : 'L’elenco dei libri esclusi sarà letto durante l’importazione;';
  const summary = ['essenziale','giornaliero'].includes(tipoBackup)
    ? `Backup essenziale. ${excludedCopy} i PDF già presenti su questo dispositivo vengono conservati. Il contenuto sarà verificato durante l’importazione.`
    : `Backup ${tipoBackup === 'completo' ? 'completo' : 'storico'}. I PDF contenuti nel file saranno letti durante l’importazione. Questa anteprima verifica solo l’intestazione.`;
  return {...header, tipoBackup, libriEsclusi, headerComplete:true, contentVerified:false, bytesRead, summary};
}
