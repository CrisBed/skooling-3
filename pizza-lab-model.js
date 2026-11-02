// Esperimento senza archivio: tagli e scoperte vivono soltanto nel laboratorio aperto.
export const PIZZA_CUTS = Object.freeze([2, 4, 8]);

export function createPizzaLab() { return { cuts: 2, selected: [false, false], discovered: [] }; }

export function validatePizzaLab(value) {
  if (!value || !PIZZA_CUTS.includes(value.cuts) || !Array.isArray(value.selected)
      || value.selected.length !== value.cuts || Array.from(value.selected).some(chosen => typeof chosen !== 'boolean')
      || !Array.isArray(value.discovered) || Array.from(value.discovered).some(cuts => !PIZZA_CUTS.includes(cuts))
      || new Set(value.discovered).size !== value.discovered.length) throw Error('La selezione della pizza non è valida.');
  return { cuts: value.cuts, selected: [...value.selected], discovered: [...value.discovered] };
}

export function togglePizzaSlice(value, index) {
  const state = validatePizzaLab(value);
  if (!Number.isInteger(index) || index < 0 || index >= state.cuts) throw Error('Scegli una fetta presente sulla pizza.');
  state.selected[index] = !state.selected[index];
  return state;
}

export function changePizzaCuts(value, cuts) {
  const state = validatePizzaLab(value);
  if (!PIZZA_CUTS.includes(cuts)) throw Error('La pizza si può dividere in 2, 4 oppure 8 fette.');
  if (cuts >= state.cuts) {
    const factor = cuts / state.cuts;
    state.selected = state.selected.flatMap(chosen => Array(factor).fill(chosen));
  } else {
    const group = state.cuts / cuts, joined = [];
    for (let index = 0; index < state.cuts; index += group) {
      const pieces = state.selected.slice(index, index + group);
      if (pieces.some(chosen => chosen !== pieces[0])) {
        throw Error(`Per riunire le fette da ${index + 1} a ${index + group}, devono essere tutte scelte oppure tutte libere. Altrimenti cambieremmo la porzione. La tua scelta resta com’è.`);
      }
      joined.push(pieces[0]);
    }
    state.selected = joined;
  }
  state.cuts = cuts;
  return state;
}

const fette = count => count === 1 ? 'fetta' : 'fette';

export function pizzaPortionLabel(value) {
  const state = validatePizzaLab(value), count = state.selected.filter(Boolean).length;
  return `${count} ${count === 1 ? 'fetta scelta' : 'fette scelte'} su ${state.cuts} · ${count}/${state.cuts}`;
}

export function inspectPizzaHalf(value) {
  const state = validatePizzaLab(value), selected = state.selected.filter(Boolean).length, total = state.cuts;
  const half = total / 2, missing = Math.max(0, half - selected), extra = Math.max(0, selected - half);
  let kind, message;
  if (!selected) {
    kind = 'empty';
    message = `La pizza aspetta la tua scelta. Tocca ${half === 1 ? 'una fetta' : 'le fette'}: con questo taglio la metà è ${half} ${fette(half)} su ${total}.`;
  } else if (selected === half) {
    kind = 'half';
    message = `${selected}/${total} è proprio metà pizza. Cambia taglio e controlla se riesci a conservare la stessa quantità.`;
  } else if (missing) {
    kind = 'less';
    message = `Hai scelto ${selected} ${fette(selected)} su ${total}: è meno di metà. ${missing === 1 ? 'Manca ancora una fetta' : `Mancano ancora ${missing} fette`} di questo taglio.`;
  } else {
    kind = 'more';
    message = `Hai scelto ${selected} ${fette(selected)} su ${total}: è più di metà. Prova a liberare ${extra === 1 ? 'una fetta' : `${extra} fette`} di questo taglio.`;
  }
  return { kind, selected, total, missing, extra, message };
}

export function discoverPizzaHalf(value) {
  const state = validatePizzaLab(value);
  if (inspectPizzaHalf(state).kind === 'half' && !state.discovered.includes(state.cuts)) state.discovered.push(state.cuts);
  state.discovered.sort((a, b) => a - b);
  return state;
}
