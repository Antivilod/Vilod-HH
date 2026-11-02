// Restore never resumes a form operation, but it must retain its uncertainty.
// Reviewed tombstones survive later backups, so older archives cannot undo them.
export function recoverPreparationLocks(source){
 const latest=new Map();let count=0;
 const collect=operations=>{
  if(!operations||typeof operations!=='object'||Array.isArray(operations))throw Error('Поврежден архив подготовки');
  for(const [id,op] of Object.entries(operations)){
   if(++count>20000||!op||typeof op!=='object'||op.id!==id||typeof id!=='string'||!id||id.length>200||typeof op.vacancy_id!=='string'||!/^\d{1,20}$/.test(op.vacancy_id)||!['in_progress','needs_review','completed','reviewed'].includes(op.status))throw Error('Повреждена операция подготовки в копии');
   latest.set(id,op);
  }
 };
 const walk=(archive,depth=0)=>{
  if(!archive)return;
  if(depth>50||typeof archive!=='object'||Array.isArray(archive))throw Error('Слишком глубокий архив подготовки');
  walk(archive.previous,depth+1);collect(archive.operations||{});
 };
 walk(source.restoredPreparationArchive);
 collect(source.preparationOperations||{});
 collect(source.restoredPreparationLocks||{});
 const locks={};
 for(const [id,op] of latest){
  if(op.status==='completed')continue;
  locks[id]={...structuredClone(op),status:op.status==='reviewed'?'reviewed':'needs_review',restored:true};
  if(locks[id].status==='needs_review')locks[id].error='После восстановления результат прежнего заполнения неизвестен. Проверьте поля перед повторной подготовкой.';
 }
 return locks;
}
