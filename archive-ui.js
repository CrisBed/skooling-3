import {archiveInventory} from './archive-model.js';
// Solo lettura: non toglie libri, non trasferisce file e non modifica annotazioni.
export function createArchiveInventory(container) {
  let revision = 0;
  return {async refresh(db) {
    const current = ++revision;
    const [libri, annotazioni, impostazioni] = await Promise.all(['libri','annotazioni','impostazioni'].map(name => db.getAll(name)));
    const inventory = archiveInventory({libri, annotazioni, impostazioni});
    if (current !== revision) return inventory;
    const summary = document.createElement('p');
    summary.textContent = `${inventory.total} libri, ${inventory.available} PDF disponibili, ${inventory.missing} da ricollegare. ${inventory.annotations} annotazioni conservate.`;
    const list = document.createElement('ul');
    for (const book of inventory.books) {
      const row = document.createElement('li');
      row.textContent = `${book.title}${book.subject ? ' · ' + book.subject : ''}: ${book.pdfAvailable ? 'PDF disponibile' : 'PDF da ricollegare'}, ${book.annotationCount} annotazioni.`;
      list.append(row);
    }
    container.replaceChildren(summary, list);return inventory;
  }};
}
