# Licenze

## Codice di Skooling

Il codice applicativo, lo stile e le icone originali di questa cartella sono stati creati per il progetto Skooling. Non includono componenti a pagamento, font esterni, tracciamento o risorse caricate da CDN.

## Mozilla PDF.js

- Libreria: PDF.js, distribuzione `pdfjs-dist`
- Versione: 6.2.108
- Autore e progetto: Mozilla e collaboratori del progetto PDF.js
- Licenza: Apache License 2.0
- File inclusi: `vendor/pdf.mjs`, `vendor/pdf.worker.mjs`
- Testo completo della licenza: `vendor/PDFJS-LICENSE.txt`
- SHA-256 di `vendor/pdf.mjs`: `487bde1bcf89e041f791173d0509a1dc18d0feb6655d78395e1611f9da0de17d`
- SHA-256 di `vendor/pdf.worker.mjs`: `1a7607f28cfbc63f0e4e0a41927c89f991e353e4f3fb4565ecfd621ac5975089`

PDF.js è l'unica libreria esterna utilizzata a runtime. I file sono inclusi localmente e non vengono richiesti da Internet.

### I decodificatori WebAssembly di PDF.js

Dalla versione 6, PDF.js non porta più dentro `pdf.worker.mjs` i decodificatori
di alcune immagini: stanno in moduli WebAssembly a parte, che vanno distribuiti
con l'app. Skooling li include tutti e tre localmente, come il resto.

- `vendor/jbig2.wasm` decodifica le immagini **CCITTFax e JBIG2**, cioè le
  maschere in bianco e nero delle pagine scansionate. Serve ai libri passati
  nel CZUR: senza di esso PDF.js salta quelle immagini in silenzio e lascia il
  bianco al loro posto.
- `vendor/openjpeg.wasm` decodifica le immagini **JPEG 2000**.
- `vendor/qcms_bg.wasm` è la gestione del colore, per i profili ICC.

Licenze, tutte compatibili con la ridistribuzione e incluse per intero:

- `vendor/JBIG2-LICENSE.txt`, il codice di partenza è quello di **PDFium**
  (The PDFium Authors), licenza BSD a 3 clausole
- `vendor/OPENJPEG-LICENSE.txt`, **OpenJPEG**, licenza BSD a 2 clausole
- `vendor/QCMS-LICENSE.txt`, **qcms** di Mozilla e Marti Maria, licenza MIT
- Le parti aggiunte da Mozilla per impacchettare i tre moduli stanno sotto
  Apache 2.0, testo in `vendor/JBIG2-PDFJS-LICENSE.txt`,
  `vendor/OPENJPEG-PDFJS-LICENSE.txt` e `vendor/QCMS-PDFJS-LICENSE.txt`

- SHA-256 di `vendor/jbig2.wasm`: `e6bee67724a7b5436fe8162638e3708cfc8d52b6342db69a49715e30ff27cfdc`
- SHA-256 di `vendor/openjpeg.wasm`: `004a0e62db930ba9ff2a22212f4554d0bb57a0635a8287caf70f98117cee14ba`
- SHA-256 di `vendor/qcms_bg.wasm`: `663d86126d5f5fcb1c61490f94353e2a8375660b8c5498ab3ebab5a34b08800e`

## Bravura (simboli musicali)

I simboli del foglio a pentagramma sono i glifi del font **Bravura** di Steinberg
Media Technologies, il font di riferimento dello standard di notazione SMuFL.
L'app ne porta con sé un estratto di sedici glifi, `vendor/SkoolingMusica.woff2`.

Licenza SIL Open Font License 1.1, testo completo in `vendor/BRAVURA-LICENSE.txt`.
Nome riservato del font: "Bravura". L'estratto è ridistribuito con un altro nome,
come la licenza richiede.

## I 240 giorni del diario

I contenuti in `diario-contenuti.js` (battute, quiz, curiosità, sfide, oroscopi
scherzosi e parole del giorno) sono stati **scritti da zero per Skooling**.

Ci si è ispirati ai GENERI che si trovano nei diari scolastici e in rete, cioè
alle forme, non ai testi: dentro non c'è una battuta copiata, una vignetta
ricalcata o una frase presa da un diario, da un sito o da un libro di qualcun
altro. Nessuna citazione, nessuna riproduzione, nessun marchio altrui.

"Smemoranda" è un marchio registrato di terzi. Skooling non lo usa, non lo
nomina nell'interfaccia e non richiama la grafica di quel diario: la direzione
scelta da Cristian è uno stile, scritta a mano e biglietti con l'ombra netta,
non un'imitazione di un prodotto esistente.

Le curiosità riportano fatti verificabili. Battute e oroscopi sono
dichiaratamente scherzi, e l'etichetta sul biglietto lo dice ogni volta.
