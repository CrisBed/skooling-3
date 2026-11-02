// La pagina intera cambia con una sola transazione, anche quando si cancellano tratti.
export function prepareAnnotations(bookId, page, elements) {
  if (typeof bookId !== 'string' || !bookId || !Number.isInteger(page) || page < 1 || !Array.isArray(elements)) throw Error('Pagina delle annotazioni non valida.');
  const ids = new Set();
  return structuredClone(elements).map(element => {
    if (!element || typeof element.id !== 'string' || !element.id || ids.has(element.id)) throw Error('Le annotazioni contengono un identificativo non valido o duplicato.');
    ids.add(element.id);
    return {...element, idLibro: bookId, pagina: page, _editId: crypto.randomUUID()};
  });
}
export function replacePageAnnotations(database, bookId, page, elements) {
  const prepared = prepareAnnotations(bookId, page, elements);
  return new Promise((resolve, reject) => {
    const tx = database.transaction('annotazioni', 'readwrite'), store = tx.objectStore('annotazioni');
    let failure;
    tx.oncomplete = () => resolve(prepared);
    tx.onerror = tx.onabort = () => reject(failure || Error('Annotazioni non salvate. La versione precedente è conservata.'));
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const previous = request.result, ids = new Set(prepared.map(row => row.id));
        if (previous.some(row => ids.has(row.id) && (row.idLibro !== bookId || row.pagina !== page))) throw Error('Un tratto appartiene a un’altra pagina. Le annotazioni precedenti sono conservate.');
        for (const row of previous) if (row.idLibro === bookId && row.pagina === page) store.delete(row.id);
        for (const row of prepared) store.put(row);
      } catch (error) { failure = error; tx.abort(); }
    };
  });
}

export function createAnnotationSaveQueue(write) {
  const pending = new Map(), failed = new Map();
  return {
    get needsFlush() {return pending.size > 0 || failed.size > 0;},
    save(bookId, page, elements) {
      const snapshot = structuredClone(elements), key = JSON.stringify([bookId, page]);
      const previous = pending.get(key) || Promise.resolve();
      const current = previous.catch(() => {}).then(() => write(bookId, page, snapshot));
      pending.set(key, current);
      current.then(() => {if (pending.get(key) === current) {pending.delete(key); failed.delete(key);}}, error => {if (pending.get(key) === current) {pending.delete(key); failed.set(key, {error, bookId, page, elements:snapshot});}});
      return current;
    },
    async retry() {
      const jobs = [...failed.entries()].filter(([key]) => !pending.has(key)).map(([,job]) => job);
      await Promise.all(jobs.map(job => this.save(job.bookId, job.page, job.elements)));
      await this.flush();
    },
    async flush() {
      while(pending.size) await Promise.all([...pending.values()]);
      if (failed.size) throw failed.values().next().value.error;
    },
  };
}
