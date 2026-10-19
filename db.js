import {readBackup} from './backup-reader.js';
import {installDraftSession} from './draft-session.js';
import {isIPad,deviceIdentity} from './device-policy.js';
import {replaceApproved} from './approved-storage.js';
import { activeDatabaseName } from './students.js';
import { canonical } from './sync-model.js';
import { syncSnapshot, applySync } from './sync-storage.js';
import { importBackupStaged } from './backup-import.js';
// Persistenza locale. Drive è facoltativo e non trasferisce i PDF.
// The database is pinned for this tab until an explicit reload switches student.
export const DB_NAME = activeDatabaseName();
export const DB_VERSION = 7;
export const STORE_NAMES = [
  'libri',
  'annotazioni',
  'segnalibri',
  'quaderni',
  'paginequaderno',
  'compiti',
  'impostazioni',
  'album',
  'foto',
  'letture',
  'argomenti',
  'materiali',
  'risultati',
];

// L'indice del testo dei libri si ricostruisce leggendo di nuovo i PDF, quindi
// non entra nel backup: ci farebbe crescere il file di molti megabyte senza
// aggiungere niente che non si possa rifare.
export const STORE_NAMES_DERIVATI = ['indicelibri','recuperosync'];

// Gli archivi che ci sono da sempre: un backup deve averli tutti, altrimenti
// non e' un backup buono. Quelli aggiunti dopo, come le foto dell'album,
// possono mancare in un file salvato con una versione precedente: in quel caso
// si importano vuoti invece di rifiutare tutto il ripristino.
export const STORE_NAMES_STORICI = [
  'libri',
  'annotazioni',
  'segnalibri',
  'quaderni',
  'paginequaderno',
  'compiti',
  'impostazioni',
];

const STORE_OPTIONS = {
  argomenti: { keyPath: 'id' },
  materiali: { keyPath: 'id' },
  risultati: { keyPath: 'id' },
  libri: { keyPath: 'id' },
  annotazioni: { keyPath: 'id' },
  segnalibri: { keyPath: 'id' },
  quaderni: { keyPath: 'id' },
  paginequaderno: { keyPath: 'id' },
  compiti: { keyPath: 'id' },
  impostazioni: { keyPath: 'id' },
  // Gli album delle fotografie: una cartella con un nome, di solito la data del
  // giorno in cui si e' scattato. Le foto stanno nell'archivio qui sotto e
  // dicono a quale album appartengono.
  album: { keyPath: 'id' },
  foto: { keyPath: 'id' },
  // A che pagina si e' arrivati, tenuto a parte dal libro. Sta qui e non dentro
  // il libro perche' salvare il segnaposto dentro il libro vuol dire riscrivere
  // tutto il PDF: con un libro da 400 MB sono mezzo secondo e 400 MB di scrittura
  // a ogni voltata di pagina.
  letture: { keyPath: 'id' },
  indicelibri: { keyPath: 'id' },
  recuperosync: {keyPath:'id'},
};

let openPromise;

export function createId(prefix = 'id') {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function blobToDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
    if (offset && offset % (block * 32) === 0) await new Promise(requestAnimationFrameSafe);
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export function dataURLToBlob(value) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value ?? '');
  if (!match) throw new Error('Il backup contiene un file non leggibile.');
  const type = match[1] || 'application/octet-stream';
  const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function requestAnimationFrameSafe(resolve) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
}

async function encodeValue(value) {
  if (value instanceof Blob) return { __skoolingBlob: await blobToDataURL(value) };
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) result.push(await encodeValue(item));
    return result;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = await encodeValue(item);
    return result;
  }
  return value;
}

export async function appendBackupValue(value, parts) {
  if (value instanceof Blob) {
    const prefix = `data:${value.type || 'application/octet-stream'};base64,`;
    parts.push('{"__skoolingBlob":', JSON.stringify(prefix).slice(0, -1));
    // Multiplo di tre: le porzioni base64 si possono concatenare senza padding intermedio.
    const block = 196608;
    for (let offset = 0; offset < value.size; offset += block) {
      const bytes = new Uint8Array(await value.slice(offset, offset + block).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      parts.push(new Blob([btoa(binary)]));
      await new Promise(requestAnimationFrameSafe);
    }
    parts.push('"}');
  } else if (Array.isArray(value)) {
    parts.push('[');
    for (let i = 0; i < value.length; i++) { if (i) parts.push(','); await appendBackupValue(value[i], parts); }
    parts.push(']');
  } else if (value && typeof value === 'object') {
    parts.push('{');
    let first = true;
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      if (!first) parts.push(','); first = false;
      parts.push(JSON.stringify(key), ':'); await appendBackupValue(child, parts);
    }
    parts.push('}');
  } else parts.push(JSON.stringify(value) ?? 'null');
}

function decodeValue(value) {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object') {
    if (typeof value.__skoolingBlob === 'string') return dataURLToBlob(value.__skoolingBlob);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]));
  }
  return value;
}

export function validateBackup(value) {
  if (!value || value.formato !== 'skooling' || value.versione !== 1 || !value.stores) {
    throw new Error('Questo non è un backup di Skooling valido.');
  }
  for (const name of STORE_NAMES_STORICI) {
    if (!Array.isArray(value.stores[name])) {
      throw new Error('Il backup di Skooling è incompleto e non è stato importato.');
    }
  }
  return value;
}

function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('Il salvataggio locale non è disponibile in questo browser.'));
  }
  if (!openPromise) {
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of [...STORE_NAMES, ...STORE_NAMES_DERIVATI]) {
          if (!database.objectStoreNames.contains(name)) {
            const store = database.createObjectStore(name, STORE_OPTIONS[name]);
            if (name === 'annotazioni') store.createIndex('libroPagina', ['idLibro', 'pagina']);
            if (name === 'segnalibri') store.createIndex('libro', 'idLibro');
            if (name === 'paginequaderno') store.createIndex('quaderno', 'idQuaderno');
            if (name === 'compiti') store.createIndex('consegna', 'consegna');
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Skooling non riesce ad aprire il suo archivio. Ricarica la pagina.'));
      request.onblocked = () => reject(new Error('Chiudi le altre finestre di Skooling e riprova.'));
    });
  }
  return openPromise;
}

function requestResult(request, fallback) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => reject(new Error('Non sono riuscito a salvare. Riprova tra poco.'));
  });
}

async function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('Il salvataggio non è riuscito. I dati precedenti sono al sicuro.'));
    transaction.onabort = () => reject(new Error('Operazione interrotta. I dati precedenti sono al sicuro.'));
  });
}

export function selectBackupBooks(books, annotations, mode = 'completo') {
  if (!['completo', 'essenziale'].includes(mode)) throw new Error('Tipo di backup non valido.');
  const written = new Set(annotations.map(item => item.idLibro));
  return {
    books: books.filter(book => mode === 'completo' || written.has(book.id)),
    excluded: books.filter(book => mode === 'essenziale' && !written.has(book.id))
      .map(book => ({ id: book.id, titolo: book.titolo || 'Libro', materia: book.materia || '' })),
  };
}

export const DB = {
  async replaceApproved(expected,incoming,state){return replaceApproved(await openDatabase(),STORE_NAMES,expected,incoming,state);},
  async putIfUnchanged(storeName, value, expected) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName);
      let conflict = false;
      const request = store.get(value.id);
      request.onsuccess = () => {
        if (canonical(request.result || null) !== expected) { conflict = true; tx.abort(); return; }
        store.put(value);
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(Error(conflict ? 'Il materiale è cambiato in un’altra finestra. Chiudi e riaprilo prima di salvare.' : 'Salvataggio interrotto. Il materiale precedente è conservato.'));
    });
  },
  async saveMindMap(value, expected) { return this.putIfUnchanged('materiali', value, expected); },
  async syncSnapshot() { return syncSnapshot(await openDatabase()); },
  async applySync(expected, merged, profile, device, canApply) { return applySync(await openDatabase(), expected, merged, profile, device, canApply); },

  async init() {
    await openDatabase();
    return this;
  },

  async getAll(storeName) {
    const database = await openDatabase();
    return requestResult(database.transaction(storeName).objectStore(storeName).getAll(), []);
  },

  async get(storeName, id) {
    const database = await openDatabase();
    return requestResult(database.transaction(storeName).objectStore(storeName).get(id), null);
  },

  async put(storeName, value) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  },

  async putMany(storeName, values) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const value of values) store.put(value);
    await transactionDone(transaction);
    return values;
  },

  async delete(storeName, id) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(id);
    await transactionDone(transaction);
  },

  async deleteWhere(storeName, predicate) {
    const values = await this.getAll(storeName);
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const value of values) if (predicate(value)) store.delete(value.id);
    await transactionDone(transaction);
  },

  async exportBackup(onProgress = () => {}, { mode = 'completo' } = {}) {
    const books = await this.getAll('libri');
    const annotations = await this.getAll('annotazioni');
    const selected = selectBackupBooks(books, annotations, mode);
    const settings = await this.getAll('impostazioni');
    const previous = settings.find(item => item.id === 'backup-libri-esclusi')?.valore || [];
    const present = new Set(books.map(book => book.id));
    const excluded = [...new Map([
      ...previous.filter(book => !present.has(book.id)), ...selected.excluded,
    ].map(book => [book.id, book])).values()];
    const exportedSettings = settings.filter(item => item.id !== 'backup-libri-esclusi' && !item.id.startsWith('sync-'));
    if (excluded.length) exportedSettings.push({ id: 'backup-libri-esclusi', valore: excluded });
    // Blob separati: niente stringa JSON gigantesca con tutti i libri in memoria.
    const parts = ['{"formato":"skooling","versione":1,"creatoIl":', JSON.stringify(new Date().toISOString()), ',"tipoBackup":', JSON.stringify(mode), ',"libriEsclusi":', JSON.stringify(excluded), ',"stores":{'];
    for (let index = 0; index < STORE_NAMES.length; index++) {
      if (index) parts.push(',');
      const name = STORE_NAMES[index];
      parts.push(JSON.stringify(name), ':[');
      const rows = name === 'libri' ? selected.books : name === 'annotazioni' ? annotations : name === 'impostazioni' ? exportedSettings : await this.getAll(name);
      for (let row = 0; row < rows.length; row++) {
        if (row) parts.push(',');
        await appendBackupValue(rows[row], parts);
        onProgress((index + (row + 1) / rows.length) / STORE_NAMES.length);
      }
      parts.push(']');
      onProgress((index + 1) / STORE_NAMES.length);
    }
    parts.push('}}');
    return new Blob(parts, { type: 'application/x-skooling+json' });
  },

  async importBackup(file, onProgress = () => {}) {
    // Preparazione incrementale e sostituzione atomica: compatibile con i
    // backup storici, senza JSON.parse(file.text()) da molti gigabyte.
    return importBackupStaged(file, await openDatabase(), STORE_NAMES, STORE_NAMES_STORICI, onProgress);
  },

  async storageStatus() {
    let persisted = false;
    if (navigator.storage?.persist) persisted = await navigator.storage.persist();
    if (!navigator.storage?.estimate) return { persisted, usage: 0, quota: 0, remaining: Infinity, low: false };
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const remaining = Math.max(0, quota - usage);
    return { persisted, usage, quota, remaining, low: quota > 0 && (remaining / quota < 0.15 || remaining < 250 * 1024 * 1024) };
  },
};

// Wrap persistent writes with an edit identity: atomic replacement can detect
// even a same-size image change made by another tab during a transfer.
for(const method of ['put','putMany','putIfUnchanged','saveMindMap']) {
 const original=DB[method];if(!original)continue;
 DB[method]=async function(...args){const index=method==='saveMindMap'?0:1;
  if(method==='putMany')args[index]=args[index].map(row=>({...row,_editId:crypto.randomUUID()}));
  else args[index]={...args[index],_editId:crypto.randomUUID()};
  return original.apply(this,args);
 };
}
async function importVolatile(file,onProgress=()=>{}){
 const data=Object.fromEntries(STORE_NAMES.map(n=>[n,[]])),seen=new Set();
 await readBackup(file,{requiredStores:STORE_NAMES_STORICI,onProgress,onRow:async(name,row)=>{if(STORE_NAMES.includes(name)&&!(name==='impostazioni'&&row.id.startsWith('sync-'))){const key=JSON.stringify([name,row.id]);if(seen.has(key))throw Error('Il backup contiene voci duplicate. Nessuna prova è stata sostituita.');seen.add(key);data[name].push(row);}}});
 return data;
}
if(typeof window!=='undefined')installDraftSession(DB,{enabled:!isIPad()||localStorage.getItem(DB_NAME+'-secondary')==='1',deferTracking:true,lockName:DB_NAME+'-approved-transfer',stores:STORE_NAMES,snapshot:canonical,importFile:importVolatile});
