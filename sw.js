// Incrementa questo nome dopo ogni modifica ai file dell'app.
// Lo fa da solo pubblica.sh: il nome nuovo è ciò che porta la versione nuova
// sul dispositivo di Gabriel, senza che lui debba reinstallare nulla.
const CACHE_NAME = 'skooling3-v17';
const STATIC_FILES = [
  './',
  './index.html',
  './installazione.html',
  './style.css',
  './appearance.css',
  './app.js',
  './agenda.js',
  './agenda-model.js',
  './agenda.css',
  './navigation.js',
  './navigation.css',
  './studio.js',
  './flashcards.js',
  './gradebook.js',
  './gradebook-model.js',
  './learning-model.js',
  './flashcards-model.js',
  './tutor.js',
  './tutor-avatar.js',
  './tutor-avatar.css',
  './today-model.js',
  './tutor-profile.js',
  './tutor-profile-ui.js',
  './tutor-model.js',
  './tutor-source.js',
  './tutor.css',
  './mind-map.js',
  './mind-map-model.js',
  './routine.js',
  './routine.css',
  './routine-model.js',
  './studio-model.js',
  './studio.css',
  './db.js',
  './draft-session.js',
  './device-policy.js',
  './approved-drive.js',
  './approved-storage.js',
  './approved-engine.js',
  './lesson-materials.js',
  './lesson-materials-model.js',
  './lesson-materials.css',

  './students.js',
  './students-model.js',
  './sync-model.js',
  './sync-storage.js',
  './sync-engine.js',
  './drive-api.js',
  './drive-config.js',
  './drive-sync.js',
  './backup-reader.js',
  './backup-import.js',
  './pdf-viewer.js',
  './book-pages.js',
  './book-pages.css',
  './quaderni.js',
  './album.js',
  './ricerca.js',
  './pagine.js',
  './musica.js',
  './diario.js',
  './orario.js',
  './orario-vista.js',
  './diario-contenuti.js',
  './strumenti.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/skooling3.svg',
  './icons/skooling3-180.png',
  './icons/skooling3-192.png',
  './icons/skooling3-512.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/SkoolingMusica.woff2',
  './vendor/pdf.mjs',
  // I decodificatori WebAssembly di PDF.js. Vanno tenuti in cache come tutto il
  // resto: senza di loro, offline, le immagini CCITTFax e JBIG2 dei libri
  // scansionati restano bianche senza dire niente.
  './vendor/jbig2.wasm',
  './vendor/openjpeg.wasm',
  './vendor/qcms_bg.wasm',
  './vendor/pdf.worker.mjs'
];

// In locale (serve.py sulla 3007) vince sempre la rete: così una modifica si
// vede ricaricando, senza dover ripulire a mano service worker e cache. Online
// resta il comportamento buono per l'iPad: prima la cache, quindi l'app parte
// subito e funziona in aereo.
const SVILUPPO_LOCALE = ['localhost', '127.0.0.1', '::1'].includes(self.location.hostname);

// I file si scaricano saltando la cache del browser: senza questo, una copia
// vecchia ancora valida per la rete finirebbe dentro la cache nuova.
function richiestaFresca(url) {
  return new Request(url, { cache: 'reload' });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_FILES.map(richiestaFresca)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('skooling3-') && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skooling:aggiorna-subito') self.skipWaiting();
  if (event.data === 'skooling:versione') {
    event.ports?.[0]?.postMessage({ versione: CACHE_NAME.replace('skooling3-v', '') });
  }
});

async function apriDallaRete(request) {
  const cache = await caches.open(CACHE_NAME);
  const salvata = () => cache.match(request).then((cached) => cached || cache.match('./index.html'));
  try {
    const attesa = new Promise((_, reject) => setTimeout(() => reject(new Error('rete lenta')), 3000));
    const response = await Promise.race([fetch(request), attesa]);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await salvata()) || fetch(request);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // L'apertura dell'app prova prima la rete: così, appena c'è collegamento,
  // arriva la pagina nuova e non si resta fermi su una copia vecchia. Se la rete
  // non risponde entro tre secondi si parte lo stesso con la copia salvata.
  if (request.mode === 'navigate') {
    event.respondWith(apriDallaRete(request));
    return;
  }

  if (SVILUPPO_LOCALE) {
    event.respondWith(apriDallaRete(request));
    return;
  }

  // Tutto il resto viene dalla cache della versione in corso: i file dell'app
  // restano coerenti tra loro, mai metà vecchi e metà nuovi.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cache.match('./index.html')))),
  );
});
