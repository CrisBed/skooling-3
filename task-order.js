// La data mostrata nelle schede guida anche il loro ordine.
export function taskDateValue(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

export function orderTasks(tasks, filter = 'todo') {
  const direction = filter === 'all' || filter === 'done' ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const first = taskDateValue(a.consegna), second = taskDateValue(b.consegna);
    if (first === null || second === null) return first === second ? 0 : first === null ? 1 : -1;
    const inserted = task => typeof task.data === 'number' && Number.isFinite(task.data) ? task.data : 0;
    return direction * (first - second) || inserted(b) - inserted(a);
  });
}
