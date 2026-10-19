export const SCHOOL_ZONE = 'Europe/Rome';
export function schoolClock(date = new Date()) {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:SCHOOL_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {day:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)};
}
export function schoolQuiet(date = new Date()) { const {minutes}=schoolClock(date); return minutes>=510 && minutes<810; }
export function timeMinutes(time) { if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Inserisci un orario valido.');return Number(time.slice(0,2))*60+Number(time.slice(3)); }
export function dueRoutine(item, done, date = new Date()) {
 const clock=schoolClock(date);
 return !schoolQuiet(date) && item.enabled && item.days.includes(clock.weekday) && !done[item.id] && clock.minutes===timeMinutes(item.time);
}
export function initialRoutines() {
 const list=[['mattina','07:15','Lavarmi e vestirmi'],['mattina','07:30','Controllare zaino e compiti'],['mattina','07:40','Prendere borraccia e merenda'],['pomeriggio','15:00','Guardare i compiti di oggi'],['pomeriggio','15:10','Preparare il materiale e iniziare'],['pomeriggio','17:00','Controllare cosa resta da fare'],['sera','20:30','Preparare vestiti e zaino per domani'],['sera','21:00','Mettere in carica il tablet'],['sera','21:10','Lavarmi i denti e prepararmi per dormire']];
 return list.map(([group,time,title],i)=>({id:`routine-${i}`,group,time,title,days:[1,2,3,4,5],enabled:true}));
}
