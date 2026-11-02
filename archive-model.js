export function archiveInventory({libri = [], annotazioni = [], impostazioni = []} = {}) {
  const books = new Map(), counts = new Map();
  for (const row of annotazioni) if (typeof row.idLibro === 'string') counts.set(row.idLibro, (counts.get(row.idLibro) || 0) + 1);
  const add = (book, source) => {
    if (!book || typeof book.id !== 'string') return;
    const pdfAvailable = book.blob instanceof Blob && book.blob.size > 0;
    books.set(book.id, {id:book.id, title:book.titolo || 'Libro senza titolo', subject:book.materia || '', pdfAvailable, annotationCount:counts.get(book.id) || 0, source});
  };
  const excluded = impostazioni.find(row => row.id === 'backup-libri-esclusi')?.valore;
  for (const book of Array.isArray(excluded) ? excluded : []) add(book, 'backup');
  for (const book of libri) add(book, 'locale');
  for (const id of counts.keys()) if (!books.has(id)) add({id}, 'annotazioni');
  const rows = [...books.values()].sort((a,b) => a.title.localeCompare(b.title, 'it'));
  const available = rows.filter(row => row.pdfAvailable).length;
  return {total:rows.length, available, missing:rows.length - available, annotations:annotazioni.length, books:rows};
}
