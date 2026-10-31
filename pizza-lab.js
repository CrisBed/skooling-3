import {
  createPizzaLab, togglePizzaSlice, changePizzaCuts, inspectPizzaHalf,
  discoverPizzaHalf, pizzaPortionLabel,
} from './pizza-lab-model.js';

const mounted = new WeakMap();
let sequence = 0;

function sliceMarkup(state, index) {
  const start = index * Math.PI * 2 / state.cuts - Math.PI / 2;
  const end = (index + 1) * Math.PI * 2 / state.cuts - Math.PI / 2;
  const center = (start + end) / 2, radius = 143;
  const x1 = 180 + radius * Math.cos(start), y1 = 180 + radius * Math.sin(start);
  const x2 = 180 + radius * Math.cos(end), y2 = 180 + radius * Math.sin(end);
  const textX = 180 + 99 * Math.cos(center), textY = 180 + 99 * Math.sin(center);
  const chosen = state.selected[index];
  const label = `Fetta ${index + 1} di ${state.cuts}`;
  return `<g class="pizza-lab-slice${chosen ? ' is-selected' : ''}" role="button" tabindex="0" focusable="true" aria-label="${label}" aria-pressed="${chosen}" data-pizza-slice="${index}"><path class="pizza-lab-wedge" d="M 180 180 L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius} ${radius} 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z"/><text class="pizza-lab-number" x="${textX.toFixed(3)}" y="${(textY + 7).toFixed(3)}" text-anchor="middle" aria-hidden="true">${index + 1}</text>${chosen ? `<circle class="pizza-lab-chosen-dot" cx="${textX.toFixed(3)}" cy="${(textY + 22).toFixed(3)}" r="5" aria-hidden="true"/>` : ''}</g>`;
}

// Ogni fetta ha un solo controllo: lo spicchio SVG è toccabile e raggiungibile da tastiera.
// Nessun salvataggio o chiamata esterna; il genitore decide quando aprire e chiudere il laboratorio.
export function mountPizzaLab(container) {
  if (!container || typeof container.append !== 'function' || !container.ownerDocument) throw Error('Scegli uno spazio per il laboratorio della pizza.');
  mounted.get(container)?.destroy();
  const document = container.ownerDocument, prefix = `pizza-lab-${++sequence}`;
  const root = document.createElement('section');
  root.className = 'pizza-lab';
  root.setAttribute('aria-labelledby', prefix + '-title');
  root.innerHTML = `<header class="pizza-lab-heading"><h2 id="${prefix}-title">Scegli la tua metà</h2><p>La pizza è la stessa. Riesci a trovare tre modi per prenderne metà?</p></header><div class="pizza-lab-workbench"><div class="pizza-lab-board"><svg class="pizza-lab-pizza" viewBox="0 0 360 360" role="group" aria-labelledby="${prefix}-pizza-title" aria-describedby="${prefix}-help"><title id="${prefix}-pizza-title">Scegli le fette della pizza</title><circle class="pizza-lab-crust" cx="180" cy="180" r="155"/><g data-pizza-slices></g></svg><p class="pizza-lab-portion" data-pizza-portion></p><p class="pizza-lab-help" id="${prefix}-help">Tocca una fetta per sceglierla o lasciarla. Con la tastiera: Tab e Invio oppure Spazio.</p></div><div class="pizza-lab-controls"><label class="pizza-lab-cut-label" for="${prefix}-cuts">Prova un altro taglio<select id="${prefix}-cuts" data-pizza-cuts><option value="2">2 fette</option><option value="4">4 fette</option><option value="8">8 fette</option></select></label><p class="pizza-lab-cut-note">Cambiamo i tagli, conservando la porzione che hai scelto.</p><button class="button primary pizza-lab-check" type="button" data-pizza-check>Verifica la mia metà</button><p class="pizza-lab-feedback" data-pizza-feedback role="status" aria-live="polite" aria-atomic="true"></p><div class="pizza-lab-discovery" data-pizza-discovery hidden><p class="pizza-lab-discovery-label">LE TUE SCOPERTE</p><p class="pizza-lab-equation" data-pizza-equation></p><p data-pizza-conclusion></p></div></div></div><p class="pizza-lab-footnote">Un esperimento libero: puoi cambiare idea e provare ancora.</p>`;
  const slices = root.querySelector('[data-pizza-slices]');
  const cuts = root.querySelector('[data-pizza-cuts]');
  const portion = root.querySelector('[data-pizza-portion]');
  const feedback = root.querySelector('[data-pizza-feedback]');
  const discovery = root.querySelector('[data-pizza-discovery]');
  let state = createPizzaLab(), destroyed = false;

  function draw(message, kind = 'explore', focusSlice = null) {
    if (destroyed) return;
    slices.innerHTML = state.selected.map((_, index) => sliceMarkup(state, index)).join('');
    cuts.value = String(state.cuts);
    portion.textContent = pizzaPortionLabel(state);
    feedback.dataset.kind = kind;
    feedback.textContent = message;
    discovery.hidden = !state.discovered.length;
    root.querySelector('[data-pizza-equation]').textContent = state.discovered.map(n => `${n / 2}/${n}`).join(' = ');
    root.querySelector('[data-pizza-conclusion]').textContent = state.discovered.length === 3
      ? 'Il mistero è risolto: tre tagli diversi, la stessa metà. Puoi esplorare anche altre porzioni.'
      : 'Hai trovato una metà. Prova un taglio diverso e controlla se la quantità resta uguale.';
    if (focusSlice !== null) slices.querySelector(`[data-pizza-slice="${focusSlice}"]`)?.focus({ preventScroll: true });
  }

  function toggle(index) {
    state = togglePizzaSlice(state, index);
    draw(`${pizzaPortionLabel(state)}. Quando vuoi, controlliamo se è metà.`, 'explore', index);
  }

  function click(event) {
    const slice = event.target.closest?.('[data-pizza-slice]');
    if (slice && slices.contains(slice)) return toggle(Number(slice.dataset.pizzaSlice));
    if (!event.target.closest?.('[data-pizza-check]')) return;
    state = discoverPizzaHalf(state);
    const result = inspectPizzaHalf(state);
    const all = result.kind === 'half' && state.discovered.length === 3;
    draw(all ? 'Hai trovato la stessa metà con 2, 4 e 8 fette. La quantità non cambia: 1/2 = 2/4 = 4/8.' : result.message, result.kind);
  }

  function change(event) {
    if (event.target !== cuts) return;
    try {
      state = changePizzaCuts(state, Number(cuts.value));
      draw(`Il taglio è cambiato, la porzione è rimasta identica. Ora: ${pizzaPortionLabel(state)}.`, 'explore');
    } catch (error) {
      cuts.value = String(state.cuts);
      feedback.dataset.kind = 'blocked';
      feedback.textContent = error.message;
    }
  }

  function keydown(event) {
    const slice = event.target.closest?.('[data-pizza-slice]');
    if (!slice || !slices.contains(slice)) return;
    const index = Number(slice.dataset.pizzaSlice);
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(index); return; }
    const move = { ArrowRight: (index + 1) % state.cuts, ArrowDown: (index + 1) % state.cuts, ArrowLeft: (index + state.cuts - 1) % state.cuts, ArrowUp: (index + state.cuts - 1) % state.cuts, Home: 0, End: state.cuts - 1 };
    if (Object.hasOwn(move, event.key)) {
      event.preventDefault();
      slices.querySelector(`[data-pizza-slice="${move[event.key]}"]`)?.focus({ preventScroll: true });
    }
  }

  root.addEventListener('click', click);
  root.addEventListener('change', change);
  root.addEventListener('keydown', keydown);
  container.append(root);
  draw('Tocca le fette da tenere. Se cambi idea, toccale ancora.');
  const handle = { destroy() {
    if (destroyed) return;
    destroyed = true;
    root.removeEventListener('click', click);
    root.removeEventListener('change', change);
    root.removeEventListener('keydown', keydown);
    root.remove();
    if (mounted.get(container) === handle) mounted.delete(container);
  } };
  mounted.set(container, handle);
  return handle;
}
