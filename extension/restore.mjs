import {emptyState,dispatch} from './local-store.mjs';
import {initialProfile,validateProfile} from './profile.mjs';
import {hash} from './exchange.mjs';
import {employerId} from './company-reader.mjs';
import {recordExistingResponse} from './response-evidence.mjs';
import {importOperatorReport} from './operator-report.mjs';
import {recoverPreparationLocks} from './recovery-locks.mjs';
import {restoreObservationTimes} from './observation-times.mjs';
export async function restore(current,backup){
 const seedIds=new Set(current.legacySeed?.record_ids||[]);
 if(Object.keys(current.cards).length||Object.keys(current.history||{}).some(id=>!seedIds.has(id))||current.jobs.length||current.profile.version!==1||Object.keys(current.analysisRequests||{}).length||Object.keys(current.operatorReports||{}).length||Object.keys(current.preparationOperations||{}).length||Object.keys(current.restoredPreparationLocks||{}).length||Object.keys(current.existingResponses||{}).length)throw Error('Восстановление доступно только в пустое хранилище. Текущие данные не изменены');
 if(!backup||backup.format!=='vilod-hh-backup'||backup.version!==1||backup.state?.schema!==1||JSON.stringify(backup).length>15000000)throw Error('Неверный формат резервной копии');
 const source=backup.state,next=emptyState(),profile={...initialProfile(),...source.profile};
 if(typeof profile.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(profile.id)||!Number.isSafeInteger(profile.version)||profile.version<1)throw Error('Неверная версия профиля');
 next.profile={...validateProfile(profile),id:profile.id,version:profile.version};
 if(!source.cards||Object.keys(source.cards).length>10000||!source.companies||!source.questions||!Array.isArray(source.jobs)||source.jobs.length>10000)throw Error('Неполная копия');
 for(const [id,item] of Object.entries(source.cards)){
  if(id!==item.value?.vacancy_id||!Number.isSafeInteger(item.version)||item.version<1)throw Error('Неверная версия карточки');
  const observed=Date.parse(item.captured_at||backup.created_at);if(!Number.isFinite(observed))throw Error('Нет времени наблюдения карточки в копии');
  dispatch(next,{command:'save_vacancy',vacancy:item.value},observed);next.cards[id].version=item.version;
 }
 for(const c of Object.values(source.companies)){
  const observed=Date.parse(c.captured_at||backup.created_at);if(!Number.isFinite(observed))throw Error('Нет времени наблюдения компании в копии');
  dispatch(next,{command:'save_company',company:c},observed);
 }
 restoreObservationTimes(next,source.observationTimes);
 if(source.companyArchive!==undefined){
  if(!Array.isArray(source.companyArchive)||source.companyArchive.length>10000)throw Error('Поврежден архив компаний');
  for(const c of source.companyArchive){
   const id=employerId(c?.url);
   if(typeof c.content!=='string'||!c.content.trim()||c.content.length>100000||c.employer_id!==undefined&&String(c.employer_id)!==id)throw Error('Повреждены материалы компании в архиве');
  }
  next.companyArchive=structuredClone(source.companyArchive);
 }
 for(const [id,q] of Object.entries(source.questions))dispatch(next,{command:'save_questions',questionnaire:{...q,vacancy_id:id}});
 for(const visual of Object.values(source.visualForms||{}))dispatch(next,{command:'save_visual_form',visual});
 dispatch(next,{command:'import_history',history:{format:'vilod-hh-history',version:1,records:Object.values(source.history||{})}});
 // Rebuild the seed marker from the installed seed on the next normal worker
 // message. A marker supplied by a backup must not redefine "empty storage".
 // importHistory compares record contents independently of storage key order.
 for(const [id,evidence] of Object.entries(source.existingResponses||{})){
  if(id!==evidence.vacancy_id)throw Error('Повреждено подтверждение прежнего отклика');
  recordExistingResponse(next,evidence);
 }
 // Only reading jobs are restored, with fresh IDs and no active leases.
 for(const j of source.jobs){
  if(j.kind!=='read_vacancy'||String(j.vacancy_id)!==new URL(j.url).pathname.match(/^\/vacancy\/(\d+)\/?$/)?.[1])throw Error('Неверное задание в копии');
  dispatch(next,{command:'enqueue_search',search:{source_url:j.source_url,urls:[j.url]}});
 }
 const archivedRequests=source.analysisRequests||{},archivedReplies=source.analysisReplies||{};
 // Preserve old exchanges as archival records; they cannot authorize filling or sending.
 next.restoredExchangeArchive={requests:structuredClone(archivedRequests),replies:structuredClone(archivedReplies),previous:structuredClone(source.restoredExchangeArchive||null)};
 next.restoredEventArchive={events:structuredClone(source.events||[]),previous:structuredClone(source.restoredEventArchive||null)};
 // Never resume a form mutation from a backup. Keep its exact snapshot as evidence.
 next.restoredPreparationArchive={operations:structuredClone(source.preparationOperations||{}),previous:structuredClone(source.restoredPreparationArchive||null),requires_manual_form_review:true};
 const recoveredLocks=recoverPreparationLocks(source);
 if(Object.keys(recoveredLocks).length)next.restoredPreparationLocks=recoveredLocks;
 for(const [id,item] of Object.entries(source.operatorReports||{})){
  if(item.report?.operation_id!==id||await hash(item.report)!==item.checksum)throw Error('Поврежден отчет оператора в копии');
  await importOperatorReport(next,item.report,item.source_file,{restoreOnly:true});
 }
 for(const [id,request] of Object.entries(archivedRequests)){
  if(request.request_id!==id||!request.payload||await hash(request.payload)!==request.context_hash)throw Error('Поврежден пакет анализа в копии');
 }
 for(const [id,item] of Object.entries(archivedReplies))if(!archivedRequests[id]||await hash(item.response)!==item.checksum)throw Error('Поврежден ответ в копии');
 next.paused=true;next.events=[...next.events.filter(e=>e.type.startsWith('operator_')),{type:'backup_restored',at:new Date().toISOString(),original_created_at:backup.created_at,exchanges_require_new_export:true}];
 return {state:next,result:{ok:true,cards:Object.keys(next.cards).length,history:Object.keys(next.history).length,archived_replies:Object.keys(archivedReplies).length,paused:true,message:'Ответы из копии сохранены в архиве. Выгрузите свежие задания на анализ перед дальнейшей работой.'}};
}
