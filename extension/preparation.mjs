// Local form preparation only. No command in this module submits an application.
import {historyMatches} from './history.mjs';
export const PREPARATION_COMMANDS=new Set(['begin_preparation','check_preparation','complete_preparation','fail_preparation','get_preparation_operations','review_preparation']);
const ACTIVE='in_progress',UNCERTAIN='needs_review';
const stamp=now=>new Date(now).toISOString();
function event(s,op,type,now,extra={}){
 s.events.push({type,at:stamp(now),vacancy_id:op.vacancy_id,request_id:op.request_id,operation_id:op.id,profile_version:op.profile_version,letter:op.letter,answers:op.answers,send_confirmed:false,...extra});
}
export function expirePreparations(s,now=Date.now()){
 for(const op of Object.values(s.preparationOperations||{}))if(op.status===ACTIVE&&op.expires_at<=now){
  op.status=UNCERTAIN;op.error='Время ожидания результата истекло. Проверьте поля формы перед повтором.';
  event(s,op,'preparation_unresolved',now,{result:'form_result_unknown',error:op.error});
 }
}
export function stopPreparations(s,now=Date.now()){
 for(const op of Object.values(s.preparationOperations||{}))if(op.status===ACTIVE){
  op.status=UNCERTAIN;op.error='Операция остановлена. Поля, уже заполненные до остановки, нужно проверить.';
  event(s,op,'preparation_unresolved',now,{result:'stopped_form_result_unknown',error:op.error});
 }
}
export async function preparation(s,m,{now=Date.now(),hashContext,hashValue,uuid=()=>crypto.randomUUID()}={}){
 expirePreparations(s,now);
 if(m.command==='get_preparation_operations')return {ok:true,operations:structuredClone([...Object.values(s.preparationOperations||{}),...Object.values(s.restoredPreparationLocks||{})]),send_allowed:false};
 if(m.command==='begin_preparation'){
  const id=String(m.vacancy_id),reply=s.analysisReplies?.[m.request_id],request=s.analysisRequests?.[m.request_id];
  if(!['letter_inserted','answers_inserted'].includes(m.action))throw Error('Неизвестный вид подготовки');
  if(!request||!reply||reply.response.hh_vacancy_id!==id||reply.response.decision!=='suitable')throw Error('Нужен актуальный анализ подходящей вакансии');
  if(s.existingResponses?.[id])throw Error('На HH уже есть отклик. Повторная подготовка заблокирована.');
  if(historyMatches(s,id).some(record=>record.hh_ids.includes(id)))throw Error('В истории есть прежний отклик или неизвестный исход по этому HH ID. Сначала проверьте историю.');
  if(Object.values(s.restoredPreparationLocks||{}).some(op=>op.vacancy_id===id&&op.status==='needs_review'))throw Error('После восстановления осталась незавершенная подготовка. Сначала проверьте поля и отметьте проверку в журнале.');
  if(await hashContext(s,id)!==reply.response.context_hash)throw Error('Данные изменились. Требуется новый анализ');
  if(Object.values(s.preparationOperations||{}).some(op=>op.vacancy_id===id&&[ACTIVE,UNCERTAIN].includes(op.status)))throw Error('Есть незавершенная подготовка. Проверьте ее в журнале перед повтором.');
  const answers=(reply.questionnaire?.answers||[]).filter(a=>a.status==='prepared');
  if(m.action==='letter_inserted'&&!reply.response.letter.trim())throw Error('Нет подготовленного письма');
  if(m.action==='answers_inserted'&&(!answers.length||!request.payload.hh_questionnaire))throw Error('Нет подготовленных ответов для исходной анкеты');
  const operation={id:uuid(),vacancy_id:id,request_id:m.request_id,action:m.action,status:ACTIVE,started_at:stamp(now),expires_at:now+120000,profile_version:reply.response.profile_version,context_hash:reply.response.context_hash,vacancy_hash:reply.response.vacancy_hash,letter:m.action==='letter_inserted'?reply.response.letter:null,answers:m.action==='answers_inserted'?structuredClone(answers):[],questions:m.action==='answers_inserted'?structuredClone(request.payload.hh_questionnaire.questions):[],send_allowed:false};
  s.preparationOperations??={};s.preparationOperations[operation.id]=operation;
  event(s,operation,'preparation_started',now,{result:'form_preparation_started'});
  return {ok:true,operation:structuredClone(operation),send_allowed:false};
 }
 const op=s.preparationOperations?.[m.operation_id]||(m.command==='review_preparation'?s.restoredPreparationLocks?.[m.operation_id]:null);if(!op)throw Error('Операция подготовки не найдена');
 if(m.command==='review_preparation'){
  if(op.status!==UNCERTAIN||m.fields_reviewed!==true)throw Error('Сначала вручную проверьте поля незавершенной операции');
  op.status='reviewed';op.reviewed_at=stamp(now);
  event(s,op,'preparation_reviewed',now,{result:'user_reviewed_form_not_submitted'});
  return {ok:true,send_allowed:false};
 }
 if(m.command==='check_preparation'){
  if(op.status!==ACTIVE)throw Error('Подготовка остановлена или требует проверки');
  if(s.existingResponses?.[op.vacancy_id]||historyMatches(s,op.vacancy_id).some(record=>record.hh_ids.includes(op.vacancy_id))||await hashContext(s,op.vacancy_id)!==op.context_hash)throw Error('Контекст изменился. Вставка отменена');
  return {ok:true,send_allowed:false};
 }
 if(m.command==='fail_preparation'){
  if(op.status==='completed')return {ok:true,duplicate:true,send_allowed:false};
  if(![ACTIVE,UNCERTAIN].includes(op.status))throw Error('Операция уже закрыта');
  const error=String(m.error||'Результат заполнения не подтвержден').slice(0,2000);
  if(op.status===UNCERTAIN&&op.error===error)return {ok:true,duplicate:true,send_allowed:false};
  op.status=UNCERTAIN;op.error=error;
  event(s,op,'preparation_failed',now,{result:'form_result_unknown',error:op.error});
  return {ok:true,send_allowed:false};
 }
 if(m.command==='complete_preparation'){
  const result=m.result;
  if(!result||result.submitted!==false)throw Error('Подготовка не может подтверждать отправку');
  if(op.action==='letter_inserted'&&(result.inserted!==true||result.vacancy_id!==op.vacancy_id||result.characters!==op.letter.length))throw Error('Нет полного подтверждения вставки письма');
  if(op.action==='answers_inserted'&&(!Number.isInteger(result.filled)||result.filled!==op.answers.length||result.filled<1))throw Error('Количество ответов не совпадает с подготовленной операцией');
  if(op.status==='completed')return {ok:true,duplicate:true,send_allowed:false};
  if(![ACTIVE,UNCERTAIN].includes(op.status))throw Error('Операция уже закрыта');
  if(op.observed_result&&await hashValue(op.observed_result)===await hashValue(result))return {ok:true,duplicate:true,requires_review:op.status===UNCERTAIN,send_allowed:false};
  const stale=await hashContext(s,op.vacancy_id)!==op.context_hash;
  const interrupted=op.status===UNCERTAIN||stale||Boolean(s.existingResponses?.[op.vacancy_id])||historyMatches(s,op.vacancy_id).some(record=>record.hh_ids.includes(op.vacancy_id));
  op.status=interrupted?UNCERTAIN:'completed';op.observed_result=structuredClone(result);op.observed_at=stamp(now);
  event(s,op,op.action,now,{result:interrupted?'filled_requires_review':'filled_not_submitted',stale_at_recording:stale,vacancy_hash:op.vacancy_hash,requires_review:interrupted});
  return {ok:true,stale_at_recording:stale,requires_review:interrupted,send_allowed:false};
 }
 throw Error('Неизвестная операция подготовки');
}
