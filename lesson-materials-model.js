export function safeStudyLink(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return '';return u.href;}catch{return '';}}
export function cleanMaterial({title,date,section,url,text,topic,subject,kind}){
 if(typeof title!=='string'||!title.trim()||title.trim().length>120)throw Error('Scrivi un titolo, massimo120 caratteri.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Scegli una data valida.');
 if(typeof section!=='string'||section.length>120||typeof text!=='string'||text.length>200000||!topic||!subject)throw Error('Controlla materia, argomento e testo.');
 const link=url?safeStudyLink(url):'';if(url&&!link)throw Error('Usa un collegamento HTTPS completo.');
 if(kind==='link'&&!link)throw Error('Incolla il collegamento del video o del sito.');
 return {titolo:title.trim(),dataLezione:date,sezione:section.trim(),url:link,testo:text,argomento:topic,materia:subject,tipo:kind};
}
export function filterMaterials(rows,query='',date=''){const q=query.trim().toLocaleLowerCase('it');return rows.filter(r=>(!date||r.dataLezione===date)&&(!q||[r.titolo,r.sezione,r.testo,r.fonte,r.dataLezione].some(x=>String(x||'').toLocaleLowerCase('it').includes(q)))).sort((a,b)=>String(b.dataLezione||'').localeCompare(String(a.dataLezione||''))||(b.creatoIl||0)-(a.creatoIl||0));}
